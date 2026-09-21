import { ipcMain } from 'electron'
import type { EditorApi, SaveImageEditorVersionInput } from '../../shared/contracts/editor'
import { ImageEditorStore } from './store'

const channels = { save: 'editor:save-version', list: 'editor:list-versions', preview: 'editor:get-version-preview' } as const

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function required(value: unknown, message: string): string { if (typeof value !== 'string' || !value.trim()) throw new Error(message); return value.trim() }

export interface EditorIpcOptions { getProjectRoot: () => string | undefined }

export function registerEditorIpc({ getProjectRoot }: EditorIpcOptions): () => void {
  let activeRoot: string | undefined
  let store: ImageEditorStore | undefined
  const current = (): ImageEditorStore => {
    const root = getProjectRoot()
    if (!root) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
    if (root !== activeRoot) { activeRoot = root; store = new ImageEditorStore(root) }
    return store as ImageEditorStore
  }
  const api: EditorApi = {
    saveVersion: (raw) => {
      const value = record(raw)
      return current().saveVersion({ title: required(value.title, '编辑标题不能为空'), markedDataUrl: required(value.markedDataUrl, '标注图不能为空'), suggestion: required(value.suggestion, '修改建议不能为空'), ...(typeof value.parentVersionId === 'string' ? { parentVersionId: value.parentVersionId } : {}), ...(value.source && typeof value.source === 'object' ? { source: value.source as SaveImageEditorVersionInput['source'] } : {}), ...(typeof value.taskId === 'string' ? { taskId: value.taskId } : {}) })
    },
    listVersions: () => current().listVersions(),
    getVersionPreview: (id) => current().getVersionPreview(required(id, '编辑版本标识不能为空')),
  }
  ipcMain.handle(channels.save, (_event, raw) => api.saveVersion(raw))
  ipcMain.handle(channels.list, () => api.listVersions())
  ipcMain.handle(channels.preview, (_event, id) => api.getVersionPreview(id))
  return () => { ipcMain.removeHandler(channels.save); ipcMain.removeHandler(channels.list); ipcMain.removeHandler(channels.preview) }
}

export { channels as editorIpcChannels }
