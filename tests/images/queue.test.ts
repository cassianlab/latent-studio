import { describe, expect, it, vi } from 'vitest'
import { ImageModelError, ImageTaskQueue } from '../../src/main/images'
import type { ImageTaskExecutionContext } from '../../src/main/images'

const request = (model = 'image-test') => ({ model, prompt: '生成一张图' as const })

describe('image task queue', () => {
  it('enforces concurrency per connection while allowing other connections to run', async () => {
    const active = new Map<string, number>()
    const peak = new Map<string, number>()
    const resolvers: Array<() => void> = []
    const queue = new ImageTaskQueue({
      defaultMaxConcurrency: 1,
      execute: async (_request, context) => {
        const count = (active.get(context.connectionId) ?? 0) + 1
        active.set(context.connectionId, count)
        peak.set(context.connectionId, Math.max(peak.get(context.connectionId) ?? 0, count))
        await new Promise<void>((resolve) => resolvers.push(resolve))
        active.set(context.connectionId, count - 1)
        return { images: [{ b64Json: 'aA==' }] }
      },
    })
    queue.setConnectionConcurrency('connection-a', 2)
    const first = queue.enqueue({ connectionId: 'connection-a', request: request() })
    queue.enqueue({ connectionId: 'connection-a', request: request() })
    queue.enqueue({ connectionId: 'connection-a', request: request() })
    queue.enqueue({ connectionId: 'connection-b', request: request() })
    await Promise.resolve()
    await Promise.resolve()
    expect(peak.get('connection-a')).toBe(2)
    expect(peak.get('connection-b')).toBe(1)
    expect(queue.get(first.id)?.request).toEqual(request())
    while (resolvers.length) resolvers.shift()?.()
    for (let i = 0; i < 4; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      while (resolvers.length) resolvers.shift()?.()
    }
    expect(queue.list().filter((task) => task.status === 'completed')).toHaveLength(4)
  })

  it('preserves the concise task title separately from the full image prompt', () => {
    const queue = new ImageTaskQueue({ execute: async () => ({ images: [] }) })
    queue.pause()
    const prompt = '详细的生图提示词，包含人物、环境、构图、光线和色彩细节'

    const task = queue.enqueue({ connectionId: 'a', title: '雨夜街头人像', request: { model: 'image-test', prompt } })

    expect(task.title).toBe('雨夜街头人像')
    expect(task.request.prompt).toBe(prompt)
  })

  it('pauses new work, cancels pending work, and resumes the rest', async () => {
    let resolveRunning: (() => void) | undefined
    const queue = new ImageTaskQueue({
      execute: async (_request, context) => {
        await new Promise<void>((resolve) => {
          resolveRunning = resolve
          context.signal.addEventListener('abort', resolve, { once: true })
        })
        if (context.signal.aborted) throw new ImageModelError('cancelled', 'cancelled')
        return { images: [{ url: 'https://cdn.test/a.png' }] }
      },
    })
    queue.pause()
    const pending = queue.enqueue({ connectionId: 'connection-a', request: request() })
    expect(queue.get(pending.id)?.status).toBe('pending')
    queue.resume()
    await Promise.resolve()
    const second = queue.enqueue({ connectionId: 'connection-a', request: request() })
    expect(queue.cancel(second.id)).toBe(true)
    resolveRunning?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(queue.get(pending.id)?.status).toBe('completed')
    expect(queue.get(second.id)?.status).toBe('cancelled')
  })

  it('retries transient failures and keeps permanent failures independent', async () => {
    const attempts = new Map<string, number>()
    const queue = new ImageTaskQueue({
      retryDelayMs: 0,
      execute: async (_request, context: ImageTaskExecutionContext) => {
        const count = (attempts.get(context.taskId) ?? 0) + 1
        attempts.set(context.taskId, count)
        if (context.taskId === 'retry' && count === 1) throw new ImageModelError('network', 'temporary')
        if (context.taskId.endsWith('fail')) throw new ImageModelError('auth', 'denied')
        return { images: [{ b64Json: 'aA==' }] }
      },
    })
    const retry = queue.enqueue({ connectionId: 'a', request: request(), maxRetries: 1, id: 'retry' })
    const fail = queue.enqueue({ connectionId: 'a', request: request(), id: 'fail' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(queue.get(retry.id)).toMatchObject({ status: 'completed', attempts: 2 })
    expect(queue.get(fail.id)).toMatchObject({ status: 'failed', attempts: 1, error: { code: 'auth' } })
    expect(queue.retry(fail.id)).toBe(true)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(queue.get(fail.id)?.status).toBe('failed')
  })

  it('retries request timeouts but not validation failures', async () => {
    const attempts = new Map<string, number>()
    const queue = new ImageTaskQueue({
      retryDelayMs: 0,
      execute: async (_request, context) => {
        const count = (attempts.get(context.taskId) ?? 0) + 1
        attempts.set(context.taskId, count)
        if (context.taskId === 'timeout' && count === 1) throw new ImageModelError('invalid_request', 'request timeout', { status: 408 })
        if (context.taskId === 'invalid') throw new ImageModelError('invalid_request', 'unsupported size', { status: 400 })
        return { images: [{ b64Json: 'aA==' }] }
      },
    })

    queue.enqueue({ connectionId: 'a', request: request(), maxRetries: 1, id: 'timeout' })
    queue.enqueue({ connectionId: 'a', request: request(), maxRetries: 2, id: 'invalid' })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(queue.get('timeout')).toMatchObject({ status: 'completed', attempts: 2 })
    expect(queue.get('invalid')).toMatchObject({ status: 'failed', attempts: 1 })
  })

  it('uses increasing delays between repeated transient failures', async () => {
    vi.useFakeTimers()
    let releaseBlocker: (() => void) | undefined
    let retryAttempts = 0
    const queue = new ImageTaskQueue({
      defaultMaxConcurrency: 2,
      retryDelayMs: 1_000,
      execute: async (_request, context) => {
        if (context.taskId === 'retry-delay') {
          retryAttempts += 1
          if (retryAttempts <= 2) throw new ImageModelError('rate_limit', 'busy')
          return { images: [{ b64Json: 'aA==' }] }
        }
        await new Promise<void>((resolve) => { releaseBlocker = resolve })
        return { images: [{ b64Json: 'aA==' }] }
      },
    })

    try {
      queue.enqueue({ connectionId: 'a', request: request(), maxRetries: 2, id: 'retry-delay' })
      queue.enqueue({ connectionId: 'a', request: request(), id: 'blocker' })
      await Promise.resolve()
      await Promise.resolve()
      expect(retryAttempts).toBe(1)

      releaseBlocker?.()
      await Promise.resolve()
      await Promise.resolve()
      expect(retryAttempts).toBe(1)

      await vi.advanceTimersByTimeAsync(1_000)
      expect(retryAttempts).toBe(2)

      await vi.advanceTimersByTimeAsync(1_999)
      expect(retryAttempts).toBe(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(retryAttempts).toBe(3)
      expect(queue.get('retry-delay')).toMatchObject({ status: 'completed', attempts: 3 })
    } finally {
      vi.useRealTimers()
    }
  })
})
