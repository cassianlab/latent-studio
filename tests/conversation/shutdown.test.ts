import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createConversationShutdownCoordinator } from '../../src/main/conversation/shutdown'

class FakeApp extends EventEmitter {
  quitCalls = 0

  requestQuit(): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    this.emit('before-quit', event)
    return event
  }

  quit(): void {
    this.quitCalls += 1
    this.emit('before-quit', { preventDefault: vi.fn() })
  }
}

class FakeWindow extends EventEmitter {
  closeCalls = 0
  destroyed = false

  requestClose(): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    this.emit('close', event)
    return event
  }

  close(): void {
    this.closeCalls += 1
    this.emit('close', { preventDefault: vi.fn() })
  }

  isDestroyed(): boolean { return this.destroyed }
}

describe('conversation shutdown coordinator', () => {
  it('waits for the renderer session queue before allowing a window to close', async () => {
    let release: (() => void) | undefined
    const flush = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const app = new FakeApp()
    const window = new FakeWindow()
    const coordinator = createConversationShutdownCoordinator({ app, requestFlush: flush, finalize: vi.fn(), timeoutMs: 1_000 })
    coordinator.guardWindow(window)

    const event = window.requestClose()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(window.closeCalls).toBe(0)

    release?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(flush).toHaveBeenCalledExactlyOnceWith(window)
    expect(window.closeCalls).toBe(1)
    coordinator.dispose()
  })

  it('flushes once, finalizes storage, and then re-enters quit without an infinite loop', async () => {
    let release: (() => void) | undefined
    const flush = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const finalize = vi.fn()
    const app = new FakeApp()
    const window = new FakeWindow()
    const coordinator = createConversationShutdownCoordinator({ app, requestFlush: flush, finalize, timeoutMs: 1_000 })
    coordinator.guardWindow(window)

    const event = app.requestQuit()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(finalize).not.toHaveBeenCalled()

    release?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(flush).toHaveBeenCalledOnce()
    expect(finalize).toHaveBeenCalledOnce()
    expect(app.quitCalls).toBe(1)
    coordinator.dispose()
  })

  it('shares one flush when a window close and app quit overlap', async () => {
    let release: (() => void) | undefined
    const flush = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const finalize = vi.fn()
    const app = new FakeApp()
    const window = new FakeWindow()
    const coordinator = createConversationShutdownCoordinator({ app, requestFlush: flush, finalize, timeoutMs: 1_000 })
    coordinator.guardWindow(window)

    const closeEvent = window.requestClose()
    const quitEvent = app.requestQuit()

    expect(closeEvent.preventDefault).toHaveBeenCalledOnce()
    expect(quitEvent.preventDefault).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()

    release?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(window.closeCalls).toBe(0)
    expect(finalize).toHaveBeenCalledOnce()
    expect(app.quitCalls).toBe(1)
    coordinator.dispose()
  })

  it('keeps the window open when conversation persistence fails and allows a later retry', async () => {
    let shouldFail = true
    const flush = vi.fn(async () => {
      if (shouldFail) throw new Error('disk full')
    })
    const onFlushFailure = vi.fn()
    const app = new FakeApp()
    const window = new FakeWindow()
    const coordinator = createConversationShutdownCoordinator({ app, requestFlush: flush, finalize: vi.fn(), timeoutMs: 1_000, onFlushFailure })
    coordinator.guardWindow(window)

    window.requestClose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onFlushFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk full' }))
    expect(window.closeCalls).toBe(0)

    shouldFail = false
    window.requestClose()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(window.closeCalls).toBe(1)
    coordinator.dispose()
  })

  it('cancels quitting after a failed flush so the user can retry without losing data', async () => {
    const flush = vi.fn()
      .mockRejectedValueOnce(new Error('database busy'))
      .mockResolvedValueOnce(undefined)
    const finalize = vi.fn()
    const app = new FakeApp()
    const window = new FakeWindow()
    const coordinator = createConversationShutdownCoordinator({ app, requestFlush: flush, finalize, timeoutMs: 1_000 })
    coordinator.guardWindow(window)

    app.requestQuit()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(finalize).not.toHaveBeenCalled()
    expect(app.quitCalls).toBe(0)

    app.requestQuit()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(flush).toHaveBeenCalledTimes(2)
    expect(finalize).toHaveBeenCalledOnce()
    expect(app.quitCalls).toBe(1)
    coordinator.dispose()
  })

  it('keeps the window open when the renderer flush times out', async () => {
    vi.useFakeTimers()
    try {
      const onFlushFailure = vi.fn()
      const app = new FakeApp()
      const window = new FakeWindow()
      const coordinator = createConversationShutdownCoordinator({
        app,
        requestFlush: () => new Promise<void>(() => {}),
        finalize: vi.fn(),
        timeoutMs: 50,
        onFlushFailure,
      })
      coordinator.guardWindow(window)

      window.requestClose()
      await vi.advanceTimersByTimeAsync(50)

      expect(onFlushFailure).toHaveBeenCalledWith(expect.objectContaining({ message: '退出前保存对话超时' }))
      expect(window.closeCalls).toBe(0)
      coordinator.dispose()
    } finally {
      vi.useRealTimers()
    }
  })
})
