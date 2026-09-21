import type { ImageErrorCode } from '../../shared/contracts/images'
import type { ProviderType } from '../../shared/contracts/settings'

export interface ImageModelErrorOptions {
  provider?: ProviderType
  status?: number
  retryAfterMs?: number
  requestId?: string
  cause?: unknown
}

export class ImageModelError extends Error {
  readonly code: ImageErrorCode
  readonly provider?: ProviderType
  readonly status?: number
  readonly retryAfterMs?: number
  readonly requestId?: string

  constructor(code: ImageErrorCode, message: string, options: ImageModelErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ImageModelError'
    this.code = code
    this.provider = options.provider
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.requestId = options.requestId
  }
}

export function isImageModelError(error: unknown): error is ImageModelError {
  return error instanceof ImageModelError
}

export function classifyImageHttpStatus(status: number): ImageErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 408 || status === 409 || status === 422) return 'invalid_request'
  if (status === 429) return 'rate_limit'
  if (status >= 400 && status < 500) return 'invalid_request'
  if (status >= 500) return 'server'
  return 'unknown'
}

export function parseImageRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - now)
}

function providerMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const root = payload as Record<string, unknown>
  const nested = root.error
  if (typeof nested === 'string') return nested
  if (nested && typeof nested === 'object' && typeof (nested as Record<string, unknown>).message === 'string') {
    return (nested as Record<string, string>).message
  }
  for (const key of ['message', 'detail', 'error_description']) {
    if (typeof root[key] === 'string') return root[key] as string
  }
  return undefined
}

function safeMessage(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/[\r\n]+/g, ' ').trim()
  return normalized ? normalized.slice(0, 500) : fallback
}

export async function imageErrorFromResponse(
  response: Response,
  provider: ProviderType,
): Promise<ImageModelError> {
  let payload: unknown
  try {
    const text = await response.text()
    payload = text ? JSON.parse(text) : undefined
  } catch {
    payload = undefined
  }
  const code = classifyImageHttpStatus(response.status)
  const fallback = `图片请求失败（HTTP ${response.status}）`
  const message = safeMessage(providerMessage(payload), fallback)
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined
  return new ImageModelError(code, message, {
    provider,
    status: response.status,
    requestId,
    retryAfterMs: parseImageRetryAfter(response.headers.get('retry-after')),
  })
}

export function imageErrorFromThrown(
  error: unknown,
  provider: ProviderType,
  signal?: AbortSignal,
): ImageModelError {
  if (error instanceof ImageModelError) return error
  if (signal?.aborted || error instanceof DOMException && error.name === 'AbortError') {
    return new ImageModelError('cancelled', '图片请求已取消', { provider, cause: error })
  }
  const message = error instanceof Error ? error.message : '网络请求失败'
  return new ImageModelError('network', safeMessage(message, '网络请求失败'), { provider, cause: error })
}

export function imageParseFailure(message: string, provider: ProviderType, cause?: unknown): ImageModelError {
  return new ImageModelError('parse', message, { provider, cause })
}
