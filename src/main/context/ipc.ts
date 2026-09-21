import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { MAX_CONTEXT_ATTACHMENTS, type ContextApi, type ReadProjectDocumentInput } from '../../shared/contracts/context'
import { readAttachmentDocument, readProjectDocument } from './reader'

const channels = { read: 'context:read-project-file', choose: 'context:choose-and-read-project-file', chooseAttachments: 'context:choose-and-read-attachments' } as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function requiredPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('文件路径不能为空')
  return value.trim()
}

export interface ContextIpcOptions {
  window?: BrowserWindow
  getProjectRoot: () => string | undefined
}

export function registerContextIpc({ window, getProjectRoot }: ContextIpcOptions): () => void {
  const api: ContextApi = {
    readProjectFile: async (raw: Omit<ReadProjectDocumentInput, 'projectRoot'>) => {
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      const input = asRecord(raw)
      return readProjectDocument({
        projectRoot,
        filePath: requiredPath(input.filePath),
        ...(typeof input.maxBytes === 'number' ? { maxBytes: input.maxBytes } : {}),
      })
    },
    chooseAndReadProjectFile: async () => {
      if (!window) throw new Error('文件选择器未初始化')
      const projectRoot = getProjectRoot()
      if (!projectRoot) throw Object.assign(new Error('请先打开一个项目'), { code: 'no-active-project' })
      const result = await dialog.showOpenDialog(window, { title: '选择项目文件', defaultPath: projectRoot, properties: ['openFile'], filters: [{ name: '可读取文档', extensions: ['md', 'markdown', 'txt', 'text', 'json', 'pdf', 'doc', 'docx'] }] })
      if (result.canceled || !result.filePaths[0]) return null
      return readProjectDocument({ projectRoot, filePath: result.filePaths[0] })
    },
    chooseAndReadAttachments: async () => {
      if (!window) throw new Error('文件选择器未初始化')
      const result = await dialog.showOpenDialog(window, {
        title: '上传附件',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: '可读取文档', extensions: ['md', 'markdown', 'txt', 'text', 'json', 'pdf', 'doc', 'docx'] }],
      })
      if (result.canceled) return []
      return Promise.all(result.filePaths.slice(0, MAX_CONTEXT_ATTACHMENTS).map((filePath) => readAttachmentDocument({ filePath })))
    },
  }
  ipcMain.handle(channels.read, (_event, input: Omit<ReadProjectDocumentInput, 'projectRoot'>) => api.readProjectFile(input))
  ipcMain.handle(channels.choose, () => api.chooseAndReadProjectFile())
  ipcMain.handle(channels.chooseAttachments, () => api.chooseAndReadAttachments())
  return () => { ipcMain.removeHandler(channels.read); ipcMain.removeHandler(channels.choose); ipcMain.removeHandler(channels.chooseAttachments) }
}

export const contextIpcChannel = channels.read
export const contextIpcChannels = channels
