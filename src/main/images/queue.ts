import { randomUUID } from 'node:crypto'
import type {
  ImageModelResponse,
  ImageRequest,
  ImageTaskEvent,
  ImageTaskInput,
  ImageTaskRecord,
  SerializedImageError,
} from '../../shared/contracts/images'
import type { ImageErrorCode } from '../../shared/contracts/images'
import { conciseTaskTitle } from '../../shared/task-title'
import { ImageModelError, isImageModelError } from './errors'

export interface ImageTaskExecutionContext {
  taskId: string
  connectionId: string
  attempt: number
  signal: AbortSignal
}

export type ImageTaskExecutor = (
  request: ImageRequest,
  context: ImageTaskExecutionContext,
) => Promise<ImageModelResponse>

export interface ImageTaskQueueOptions {
  execute: ImageTaskExecutor
  defaultMaxConcurrency?: number
  maxConcurrencyByConnection?: Readonly<Record<string, number>>
  /** Allows tests and callers to provide a deterministic clock. */
  now?: () => string
  /** Delay before an eligible transient retry. Defaults to immediate retry. */
  retryDelayMs?: number
  onEvent?: (event: ImageTaskEvent) => void
}

export interface ImageTaskQueueState {
  paused: boolean
  pausedConnections: string[]
  tasks: ImageTaskRecord[]
}

interface InternalTask {
  record: ImageTaskRecord
  controller?: AbortController
  cancellationRequested: boolean
  pauseRequested: boolean
  deferred: boolean
}

type ExecutableImageRequest = ImageRequest & { signal?: AbortSignal }

const MAX_CONCURRENCY = 64
const MAX_RETRIES = 5
const MAX_RETRY_DELAY_MS = 60_000
const RETRYABLE_CODES: readonly ImageErrorCode[] = ['rate_limit', 'server', 'network']
const RETRYABLE_HTTP_STATUSES = new Set([408, 409])

function validConcurrency(value: number | undefined, fallback: number): number {
  const candidate = value ?? fallback
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > MAX_CONCURRENCY) {
    throw new RangeError(`图片连接并发数需要是 1-${MAX_CONCURRENCY} 的整数`)
  }
  return candidate
}

function validRetries(value: number | undefined): number {
  if (value === undefined) return 0
  if (!Number.isInteger(value) || value < 0 || value > MAX_RETRIES) {
    throw new RangeError(`图片任务重试次数需要是 0-${MAX_RETRIES} 的整数`)
  }
  return value
}

function errorCode(error: unknown): ImageErrorCode {
  if (isImageModelError(error)) return error.code
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  if (typeof code === 'string' && ['auth', 'rate_limit', 'invalid_request', 'not_found', 'server', 'network', 'cancelled', 'parse', 'unknown'].includes(code)) {
    return code as ImageErrorCode
  }
  return 'unknown'
}

function serializeError(error: unknown): SerializedImageError {
  if (isImageModelError(error)) {
    return {
      code: error.code,
      message: error.message,
      ...(error.provider ? { provider: error.provider } : {}),
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.requestId ? { requestId: error.requestId } : {}),
    }
  }
  const source = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : undefined
  return {
    code: errorCode(error),
    message: typeof source?.message === 'string' && source.message.trim() ? source.message.slice(0, 500) : '图片任务失败',
  }
}

function isRetryableFailure(error: unknown): boolean {
  if (RETRYABLE_CODES.includes(errorCode(error))) return true
  return isImageModelError(error) && error.status !== undefined && RETRYABLE_HTTP_STATUSES.has(error.status)
}

function publicRecord(task: InternalTask): ImageTaskRecord {
  // AbortSignal is an execution detail and must never be emitted as renderer data.
  const { signal: _signal, ...request } = task.record.request as ExecutableImageRequest
  return { ...task.record, request: request as ImageRequest }
}

export class ImageTaskQueue {
  private readonly execute: ImageTaskExecutor
  private readonly now: () => string
  private readonly retryDelayMs: number
  private readonly listener?: (event: ImageTaskEvent) => void
  private readonly tasks = new Map<string, InternalTask>()
  private readonly concurrency = new Map<string, number>()
  private readonly active = new Map<string, number>()
  private readonly pausedConnections = new Set<string>()
  private paused = false
  private pumping = false

  constructor(options: ImageTaskQueueOptions) {
    if (typeof options.execute !== 'function') throw new TypeError('图片队列需要执行器')
    this.execute = options.execute
    this.now = options.now ?? (() => new Date().toISOString())
    this.retryDelayMs = options.retryDelayMs ?? 0
    if (!Number.isInteger(this.retryDelayMs) || this.retryDelayMs < 0 || this.retryDelayMs > 60_000) {
      throw new RangeError('图片任务重试延迟需要是 0-60000 毫秒')
    }
    this.listener = options.onEvent
    this.defaultMaxConcurrency = validConcurrency(options.defaultMaxConcurrency, 1)
    for (const [connectionId, limit] of Object.entries(options.maxConcurrencyByConnection ?? {})) {
      this.concurrency.set(this.requireConnectionId(connectionId), validConcurrency(limit, this.defaultMaxConcurrency))
    }
  }

  private readonly defaultMaxConcurrency: number

  setConnectionConcurrency(connectionId: string, maxConcurrency: number): void {
    const id = this.requireConnectionId(connectionId)
    this.concurrency.set(id, validConcurrency(maxConcurrency, this.defaultMaxConcurrency))
    this.pump()
  }

  getConnectionConcurrency(connectionId: string): number {
    const id = this.requireConnectionId(connectionId)
    return this.concurrency.get(id) ?? this.defaultMaxConcurrency
  }

  enqueue(input: ImageTaskInput): ImageTaskRecord {
    const connectionId = this.requireConnectionId(input.connectionId)
    if (!input.request || typeof input.request !== 'object') throw new TypeError('图片任务请求无效')
    if (input.maxConcurrency !== undefined) this.setConnectionConcurrency(connectionId, input.maxConcurrency)
    const id = input.id?.trim() || randomUUID()
    if (this.tasks.has(id)) throw new Error(`图片任务已存在：${id}`)
    const maxRetries = validRetries(input.maxRetries)
    const timestamp = this.now()
    const record: ImageTaskRecord = {
      id,
      title: conciseTaskTitle(input.title || input.request.prompt, '图片生成任务'),
      connectionId,
      request: { ...input.request },
      status: 'pending',
      attempts: 0,
      maxRetries,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.tasks.set(id, { record, cancellationRequested: false, pauseRequested: false, deferred: input.deferUntilResume === true })
    this.emit({ type: 'created', task: publicRecord(this.tasks.get(id) as InternalTask) })
    if (!this.tasks.get(id)?.deferred) this.pump()
    return publicRecord(this.tasks.get(id) as InternalTask)
  }

  get(taskId: string): ImageTaskRecord | undefined {
    const task = this.tasks.get(taskId)
    return task ? publicRecord(task) : undefined
  }

  list(): ImageTaskRecord[] {
    return [...this.tasks.values()].map(publicRecord)
  }

  state(): ImageTaskQueueState {
    return {
      paused: this.paused,
      pausedConnections: [...this.pausedConnections],
      tasks: this.list(),
    }
  }

  pause(connectionId?: string): void {
    if (connectionId === undefined) this.paused = true
    else this.pausedConnections.add(this.requireConnectionId(connectionId))
  }

  resume(connectionId?: string): void {
    if (connectionId === undefined) this.paused = false
    else this.pausedConnections.delete(this.requireConnectionId(connectionId))
    for (const task of this.tasks.values()) {
      if (task.deferred && (connectionId === undefined || task.record.connectionId === connectionId)) {
        task.deferred = false
      }
    }
    this.pump()
  }

  cancel(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || ['completed', 'failed', 'cancelled'].includes(task.record.status)) return false
    task.cancellationRequested = true
    task.pauseRequested = false
    if (task.record.status === 'pending') {
      this.transition(task, 'cancelled')
      return true
    }
    task.controller?.abort()
    return true
  }

  retry(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || !['failed', 'cancelled'].includes(task.record.status)) return false
    task.cancellationRequested = false
    task.pauseRequested = false
    task.deferred = false
    task.controller = undefined
    task.record.result = undefined
    task.record.error = undefined
    this.transition(task, 'pending')
    this.pump()
    return true
  }

  remove(taskId: string): boolean {
    const task = this.tasks.get(taskId)
    if (!task || task.record.status === 'running') return false
    return this.tasks.delete(taskId)
  }

  dispose(): void {
    for (const task of this.tasks.values()) {
      if (task.record.status === 'running') {
        task.cancellationRequested = true
        task.controller?.abort()
      } else if (task.record.status === 'pending') {
        this.transition(task, 'cancelled')
      }
    }
    this.paused = true
  }

  private requireConnectionId(value: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('图片任务连接标识不能为空')
    return value.trim()
  }

  private emit(event: ImageTaskEvent): void {
    try { this.listener?.(event) } catch { /* observer failures must not stop scheduling */ }
  }

  private transition(task: InternalTask, status: ImageTaskRecord['status']): void {
    task.record.status = status
    task.record.updatedAt = this.now()
    this.emit({ type: status, task: publicRecord(task) })
  }

  private isPaused(connectionId: string): boolean {
    return this.paused || this.pausedConnections.has(connectionId)
  }

  private pump(): void {
    if (this.pumping || this.paused) return
    this.pumping = true
    try {
      for (const task of this.tasks.values()) {
        if (task.record.status !== 'pending' || task.deferred || this.isPaused(task.record.connectionId)) continue
        const connectionId = task.record.connectionId
        const running = this.active.get(connectionId) ?? 0
        if (running >= this.getConnectionConcurrency(connectionId)) continue
        void this.run(task)
      }
    } finally {
      this.pumping = false
    }
  }

  private async run(task: InternalTask): Promise<void> {
    if (task.record.status !== 'pending' || this.isPaused(task.record.connectionId)) return
    const controller = new AbortController()
    task.controller = controller
    task.record.attempts += 1
    this.active.set(task.record.connectionId, (this.active.get(task.record.connectionId) ?? 0) + 1)
    this.transition(task, 'running')
    let slotReleased = false
    try {
      const request = { ...task.record.request, signal: controller.signal } as ExecutableImageRequest
      const result = await this.execute(request, {
        taskId: task.record.id,
        connectionId: task.record.connectionId,
        attempt: task.record.attempts,
        signal: controller.signal,
      })
      if (task.cancellationRequested || controller.signal.aborted) {
        this.transition(task, 'cancelled')
      } else {
        task.record.result = result
        task.record.error = undefined
        this.transition(task, 'completed')
      }
    } catch (error) {
      const cancelled = task.cancellationRequested || controller.signal.aborted || errorCode(error) === 'cancelled'
      if (cancelled) {
        task.record.error = serializeError(new ImageModelError('cancelled', '图片任务已取消'))
        this.transition(task, 'cancelled')
      } else if (isRetryableFailure(error) && task.record.attempts <= task.record.maxRetries) {
        task.record.error = serializeError(error)
        task.deferred = true
        this.transition(task, 'pending')
        this.releaseSlot(task.record.connectionId)
        slotReleased = true
        const fallbackDelayMs = Math.min(this.retryDelayMs * (2 ** Math.max(0, task.record.attempts - 1)), MAX_RETRY_DELAY_MS)
        const delayMs = isImageModelError(error) && error.retryAfterMs !== undefined ? Math.max(0, Math.min(error.retryAfterMs, MAX_RETRY_DELAY_MS)) : fallbackDelayMs
        this.emit({ type: 'retrying', task: publicRecord(task), delayMs })
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
        if (task.record.status === 'pending' && !task.cancellationRequested) {
          task.deferred = false
          this.pump()
        }
      } else {
        task.record.error = serializeError(error)
        this.transition(task, 'failed')
      }
    } finally {
      task.controller = undefined
      if (!slotReleased) this.releaseSlot(task.record.connectionId)
      this.pump()
    }
  }

  private releaseSlot(connectionId: string): void {
    const active = this.active.get(connectionId) ?? 1
    if (active <= 1) this.active.delete(connectionId)
    else this.active.set(connectionId, active - 1)
  }
}

export function createImageTaskQueue(options: ImageTaskQueueOptions): ImageTaskQueue {
  return new ImageTaskQueue(options)
}
