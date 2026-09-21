import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import type { CanvasApi, CanvasState } from '../../shared/contracts/canvas'

function validState(value: unknown): value is CanvasState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<CanvasState>
  if (state.version !== 1 || !Array.isArray(state.items) || !Array.isArray(state.links)) return false
  if (!state.viewport || typeof state.viewport.scale !== 'number' || !state.viewport.position || typeof state.viewport.position.x !== 'number' || typeof state.viewport.position.y !== 'number') return false
  if (!state.selection || !Array.isArray(state.selection.selectedIds) || (state.selection.selectedId !== null && typeof state.selection.selectedId !== 'string') || (state.selection.selectedLinkId !== null && typeof state.selection.selectedLinkId !== 'string')) return false
  return state.items.every((item) => item && typeof item.id === 'string' && item.id.length > 0 && typeof item.type === 'string' && typeof item.title === 'string' && typeof item.x === 'number' && typeof item.y === 'number' && typeof item.width === 'number' && typeof item.height === 'number')
    && state.links.every((link) => link && typeof link.id === 'string' && typeof link.from === 'string' && typeof link.to === 'string')
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try { await fs.writeFile(temporary, value, 'utf8'); await fs.rename(temporary, path) } catch (error) { try { await fs.unlink(temporary) } catch {} ; throw error }
}

export class CanvasStore implements CanvasApi {
  private readonly path: string
  private writing: Promise<unknown> = Promise.resolve()

  constructor(projectRoot: string) { this.path = join(resolve(projectRoot), '.latent-studio', 'canvas.json') }

  async load(): Promise<CanvasState | null> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.path, 'utf8'))
      if (!validState(parsed)) throw new Error('invalid')
      return parsed
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('画布数据损坏或无法读取')
    }
  }

  async save(state: CanvasState): Promise<CanvasState> {
    if (!validState(state) || state.version !== 1 || state.items.some((item) => item.id.includes('/') || item.id.includes('\\'))) throw new Error('画布数据无效')
    const next = JSON.parse(JSON.stringify(state)) as CanvasState
    const write = this.writing.catch(() => undefined).then(() => writeAtomic(this.path, `${JSON.stringify(next, null, 2)}\n`))
    this.writing = write
    await write
    return next
  }
}
