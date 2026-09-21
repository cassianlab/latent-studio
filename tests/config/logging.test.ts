import { describe, expect, it } from 'vitest'
import { ErrorLogger, sanitizeLogValue, type ErrorLogFileSystem } from '../../src/main/logging/error-log'

describe('error logging', () => {
  it('redacts credentials and absolute paths recursively', () => {
    expect(sanitizeLogValue({ apiKey: 'secret', nested: { Authorization: 'Bearer token' }, file: '/Users/example/private.txt' })).toEqual({ apiKey: '[REDACTED]', nested: { Authorization: '[REDACTED]' }, file: '[REDACTED_PATH]' })
  })

  it('writes sanitized logs atomically and keeps the file bounded', async () => {
    let content = ''
    const writes: string[] = []
    const fs: ErrorLogFileSystem = {
      mkdir: async () => undefined,
      readFile: async () => content,
      writeFile: async (_path, data) => { writes.push(data); content = data },
      rename: async (_oldPath, newPath) => { expect(newPath).toBe('/tmp/error.log') },
      unlink: async () => undefined,
    }
    const logger = new ErrorLogger('/tmp/error.log', fs, 180)
    await logger.log({ level: 'error', message: 'failed /Users/example/a', context: { token: 'secret' }, timestamp: '2026-01-01T00:00:00.000Z' })
    expect(writes[0]).not.toContain('secret')
    expect(writes[0]).not.toContain('/Users/example')
    expect(Buffer.byteLength(writes[0], 'utf8')).toBeLessThanOrEqual(180)
  })

  it('returns only records from the last 48 hours and rewrites expired entries', async () => {
    let content = [
      JSON.stringify({ level: 'warn', message: 'expired', timestamp: '2026-09-16T11:00:00.000Z' }),
      JSON.stringify({ level: 'info', message: 'recent', timestamp: '2026-09-19T10:00:00.000Z' }),
      '',
    ].join('\n')
    const fs: ErrorLogFileSystem = {
      mkdir: async () => undefined,
      readFile: async () => content,
      writeFile: async (_path, data) => { content = data },
      rename: async () => undefined,
      unlink: async () => undefined,
    }
    const logger = new ErrorLogger('/tmp/error.log', fs)

    await expect(logger.readRecent(new Date('2026-09-19T11:00:00.000Z'))).resolves.toEqual([
      expect.objectContaining({ message: 'recent' }),
    ])
    expect(content).not.toContain('expired')
  })
})
