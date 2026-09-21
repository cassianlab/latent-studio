import { describe, expect, it, vi } from 'vitest'
import { registerSingleInstanceGuard } from '../../src/main/app/single-instance'

describe('single instance guard', () => {
  it('quits a duplicate process before application startup', () => {
    const quit = vi.fn()
    const on = vi.fn()

    const acquired = registerSingleInstanceGuard({
      requestSingleInstanceLock: () => false,
      on,
      quit,
    }, () => [])

    expect(acquired).toBe(false)
    expect(quit).toHaveBeenCalledOnce()
    expect(on).not.toHaveBeenCalled()
  })

  it('restores and focuses the existing window when launched again', () => {
    const restore = vi.fn()
    const show = vi.fn()
    const focus = vi.fn()
    let handleSecondInstance: (() => void) | undefined

    const acquired = registerSingleInstanceGuard({
      requestSingleInstanceLock: () => true,
      on: (_event, listener) => { handleSecondInstance = listener },
      quit: vi.fn(),
    }, () => [{
      isDestroyed: () => false,
      isMinimized: () => true,
      restore,
      show,
      focus,
    }])

    expect(acquired).toBe(true)
    handleSecondInstance?.()
    expect(restore).toHaveBeenCalledOnce()
    expect(show).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledOnce()
  })
})
