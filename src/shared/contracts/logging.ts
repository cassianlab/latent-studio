export interface RuntimeLogEntry {
  level: 'error' | 'warn' | 'info'
  message: string
  timestamp: string
  source: 'error' | 'diagnostic'
  context?: Record<string, unknown>
}

export interface RuntimeLogsApi {
  list(): Promise<RuntimeLogEntry[]>
  recordError(input: { message: string; area: 'conversation' | 'renderer' }): Promise<void>
}

export const runtimeLogChannels = {
  list: 'runtime-logs:list',
  recordError: 'runtime-logs:record-error',
} as const
