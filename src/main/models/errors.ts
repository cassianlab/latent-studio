import type { TextProvider } from './contracts'

export type TextModelErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'not_found'
  | 'server'
  | 'network'
  | 'cancelled'
  | 'parse'
  | 'unknown'

export interface TextModelErrorOptions {
  provider?: TextProvider
  status?: number
  retryAfterMs?: number
  requestId?: string
  details?: unknown
  cause?: unknown
}

export class TextModelError extends Error {
  readonly code: TextModelErrorCode
  readonly provider?: TextProvider
  readonly status?: number
  readonly retryAfterMs?: number
  readonly requestId?: string
  readonly details?: unknown

  constructor(code: TextModelErrorCode, message: string, options: TextModelErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'TextModelError'
    this.code = code
    this.provider = options.provider
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.requestId = options.requestId
    this.details = options.details
  }
}

export function isTextModelError(error: unknown): error is TextModelError {
  return error instanceof TextModelError
}

export function classifyHttpStatus(status: number): TextModelErrorCode {
  if (status === 401 || status === 403) return 'auth'
  if (status === 404) return 'not_found'
  if (status === 408 || status === 409 || status === 422) return 'invalid_request'
  if (status === 429) return 'rate_limit'
  if (status >= 400 && status < 500) return 'invalid_request'
  if (status >= 500) return 'server'
  return 'unknown'
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const timestamp = Date.parse(value)
  if (!Number.isNaN(timestamp)) return Math.max(0, timestamp - now)
  return undefined
}

function providerMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const root = payload as Record<string, unknown>
  const error = root.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
    return (error as Record<string, unknown>).message as string
  }
  for (const key of ['message', 'detail', 'error_description']) {
    if (typeof root[key] === 'string') return root[key] as string
  }
  return undefined
}

function safeMessage(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/[\r\n]+/g, ' ').trim()
  if (!normalized) return fallback
  return normalized.slice(0, 500)
}

export async function errorFromResponse(
  response: Response,
  provider: TextProvider,
): Promise<TextModelError> {
  let payload: unknown
  try {
    const text = await response.text()
    payload = text ? JSON.parse(text) : undefined
  } catch {
    payload = undefined
  }
  const code = classifyHttpStatus(response.status)
  const fallback = code === 'auth' ? 'API Key 无效或已过期' : `模型请求失败（HTTP ${response.status}）`
  const message = safeMessage(providerMessage(payload), fallback)
  const requestId = response.headers.get('x-request-id') ?? response.headers.get('request-id') ?? undefined
  return new TextModelError(code, message, {
    provider,
    status: response.status,
    requestId,
    retryAfterMs: parseRetryAfter(response.headers.get('retry-after')),
    details: payload,
  })
}

export function errorFromThrown(
  error: unknown,
  provider: TextProvider,
  signal?: AbortSignal,
): TextModelError {
  if (error instanceof TextModelError) return error
  if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
    return new TextModelError('cancelled', '模型请求已取消', { provider, cause: error })
  }
  const message = error instanceof Error ? error.message : '网络请求失败'
  return new TextModelError('network', safeMessage(message, '网络请求失败'), { provider, cause: error })
}

export function parseFailure(message: string, provider: TextProvider, cause?: unknown): TextModelError {
  return new TextModelError('parse', message, { provider, cause })
}
