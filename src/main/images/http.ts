import type { FetchImplementation } from '../models/contracts'
import type { JsonObject } from '../models/contracts'
import type { ProviderType } from '../../shared/contracts/settings'
import { imageErrorFromResponse, imageErrorFromThrown, imageParseFailure } from './errors'

export function imageFetch(fetchImplementation?: FetchImplementation): FetchImplementation {
  if (fetchImplementation) return fetchImplementation
  if (typeof globalThis.fetch !== 'function') throw new Error('当前运行时没有可用的 fetch')
  return globalThis.fetch.bind(globalThis)
}

export function imageEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  const suffix = path.startsWith('/') ? path : `/${path}`
  return /\/v\d+(?:beta\d*)?$/i.test(base) ? `${base}${suffix}` : `${base}/v1${suffix}`
}

export async function imagePostJson(
  fetchImplementation: FetchImplementation,
  url: string,
  headers: Record<string, string>,
  body: JsonObject,
  provider: ProviderType,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const response = await fetchImplementation(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) throw await imageErrorFromResponse(response, provider)
    return response
  } catch (error) {
    throw imageErrorFromThrown(error, provider, signal)
  }
}

export async function imagePostMultipart(
  fetchImplementation: FetchImplementation,
  url: string,
  headers: Record<string, string>,
  body: FormData,
  provider: ProviderType,
  signal?: AbortSignal,
): Promise<Response> {
  try {
    const response = await fetchImplementation(url, { method: 'POST', headers, body, signal })
    if (!response.ok) throw await imageErrorFromResponse(response, provider)
    return response
  } catch (error) {
    throw imageErrorFromThrown(error, provider, signal)
  }
}

export async function imageReadJson(response: Response, provider: ProviderType): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw imageParseFailure('图片服务返回了无效 JSON', provider, error)
  }
}
