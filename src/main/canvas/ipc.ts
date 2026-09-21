import { ipcMain } from 'electron'
import type { CanvasApi, CanvasState } from '../../shared/contracts/canvas'
import { CanvasStore } from './store'

const channels = { load: 'canvas:load', save: 'canvas:save' } as const
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }

export interface CanvasIpcOptions { getProjectRoot: () => string | undefined }

export function registerCanvasIpc({ getProjectRoot }: CanvasIpcOptions): () => void {
  let activeRoot: string | undefined
  let store: CanvasStore | undefined
  const current = (): CanvasStore => {
    const root = getProjectRoot()
    if (!root) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
    if (root !== activeRoot) { activeRoot = root; store = new CanvasStore(root) }
    return store as CanvasStore
  }
  const api: CanvasApi = {
    load: () => current().load(),
    save: (raw) => current().save(record(raw) as unknown as CanvasState),
  }
  ipcMain.handle(channels.load, () => api.load())
  ipcMain.handle(channels.save, (_event, raw) => api.save(raw))
  return () => { ipcMain.removeHandler(channels.load); ipcMain.removeHandler(channels.save) }
}

export { channels as canvasIpcChannels }
