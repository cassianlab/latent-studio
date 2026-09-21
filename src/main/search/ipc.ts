import { ipcMain } from 'electron'
import type { SearchApi } from '../../shared/contracts/search'
import { searchWeb } from './service'

const channel = 'search:web'

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }

export interface SearchIpcOptions { getProjectRoot: () => string | undefined }

export function registerSearchIpc({ getProjectRoot }: SearchIpcOptions): () => void {
  const api: SearchApi = { search: (raw) => { const input = record(raw); return searchWeb({ query: input.query as string, ...(typeof input.maxResults === 'number' ? { maxResults: input.maxResults } : {}) }, { getProjectRoot }) } }
  ipcMain.handle(channel, (_event, raw) => api.search(raw))
  return () => ipcMain.removeHandler(channel)
}

export const searchIpcChannel = channel
