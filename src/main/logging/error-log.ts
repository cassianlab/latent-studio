import { dirname } from 'node:path'
import { promises as nodeFs } from 'node:fs'

export interface ErrorLogFileSystem {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  unlink(path: string): Promise<void>
}

export const errorLogFileSystem: ErrorLogFileSystem = nodeFs

const SENSITIVE_KEY = /^(authorization|apikey|token|password)$/i
const UNIX_ABSOLUTE_PATH = /(?:^|[\s("'=])\/(?:Users|private|tmp|var|home|Volumes|opt|Applications)\/[^\s)'"`,;]*/g
const GENERIC_UNIX_ABSOLUTE_PATH = /(?:^|[\s("'=])\/(?:[^/\s]+\/)+[^\s)'"`,;]*/g
const WINDOWS_ABSOLUTE_PATH = /\b[A-Za-z]:\\[^\s)'"`,;]*/g

function redactString(value: string): string {
  return value.replace(UNIX_ABSOLUTE_PATH, (match) => match.startsWith('/') ? '[REDACTED_PATH]' : `${match[0]}[REDACTED_PATH]`)
    .replace(GENERIC_UNIX_ABSOLUTE_PATH, (match) => match.startsWith('/') ? '[REDACTED_PATH]' : `${match[0]}[REDACTED_PATH]`)
    .replace(WINDOWS_ABSOLUTE_PATH, '[REDACTED_PATH]')
}

export function sanitizeLogValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY.test(key.replace(/[\-_]/g, ''))) return '[REDACTED]'
  if (typeof value === 'string') return redactString(value)
  if (value instanceof Error) return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined }
  if (Array.isArray(value)) return value.map((item) => sanitizeLogValue(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeLogValue(entryValue, entryKey)]))
  }
  return value
}

export const redactSensitiveData = sanitizeLogValue

export interface ErrorLogEntry {
  level: 'error' | 'warn' | 'info'
  message: string
  context?: Record<string, unknown>
  timestamp?: string
}

export interface StoredErrorLogEntry extends ErrorLogEntry {
  timestamp: string
}

const LOG_RETENTION_MS = 48 * 60 * 60 * 1000

export class ErrorLogger {
  constructor(
    private readonly logPath: string,
    private readonly fs: ErrorLogFileSystem = errorLogFileSystem,
    private readonly maxBytes = 1024 * 1024,
  ) {}

  async log(entry: ErrorLogEntry): Promise<void> {
    const safeEntry = sanitizeLogValue({ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() }) as ErrorLogEntry
    const line = `${JSON.stringify(safeEntry)}\n`
    const previous = await this.readFile()
    const retained = this.parseRecent(previous, Date.now())
    const content = this.bound(`${retained.map((item) => JSON.stringify(item)).join('\n')}${retained.length ? '\n' : ''}${line}`)
    await this.writeAtomic(content)
  }

  async readRecent(now = new Date()): Promise<StoredErrorLogEntry[]> {
    const previous = await this.readFile()
    const retained = this.parseRecent(previous, now.getTime())
    const content = retained.length ? `${retained.map((item) => JSON.stringify(item)).join('\n')}\n` : ''
    if (content !== previous) await this.writeAtomic(content)
    return retained
  }

  private async readFile(): Promise<string> {
    try { return await this.fs.readFile(this.logPath, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return ''
    }
  }

  private parseRecent(content: string, now: number): StoredErrorLogEntry[] {
    const cutoff = now - LOG_RETENTION_MS
    const records: StoredErrorLogEntry[] = []
    for (const line of content.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as StoredErrorLogEntry
        const timestamp = Date.parse(parsed.timestamp)
        if (Number.isFinite(timestamp) && timestamp >= cutoff && timestamp <= now + 60_000) records.push(parsed)
      } catch { /* discard malformed records while pruning */ }
    }
    return records
  }

  private async writeAtomic(content: string): Promise<void> {
    await this.fs.mkdir(dirname(this.logPath), { recursive: true })
    const temporaryPath = `${this.logPath}.${process.pid}.${Date.now()}.tmp`
    try {
      await this.fs.writeFile(temporaryPath, content, 'utf8')
      await this.fs.rename(temporaryPath, this.logPath)
    } catch (error) {
      try { await this.fs.unlink(temporaryPath) } catch { /* preserve original error */ }
      throw error
    }
  }

  async logError(error: unknown, context: Record<string, unknown> = {}): Promise<void> {
    const message = error instanceof Error ? error.message : String(error)
    await this.log({ level: 'error', message, context })
  }

  private bound(content: string): string {
    if (Buffer.byteLength(content, 'utf8') <= this.maxBytes) return content
    const lines = content.split('\n').filter(Boolean)
    let result = ''
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = `${lines[index]}\n${result}`
      if (Buffer.byteLength(candidate, 'utf8') > this.maxBytes) break
      result = candidate
    }
    return result
  }
}

export const createErrorLogger = (logPath: string, fs?: ErrorLogFileSystem, maxBytes?: number): ErrorLogger => new ErrorLogger(logPath, fs, maxBytes)
