import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import type { EditorApi, ImageEditorVersion, SaveImageEditorVersionInput } from '../../shared/contracts/editor'

const MAX_DATA_BYTES = 50 * 1024 * 1024
const MAX_SUGGESTION = 20_000
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i

interface Snapshot { version: 1; items: ImageEditorVersion[] }

function within(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !child.includes(`..${sep}`)
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${name}无效`)
  return value.trim()
}

function decodeDataUrl(value: unknown): { bytes: Buffer; extension: 'png' | 'jpg' | 'webp' } {
  if (typeof value !== 'string') throw new Error('标注图数据无效')
  const match = value.match(DATA_URL)
  if (!match) throw new Error('标注图必须是 PNG、JPEG 或 WebP 数据 URL')
  const bytes = Buffer.from(match[2]!, 'base64')
  if (!bytes.byteLength || bytes.byteLength > MAX_DATA_BYTES) throw new Error('标注图不能超过 50 MiB')
  const extension = match[1]!.endsWith('jpeg') ? 'jpg' : match[1]!.slice('image/'.length) as 'png' | 'webp'
  return { bytes, extension }
}

async function writeAtomic(path: string, value: string | Uint8Array): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try { await fs.writeFile(temporary, value); await fs.rename(temporary, path) } catch (error) { try { await fs.unlink(temporary) } catch {} ; throw error }
}

async function load(path: string): Promise<Snapshot> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<Snapshot>
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) throw new Error('invalid')
    return { version: 1, items: parsed.items.filter((item): item is ImageEditorVersion => Boolean(item && typeof item === 'object' && typeof item.id === 'string' && typeof item.markedImagePath === 'string' && typeof item.suggestion === 'string')) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, items: [] }
    throw new Error('图片编辑版本记录损坏或无法读取')
  }
}

export class ImageEditorStore implements EditorApi {
  private readonly root: string
  private readonly snapshotPath: string
  private writing: Promise<unknown> = Promise.resolve()

  constructor(projectRoot: string) {
    this.root = resolve(projectRoot)
    this.snapshotPath = join(this.root, '.latent-studio', 'editor-versions.json')
  }

  async saveVersion(input: Omit<SaveImageEditorVersionInput, 'projectRoot'>): Promise<ImageEditorVersion> {
    const title = text(input.title, '编辑标题', 200)
    const suggestion = text(input.suggestion, '修改建议', MAX_SUGGESTION)
    const decoded = decodeDataUrl(input.markedDataUrl)
    const id = randomUUID()
    const outputPath = join(this.root, 'outputs', 'editor', `${id}.${decoded.extension}`)
    if (!within(this.root, outputPath)) throw new Error('编辑版本路径无效')
    await writeAtomic(outputPath, decoded.bytes)
    const item: ImageEditorVersion = { id, title, ...(input.parentVersionId?.trim() ? { parentVersionId: input.parentVersionId.trim() } : {}), ...(input.source ? { source: input.source } : {}), markedImagePath: relative(this.root, outputPath).split(sep).join('/'), suggestion, ...(input.taskId?.trim() ? { taskId: input.taskId.trim() } : {}), createdAt: new Date().toISOString() }
    const next = this.writing.catch(() => undefined).then(async () => {
      try {
        const snapshot = await load(this.snapshotPath)
        snapshot.items.unshift(item)
        await writeAtomic(this.snapshotPath, `${JSON.stringify(snapshot, null, 2)}\n`)
        return item
      } catch (error) {
        try { await fs.unlink(outputPath) } catch {}
        throw error
      }
    })
    this.writing = next
    return next
  }

  async listVersions(): Promise<ImageEditorVersion[]> { return (await load(this.snapshotPath)).items.map((item) => ({ ...item })) }

  async getVersionPreview(id: string): Promise<string | null> {
    const version = (await load(this.snapshotPath)).items.find((item) => item.id === id)
    if (!version) return null
    const filePath = resolve(this.root, version.markedImagePath)
    if (!within(this.root, filePath)) throw new Error('编辑版本路径无效')
    try {
      const bytes = await fs.readFile(filePath)
      const extension = extname(filePath).toLowerCase()
      const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : 'image/png'
      return `data:${mime};base64,${bytes.toString('base64')}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('无法读取编辑版本预览')
    }
  }
}
