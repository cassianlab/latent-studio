import type { FetchImplementation, JsonObject, TextProvider } from './contracts'
import { errorFromResponse, errorFromThrown, TextModelError } from './errors'

export function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '')
}

export function joinEndpoint(baseUrl: string, endpoint: string): string {
  const base = trimTrailingSlashes(baseUrl.trim())
  const suffix = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${base}${suffix}`
}

export function endpointWithVersion(baseUrl: string, version: string, path: string): string {
  const base = trimTrailingSlashes(baseUrl.trim())
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  if (new RegExp(`/${version}$`, 'i').test(base)) return `${base}${normalizedPath}`
  return `${base}/${version}${normalizedPath}`
}

export function getFetch(fetchImplementation?: FetchImplementation): FetchImplementation {
  if (fetchImplementation) return fetchImplementation
  if (typeof globalThis.fetch !== 'function') throw new Error('当前运行时没有可用的 fetch')
  return globalThis.fetch.bind(globalThis)
}

export async function postJson(
  fetchImplementation: FetchImplementation,
  url: string,
  headers: Record<string, string>,
  body: JsonObject,
  provider: TextProvider,
  signal?: AbortSignal,
): Promise<Response> {
  let response: Response
  try {
    response = await fetchImplementation(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw errorFromThrown(error, provider, signal)
  }
  if (!response.ok) throw await errorFromResponse(response, provider)
  return response
}

export async function readJsonResponse(response: Response, provider: TextProvider): Promise<unknown> {
  let text = ''
  try {
    text = await response.text()
    if (!text.trim()) throw new Error('响应内容为空')
    return JSON.parse(text)
  } catch (error) {
    const sample = text ? text.slice(0, 150).replace(/[\r\n]+/g, ' ') : '空响应'
    throw new TextModelError('parse', `模型返回了无效 JSON: ${sample}`, { provider, cause: error })
  }
}
