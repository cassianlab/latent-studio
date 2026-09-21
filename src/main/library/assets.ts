import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import type { ListProjectAssetsInput, ProjectAsset, ProjectAssetCategory, ProjectAssetStore } from '../../shared/contracts/library'
import { MAX_REFERENCE_IMAGE_BYTES } from '../../shared/reference-images'
import { LibraryError } from './errors'

const ASSET_FILE = ['.latent-studio', 'assets.json']
const MAX_ASSET_BYTES = 50 * 1024 * 1024
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const MAX_GENERATED_PREVIEW_BYTES = MAX_ASSET_BYTES
const DEFAULT_MAX_ENTRIES = 500
const HARD_MAX_ENTRIES = 10_000

interface AssetFile { format: 1; items: ProjectAsset[] }

const ASSET_CATEGORIES: readonly ProjectAssetCategory[] = ['character', 'scene', 'prop', 'style-reference', 'reference', 'output', 'other']

const MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.avif': 'image/avif', '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
}

function isWithin(root: string, candidate: string, allowEqual = false): boolean {
  const child = relative(root, candidate)
  if (allowEqual && child === '') return true
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

async function projectRoot(value: unknown): Promise<string> {
  if (typeof value !== 'string' || !isAbsolute(value) || parse(resolve(value)).root === resolve(value)) {
    throw new LibraryError('invalid-project-root', '项目根目录必须是绝对且非根路径')
  }
  try {
    const root = await fs.realpath(resolve(value))
    if (!(await fs.stat(root)).isDirectory()) throw new Error('not-directory')
    return root
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new LibraryError('invalid-project-root', '项目根目录不存在')
    throw new LibraryError('invalid-project-root', '无法访问项目根目录')
  }
}

async function assetsDirectory(root: string): Promise<string> {
  const lexical = resolve(root, 'assets')
  await fs.mkdir(lexical, { recursive: true })
  const canonical = await fs.realpath(lexical)
  if (!isWithin(root, canonical)) throw new LibraryError('outside-project', '素材目录不能离开项目')
  if (!(await fs.stat(canonical)).isDirectory()) throw new LibraryError('not-a-directory', '素材目录不是文件夹')
  return canonical
}

function assetPath(root: string): string { return resolve(root, ...ASSET_FILE) }

async function readAssets(path: string): Promise<AssetFile> {
  try {
    const value = JSON.parse(await fs.readFile(path, 'utf8')) as Partial<AssetFile>
    if (value.format !== 1 || !Array.isArray(value.items)) throw new Error('invalid')
    return { format: 1, items: value.items.map(normalizeAsset).filter((item): item is ProjectAsset => item !== null) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { format: 1, items: [] }
    throw new LibraryError('corrupt-library', '素材库文件损坏')
  }
}

async function writeAtomic(path: string, value: AssetFile): Promise<void> {
  await fs.mkdir(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await fs.rename(temporary, path)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw new LibraryError('read-failed', `无法写入素材库：${(error as Error).message}`)
  }
}

async function writeAtomicBytes(path: string, value: Uint8Array): Promise<void> {
  const temporary = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temporary, value)
    await fs.rename(temporary, path)
  } catch (error) {
    try { await fs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw new LibraryError('read-failed', `无法保存参考图：${(error as Error).message}`)
  }
}

function maxEntries(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_ENTRIES
  if (!Number.isInteger(value) || value < 1 || value > HARD_MAX_ENTRIES) throw new LibraryError('invalid-input', `最多只能读取 1-${HARD_MAX_ENTRIES} 项`)
  return value
}

function mimeFor(name: string): string | undefined { return MIME_BY_EXTENSION[extname(name).toLowerCase()] }

function isAssetCategory(value: unknown): value is ProjectAssetCategory {
  return typeof value === 'string' && ASSET_CATEGORIES.includes(value as ProjectAssetCategory)
}

function defaultCategory(item: Pick<ProjectAsset, 'mimeType'>): ProjectAssetCategory {
  return item.mimeType?.startsWith('image/') ? 'reference' : 'other'
}

function normalizeAsset(value: unknown): ProjectAsset | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<ProjectAsset>
  if (typeof item.id !== 'string' || typeof item.relativePath !== 'string' || typeof item.name !== 'string') return null
  const origin = item.origin === 'generated' || item.origin === 'imported'
    ? item.origin
    : (item.category === 'output' || item.relativePath.startsWith('outputs/') ? 'generated' : 'imported')
  return { ...item, category: isAssetCategory(item.category) ? item.category : defaultCategory(item), origin } as ProjectAsset
}

function previewable(mimeType: string | undefined): boolean {
  return Boolean(mimeType && ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp', 'image/tiff'].includes(mimeType))
}

function validSourcePath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value)) throw new LibraryError('invalid-path', '导入文件路径无效')
  return resolve(value)
}

async function uniqueDestination(directory: string, originalName: string): Promise<string> {
  const extension = extname(originalName)
  const stem = basename(originalName, extension).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || '未命名素材'
  let candidate = resolve(directory, `${stem}${extension}`)
  let suffix = 1
  while (true) {
    try { await fs.access(candidate); candidate = resolve(directory, `${stem} (${suffix++})${extension}`) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return candidate
      throw new LibraryError('read-failed', '无法检查素材目标路径')
    }
  }
}

function disambiguateName(existingNames: Set<string>, originalName: string): string {
  const extension = extname(originalName)
  const stem = basename(originalName, extension)
  let candidate = originalName
  let suffix = 1
  while (existingNames.has(candidate)) {
    candidate = `${stem} (${suffix++})${extension}`
  }
  existingNames.add(candidate)
  return candidate
}

/** Copies user-selected files into the active project's assets directory. */
export class ProjectAssetService implements ProjectAssetStore {
  private writeChain: Promise<unknown> = Promise.resolve()

  async list(input: { projectRoot: string} & ListProjectAssetsInput): Promise<ProjectAsset[]> {
    const root = await projectRoot(input.projectRoot)
    if (input.category !== undefined && !isAssetCategory(input.category)) throw new LibraryError('invalid-input', '素材分类无效')
    const file = await readAssets(assetPath(root))
    const search = input.search?.trim().toLocaleLowerCase()
    return file.items
      .filter((item) => !input.category || item.category === input.category)
      .filter((item) => !search || `${item.name}\n${item.sourceName}`.toLocaleLowerCase().includes(search))
      .slice(0, maxEntries(input.maxEntries))
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt))
  }

  async import(input: { projectRoot: string; sourcePaths: readonly string[]; category?: ProjectAssetCategory }): Promise<ProjectAsset[]> {
    const root = await projectRoot(input.projectRoot)
    if (!Array.isArray(input.sourcePaths) || input.sourcePaths.length === 0) throw new LibraryError('invalid-input', '至少选择一个文件')
    if (input.sourcePaths.length > 100) throw new LibraryError('invalid-input', '一次最多导入 100 个文件')
    return this.enqueue(async () => {
      const file = await readAssets(assetPath(root))
      const existingNames = new Set(file.items.map((i) => i.name))
      const imported: ProjectAsset[] = []
      for (const rawPath of input.sourcePaths) {
        const sourcePath = validSourcePath(rawPath)
        let details: Awaited<ReturnType<typeof fs.stat>>
        try { details = await fs.stat(sourcePath) } catch { throw new LibraryError('missing-path', '导入文件不存在') }
        if (!details.isFile()) throw new LibraryError('not-a-file', '只能导入文件')
        if (details.size > MAX_ASSET_BYTES) throw new LibraryError('invalid-input', '单个素材不能超过 50 MB')
        const isInside = isWithin(root, sourcePath)
        const relPath = isInside ? relative(root, sourcePath).split(sep).join('/') : sourcePath
        const name = disambiguateName(existingNames, basename(sourcePath))
        const now = new Date().toISOString()
        const assetCat = input.category && isAssetCategory(input.category) ? input.category : defaultCategory({ mimeType: mimeFor(name) })
        imported.push({
          id: randomUUID(),
          name,
          relativePath: relPath,
          sourceName: basename(sourcePath),
          category: assetCat,
          origin: 'imported',
          ...(extname(name) ? { extension: extname(name).toLowerCase() } : {}),
          ...(mimeFor(name) ? { mimeType: mimeFor(name) } : {}),
          byteLength: details.size,
          modifiedAt: new Date(details.mtimeMs).toISOString(),
          importedAt: now,
          previewable: previewable(mimeFor(name)),
        })
      }
      await writeAtomic(assetPath(root), { format: 1, items: [...imported, ...file.items] })
      return imported
    })
  }

  async saveReferenceImage(input: { projectRoot: string; name: string; dataUrl: string }): Promise<ProjectAsset> {
    const root = await projectRoot(input.projectRoot)
    const match = typeof input.dataUrl === 'string' ? input.dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/]*={0,2})$/) : null
    if (!match || match[1].length % 4 === 1) throw new LibraryError('invalid-input', '画板图片数据无效')
    const bytes = Buffer.from(match[1], 'base64')
    const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
    if (!bytes.length || bytes.length > MAX_REFERENCE_IMAGE_BYTES || !pngSignature.every((value, index) => bytes[index] === value)) {
      throw new LibraryError('invalid-input', bytes.length > MAX_REFERENCE_IMAGE_BYTES ? '参考图不能超过 20 MiB' : '画板图片数据无效')
    }
    const directory = await assetsDirectory(root)
    return this.enqueue(async () => {
      const file = await readAssets(assetPath(root))
      const requestedName = `${typeof input.name === 'string' && input.name.trim() ? input.name.trim() : '构图草图'}.png`
      const destination = await uniqueDestination(directory, requestedName)
      await writeAtomicBytes(destination, bytes)
      const now = new Date().toISOString()
      const name = basename(destination)
      const created: ProjectAsset = {
        id: randomUUID(),
        name,
        relativePath: relative(root, destination).split(sep).join('/'),
        sourceName: name,
        category: 'reference',
        origin: 'imported',
        extension: '.png',
        mimeType: 'image/png',
        byteLength: bytes.length,
        modifiedAt: now,
        importedAt: now,
        previewable: true,
      }
      try {
        await writeAtomic(assetPath(root), { format: 1, items: [created, ...file.items] })
        return created
      } catch (error) {
        try { await fs.unlink(destination) } catch { /* best effort rollback */ }
        throw error
      }
    })
  }

  async recordGenerated(input: {
    projectRoot: string
    taskId: string
    title?: string
    localPath: string
    mimeType?: string
    byteLength?: number
  }): Promise<ProjectAsset> {
    const root = await projectRoot(input.projectRoot)
    const canonicalLocal = await fs.realpath(resolve(input.localPath)).catch(() => resolve(input.localPath))
    return this.enqueue(async () => {
      const file = await readAssets(assetPath(root))
      const rel = relative(root, canonicalLocal).split(sep).join('/')
      const existing = file.items.find((entry) => entry.relativePath === rel)
      if (existing) return existing
      const name = (input.title && input.title.trim()) || basename(input.localPath)
      const now = new Date().toISOString()
      const detectedMime = input.mimeType || mimeFor(name) || 'image/png'
      const byteLength = typeof input.byteLength === 'number' && input.byteLength >= 0
        ? input.byteLength
        : (await fs.stat(input.localPath).catch(() => null))?.size ?? 0
      const created: ProjectAsset = {
        id: file.items.some((entry) => entry.id === input.taskId) ? randomUUID() : input.taskId,
        name,
        relativePath: rel,
        sourceName: basename(input.localPath),
        category: 'output',
        origin: 'generated',
        mimeType: detectedMime,
        ...(extname(name) ? { extension: extname(name).toLowerCase() } : {}),
        byteLength,
        modifiedAt: now,
        importedAt: now,
        previewable: previewable(detectedMime),
      }
      await writeAtomic(assetPath(root), { format: 1, items: [created, ...file.items] })
      return created
    })
  }

  async update(input: { projectRoot: string; id: string; category: ProjectAssetCategory }): Promise<ProjectAsset> {
    const root = await projectRoot(input.projectRoot)
    if (typeof input.id !== 'string' || !input.id.trim()) throw new LibraryError('invalid-input', '素材标识不能为空')
    if (!isAssetCategory(input.category)) throw new LibraryError('invalid-input', '素材分类无效')
    return this.enqueue(async () => {
      const file = await readAssets(assetPath(root))
      const index = file.items.findIndex((entry) => entry.id === input.id)
      if (index < 0) throw new LibraryError('not-found', '素材不存在')
      const updated = { ...file.items[index], category: input.category }
      const items = [...file.items]
      items[index] = updated
      await writeAtomic(assetPath(root), { format: 1, items })
      return updated
    })
  }

  async remove(input: { projectRoot: string; id: string }): Promise<void> {
    const root = await projectRoot(input.projectRoot)
    if (typeof input.id !== 'string' || !input.id.trim()) throw new LibraryError('invalid-input', '素材标识不能为空')
    const outputsDir = resolve(root, 'outputs')
    await fs.mkdir(outputsDir, { recursive: true })
    const canonicalOutputs = await fs.realpath(outputsDir)
    return this.enqueue(async () => {
      const file = await readAssets(assetPath(root))
      const item = file.items.find((entry) => entry.id === input.id || entry.relativePath === input.id)
      if (!item) throw new LibraryError('not-found', '素材不存在')
      const isGenerated = item.origin === 'generated' || item.category === 'output' || (!isAbsolute(item.relativePath) && item.relativePath.startsWith('outputs/'))
      if (isGenerated) {
        const candidate = isAbsolute(item.relativePath) ? item.relativePath : resolve(root, item.relativePath)
        try {
          const canonical = await fs.realpath(candidate).catch(() => candidate)
          if (isWithin(outputsDir, canonical, true) || isWithin(canonicalOutputs, canonical, true)) {
            await fs.unlink(canonical)
          }
        } catch {
          /* best effort cleanup */
        }
      }
      await writeAtomic(assetPath(root), { format: 1, items: file.items.filter((entry) => entry.id !== item.id) })
    })
  }

  async preview(input: { projectRoot: string; id: string }): Promise<string | null> {
    const root = await projectRoot(input.projectRoot)
    const file = await readAssets(assetPath(root))
    const item = file.items.find((entry) => entry.id === input.id)
    const previewLimit = item?.origin === 'generated' ? MAX_GENERATED_PREVIEW_BYTES : MAX_PREVIEW_BYTES
    if (!item || !item.previewable || item.byteLength > previewLimit) return null
    const candidate = isAbsolute(item.relativePath) ? item.relativePath : resolve(root, item.relativePath)
    try {
      const canonical = await fs.realpath(candidate)
      if (!isAbsolute(item.relativePath) && !isWithin(root, canonical)) {
        throw new LibraryError('outside-project', '素材路径不能通过符号链接离开项目')
      }
      const bytes = await fs.readFile(canonical)
      return `data:${item.mimeType ?? 'application/octet-stream'};base64,${bytes.toString('base64')}`
    } catch (error) {
      if (error instanceof LibraryError) throw error
      return null
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.writeChain.then(operation, operation)
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }
}
