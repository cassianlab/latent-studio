import { afterEach, describe, expect, it, vi } from 'vitest'

const electronMock = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  electron: {
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) => electronMock.handlers.set(channel, handler),
      removeHandler: (channel: string) => electronMock.handlers.delete(channel),
    },
  },
}))

vi.mock('electron', () => electronMock.electron)

const { registerRuntimeLogIpc } = await import('../../src/main/logging/ipc')

afterEach(() => electronMock.handlers.clear())

describe('runtime log IPC', () => {
  it('registers list and record handlers and removes both during cleanup', async () => {
    const log = vi.fn().mockResolvedValue(undefined)
    const unregister = registerRuntimeLogIpc({
      readRecent: vi.fn().mockResolvedValue([{ level: 'error', message: '较早错误', timestamp: '2026-09-19T12:00:00.000Z' }]),
      log,
    } as never, {
      readRecent: vi.fn().mockResolvedValue([{ level: 'info', message: '较新诊断', timestamp: '2026-09-19T13:00:00.000Z' }]),
    } as never)

    expect([...electronMock.handlers.keys()]).toEqual(['runtime-logs:list', 'runtime-logs:record-error'])
    await expect(electronMock.handlers.get('runtime-logs:list')?.({})).resolves.toEqual([
      expect.objectContaining({ message: '较新诊断', source: 'diagnostic' }),
      expect.objectContaining({ message: '较早错误', source: 'error' }),
    ])

    await electronMock.handlers.get('runtime-logs:record-error')?.({}, { message: '渲染失败', area: 'conversation' })
    expect(log).toHaveBeenCalledWith({ level: 'error', message: '渲染失败', context: { area: 'conversation' } })

    unregister()
    expect(electronMock.handlers.size).toBe(0)
  })
})
