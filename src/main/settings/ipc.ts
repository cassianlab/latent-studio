import { ipcMain } from 'electron'
import type { SettingsApi, SaveModelProfileInput, SaveProviderConnectionInput, SaveProviderGroupInput } from '../../shared/contracts/settings'
import { SettingsStore } from './storage'

const channels = {
  get: 'settings:get',
  saveGroup: 'settings:save-group',
  deleteGroup: 'settings:delete-group',
  saveConnection: 'settings:save-connection',
  deleteConnection: 'settings:delete-connection',
  saveModel: 'settings:save-model',
  deleteModel: 'settings:delete-model',
  setDefaults: 'settings:set-defaults',
  testConnection: 'settings:test-connection',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function asId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('配置标识缺失')
  return value.trim()
}

export interface SettingsIpcOptions { store: SettingsStore }

export function registerSettingsIpc({ store }: SettingsIpcOptions): () => void {
  const api: SettingsApi = {
    get: async () => store.get(),
    saveGroup: async (raw: SaveProviderGroupInput) => store.saveGroup(asRecord(raw) as unknown as SaveProviderGroupInput),
    deleteGroup: async (id: string) => { store.deleteGroup(asId(id)) },
    saveConnection: async (raw: SaveProviderConnectionInput) => store.saveConnection(asRecord(raw) as unknown as SaveProviderConnectionInput),
    deleteConnection: async (id: string) => { store.deleteConnection(asId(id)) },
    saveModel: async (raw: SaveModelProfileInput) => store.saveModel(asRecord(raw) as unknown as SaveModelProfileInput),
    deleteModel: async (id: string) => { store.deleteModel(asId(id)) },
    setDefaults: async (raw) => {
      const input = asRecord(raw)
      return store.setDefaults({
        ...(Object.hasOwn(input, 'textModelId') ? { textModelId: typeof input.textModelId === 'string' ? input.textModelId : null } : {}),
        ...(Object.hasOwn(input, 'imageModelId') ? { imageModelId: typeof input.imageModelId === 'string' ? input.imageModelId : null } : {}),
      })
    },
    testConnection: async (raw) => store.testConnection(asRecord(raw) as unknown as import('../../shared/contracts/settings').TestConnectionInput),
  }

  ipcMain.handle(channels.get, api.get)
  ipcMain.handle(channels.saveGroup, (_event, input: SaveProviderGroupInput) => api.saveGroup(input))
  ipcMain.handle(channels.deleteGroup, (_event, id: string) => api.deleteGroup(id))
  ipcMain.handle(channels.saveConnection, (_event, input: SaveProviderConnectionInput) => api.saveConnection(input))
  ipcMain.handle(channels.deleteConnection, (_event, id: string) => api.deleteConnection(id))
  ipcMain.handle(channels.saveModel, (_event, input: SaveModelProfileInput) => api.saveModel(input))
  ipcMain.handle(channels.deleteModel, (_event, id: string) => api.deleteModel(id))
  ipcMain.handle(channels.setDefaults, (_event, input: { textModelId?: string; imageModelId?: string }) => api.setDefaults(input))
  ipcMain.handle(channels.testConnection, (_event, input) => api.testConnection(input))

  return () => { for (const channel of Object.values(channels)) ipcMain.removeHandler(channel) }
}
