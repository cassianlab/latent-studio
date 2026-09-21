import { describe, expect, it, vi } from 'vitest'
import { createAsyncActionLock } from '../../src/components/ai-input-bar/async-action-lock'

describe('async action lock', () => {
  it('rejects a second action while the first action is still running', async () => {
    let release: (() => void) | undefined
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve }))
    const lock = createAsyncActionLock()

    const first = lock.run(action)
    await expect(lock.run(action)).resolves.toBe(false)

    expect(action).toHaveBeenCalledOnce()
    release?.()
    await expect(first).resolves.toBe(true)
  })

  it('allows another action after either success or failure', async () => {
    const lock = createAsyncActionLock()

    await expect(lock.run(async () => undefined)).resolves.toBe(true)
    await expect(lock.run(async () => { throw new Error('failed') })).rejects.toThrow('failed')
    await expect(lock.run(async () => undefined)).resolves.toBe(true)
  })
})
