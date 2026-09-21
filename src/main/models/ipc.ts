import { ipcMain } from 'electron'
import type { TextGenerateInput, TextStreamInput } from '../../shared/contracts/text'
import type { SettingsStore } from '../settings'
import { createTextModelService } from './service'

const channels = {
  discover: 'models:discover',
  generate: 'models:generate',
  compact: 'models:compact',
  startStream: 'models:start-stream',
  stopStream: 'models:stop-stream',
  streamEvent: 'models:text-stream-event',
  streamComplete: 'models:text-stream-complete',
} as const

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function requiredId(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value.trim()
}

export interface ModelsIpcOptions { store: SettingsStore }

export function registerModelsIpc({ store }: ModelsIpcOptions): () => void {
  const service = createTextModelService(store)
  ipcMain.handle(channels.discover, (_event, raw: unknown) => {
    const input = asRecord(raw)
    return service.discoverModels({
      connectionId: requiredId(input.connectionId, '连接标识缺失'),
      ...(typeof input.pageToken === 'string' && input.pageToken ? { pageToken: input.pageToken } : {}),
    })
  })
  ipcMain.handle(channels.generate, (_event, raw: TextGenerateInput) => service.generate(raw))
  ipcMain.handle(channels.compact, (_event, raw) => service.compact(raw))
  ipcMain.handle(channels.startStream, (event, raw: TextStreamInput) => service.startStream(raw, (payload) => {
    const channel = 'event' in payload ? channels.streamEvent : channels.streamComplete
    event.sender.send(channel, payload)
  }, event.sender.id))
  ipcMain.handle(channels.stopStream, (event, raw: unknown) => {
    const input = asRecord(raw)
    service.stopStream(requiredId(input.requestId, '流式请求标识缺失'), event.sender.id)
  })
  return () => {
    service.dispose()
    for (const channel of [channels.discover, channels.generate, channels.compact, channels.startStream, channels.stopStream]) ipcMain.removeHandler(channel)
  }
}

export { channels as modelIpcChannels }
