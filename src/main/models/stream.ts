import type { TextProvider } from './contracts'
import { errorFromThrown, parseFailure } from './errors'

function parsePayload(text: string, provider: TextProvider): unknown[] {
  const trimmed = text.trim()
  if (!trimmed || trimmed === '[DONE]') return []
  try {
    const value = JSON.parse(trimmed) as unknown
    return Array.isArray(value) ? value : [value]
  } catch (error) {
    throw parseFailure('模型流返回了无效 JSON', provider, error)
  }
}

/** Parses both provider SSE (`data: {...}`) and newline-delimited JSON streams. */
export async function* parseJsonStream(
  response: Response,
  provider: TextProvider,
  signal?: AbortSignal,
): AsyncGenerator<unknown> {
  if (!response.body) {
    let text: string
    try {
      text = await response.text()
    } catch (error) {
      throw errorFromThrown(error, provider, signal)
    }
    for (const value of parsePayload(text, provider)) yield value
    return
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sseData: string[] = []
  let sawSse = false

  const flushSse = function* (): Generator<unknown> {
    if (!sseData.length) return
    const payload = sseData.join('\n')
    sseData = []
    for (const value of parsePayload(payload, provider)) yield value
  }

  const processLine = function* (line: string): Generator<unknown> {
    const normalized = line.endsWith('\r') ? line.slice(0, -1) : line
    if (normalized === '') {
      yield* flushSse()
      return
    }
    // SSE comment or metadata lines (event, id, retry)
    if (normalized.startsWith(':') || normalized.startsWith('event:') || normalized.startsWith('id:') || normalized.startsWith('retry:')) {
      sawSse = true
      return
    }
    if (normalized.startsWith('data:')) {
      sawSse = true
      const dataStr = normalized.slice(5).trimStart()
      if (dataStr === '[DONE]') return
      sseData.push(dataStr)
      return
    }
    const trimmed = normalized.trim()
    if (!sawSse && trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
      yield* parsePayload(trimmed, provider)
    }
  }

  try {
    while (true) {
      if (signal?.aborted) throw errorFromThrown(signal.reason ?? new DOMException('Aborted', 'AbortError'), provider, signal)
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        yield* processLine(line)
        newline = buffer.indexOf('\n')
      }
    }
    buffer += decoder.decode()
    if (buffer) yield* processLine(buffer)
    yield* flushSse()
  } catch (error) {
    try { void reader.cancel() } catch { /* cleanup must not replace the original error */ }
    throw errorFromThrown(error, provider, signal)
  }
}
