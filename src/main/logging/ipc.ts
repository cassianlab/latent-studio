import { ipcMain } from 'electron'
import type { RuntimeLogEntry, RuntimeLogsApi } from '../../shared/contracts/logging'
import { runtimeLogChannels } from '../../shared/contracts/logging'
import type { ErrorLogger } from './error-log'

export function registerRuntimeLogIpc(errorLogger: ErrorLogger, diagnosticLogger: ErrorLogger): () => void {
  const api: RuntimeLogsApi = {
    list: async () => {
      const [errors, diagnostics] = await Promise.all([errorLogger.readRecent(), diagnosticLogger.readRecent()])
      return [
        ...errors.map((entry): RuntimeLogEntry => ({ ...entry, source: 'error' })),
        ...diagnostics.map((entry): RuntimeLogEntry => ({ ...entry, source: 'diagnostic' })),
      ].sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    },
    recordError: async (input) => {
      const message = typeof input?.message === 'string' ? input.message.trim().slice(0, 4_000) : ''
      const area = input?.area === 'conversation' ? 'conversation' : 'renderer'
      if (!message) return
      await errorLogger.log({ level: 'error', message, context: { area } })
    },
  }
  ipcMain.handle(runtimeLogChannels.list, () => api.list())
  ipcMain.handle(runtimeLogChannels.recordError, (_event, input) => api.recordError(input))
  return () => { for (const channel of Object.values(runtimeLogChannels)) ipcMain.removeHandler(channel) }
}
