import { ipcMain } from 'electron'
import type { ConversationApi, WorkspaceSession } from '../../shared/contracts/conversations'
import type { ProjectDatabase } from '../projects/database'
import { ProjectConversationStore } from './store'

const channels = {
  load: 'conversations:load',
  save: 'conversations:save',
  remove: 'conversations:remove',
  setActive: 'conversations:set-active',
} as const

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('会话请求无效')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${field}无效`)
  return value.trim()
}

export function registerConversationIpc(getActiveProject: () => { id: string; database: ProjectDatabase } | undefined): () => void {
  const store = (projectId: unknown): ProjectConversationStore => {
    const active = getActiveProject()
    if (!active || active.id !== text(projectId, '项目标识')) throw new Error('当前项目已切换，请重新加载会话')
    return new ProjectConversationStore(active.database)
  }
  const api: Omit<ConversationApi, 'onFlushRequested'> = {
    load: async (raw) => {
      const input = record(raw)
      const current = store(input.projectId)
      const legacySessions = Array.isArray(input.legacySessions) ? input.legacySessions as WorkspaceSession[] : []
      await current.initialize(legacySessions, typeof input.legacyActiveId === 'string' ? input.legacyActiveId : undefined)
      return current.load()
    },
    save: async (raw) => {
      const input = record(raw)
      await store(input.projectId).save(input.session as WorkspaceSession)
    },
    remove: async (raw) => {
      const input = record(raw)
      await store(input.projectId).remove(text(input.sessionId, '会话标识'))
    },
    setActive: async (raw) => {
      const input = record(raw)
      await store(input.projectId).setActive(text(input.sessionId, '会话标识'))
    },
  }

  ipcMain.handle(channels.load, (_event, raw) => api.load(raw as never))
  ipcMain.handle(channels.save, (_event, raw) => api.save(raw as never))
  ipcMain.handle(channels.remove, (_event, raw) => api.remove(raw as never))
  ipcMain.handle(channels.setActive, (_event, raw) => api.setActive(raw as never))
  return () => { for (const channel of Object.values(channels)) ipcMain.removeHandler(channel) }
}

export { channels as conversationIpcChannels }
