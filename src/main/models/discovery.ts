import type {
  ModelCapability,
  ModelDiscoveryCandidate,
  ModelDiscoveryProtocol,
  ModelDiscoveryResult,
} from '../../shared/contracts/models'
import type { FetchImplementation, TextProvider } from './contracts'
import { endpointWithVersion, getFetch } from './http'
import { errorFromResponse, errorFromThrown, parseFailure, TextModelError } from './errors'

export interface ModelDiscoveryRequest {
  providerType: TextProvider
  baseUrl: string
  apiKey: string
  fetch?: FetchImplementation
  headers?: Record<string, string>
  signal?: AbortSignal
  pageToken?: string
  /** Capabilities explicitly supplied by the protocol adapter, never inferred from an id. */
  adapterCapabilities?: readonly ModelCapability[]
}

interface ParsedModelList {
  models: ModelDiscoveryCandidate[]
  nextPageToken?: string
}

type ModelRecord = Record<string, unknown>

const OPENAI_PROTOCOL: ModelDiscoveryProtocol = 'openai.models'
const ANTHROPIC_PROTOCOL: ModelDiscoveryProtocol = 'anthropic.models'
const GEMINI_PROTOCOL: ModelDiscoveryProtocol = 'gemini.models'

function asRecord(value: unknown): ModelRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ModelRecord : undefined
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text || undefined
}

function uniqueCapabilities(values: readonly ModelCapability[] | undefined): ModelCapability[] {
  return [...new Set(values ?? [])]
}

function candidate(
  providerType: TextProvider,
  id: string,
  options: { displayName?: string; description?: string; providerModelName?: string },
  capabilities: readonly ModelCapability[] | undefined,
): ModelDiscoveryCandidate {
  const normalizedId = id.trim()
  const declared = capabilities !== undefined
  return {
    id: normalizedId,
    displayName: options.displayName?.trim() || normalizedId,
    ...(options.description?.trim() ? { description: options.description.trim() } : {}),
    providerType,
    ...(options.providerModelName ? { providerModelName: options.providerModelName } : {}),
    capabilities: uniqueCapabilities(capabilities),
    capabilitySource: declared ? 'adapter' : 'unconfirmed',
  }
}

function deduplicate(models: ModelDiscoveryCandidate[]): ModelDiscoveryCandidate[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (seen.has(model.id)) return false
    seen.add(model.id)
    return true
  })
}

function parseOpenAIModels(providerType: TextProvider, payload: unknown, capabilities?: readonly ModelCapability[]): ParsedModelList {
  const root = asRecord(payload)
  const rawModels = root && (Array.isArray(root.data) ? root.data : Array.isArray(root.models) ? root.models : undefined)
  if (!rawModels) throw parseFailure('模型列表返回结构无效', providerType)
  const models = rawModels.flatMap((raw): ModelDiscoveryCandidate[] => {
    const item = asRecord(raw)
    const id = asText(item?.id)
    if (!id) return []
    return [candidate(providerType, id, { displayName: asText(item?.name) ?? id }, capabilities)]
  })
  const nextPageToken = root?.has_more === true ? asText(root.last_id) : undefined
  return { models: deduplicate(models), ...(nextPageToken ? { nextPageToken } : {}) }
}

function parseAnthropicModels(providerType: TextProvider, payload: unknown, capabilities?: readonly ModelCapability[]): ParsedModelList {
  const root = asRecord(payload)
  if (!root || !Array.isArray(root.data)) throw parseFailure('Anthropic 模型列表返回结构无效', providerType)
  const models = root.data.flatMap((raw): ModelDiscoveryCandidate[] => {
    const item = asRecord(raw)
    const id = asText(item?.id)
    if (!id) return []
    return [candidate(providerType, id, { displayName: asText(item?.display_name) ?? id }, capabilities)]
  })
  const nextPageToken = root.has_more === true ? asText(root.last_id) : undefined
  return { models: deduplicate(models), ...(nextPageToken ? { nextPageToken } : {}) }
}

function parseGeminiModels(providerType: TextProvider, payload: unknown, capabilities?: readonly ModelCapability[]): ParsedModelList {
  const root = asRecord(payload)
  if (!root || !Array.isArray(root.models)) throw parseFailure('Gemini 模型列表返回结构无效', providerType)
  const models = root.models.flatMap((raw): ModelDiscoveryCandidate[] => {
    const item = asRecord(raw)
    const providerModelName = asText(item?.name)
    if (!providerModelName) return []
    const id = providerModelName.replace(/^models\//, '')
    if (!id) return []
    return [candidate(providerType, id, {
      displayName: asText(item?.displayName) ?? id,
      description: asText(item?.description),
      providerModelName,
    }, capabilities)]
  })
  const nextPageToken = asText(root.nextPageToken)
  return { models: deduplicate(models), ...(nextPageToken ? { nextPageToken } : {}) }
}

function appendQuery(url: string, values: Record<string, string | undefined>): string {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) parsed.searchParams.set(key, value)
  }
  return parsed.toString()
}

function providerProtocol(providerType: TextProvider): ModelDiscoveryProtocol {
  if (providerType === 'anthropic') return ANTHROPIC_PROTOCOL
  if (providerType === 'gemini') return GEMINI_PROTOCOL
  if (['openai', 'deepseek', 'glm', 'kimi', 'openai-compatible'].includes(providerType)) return OPENAI_PROTOCOL
  throw new TextModelError('invalid_request', '不支持的模型列表协议', { provider: providerType })
}

function requestUrl(request: ModelDiscoveryRequest, protocol: ModelDiscoveryProtocol): string {
  if (protocol === GEMINI_PROTOCOL) {
    return appendQuery(endpointWithVersion(request.baseUrl, 'v1beta', '/models'), {
      key: request.apiKey,
      pageToken: request.pageToken,
    })
  }
  return appendQuery(endpointWithVersion(request.baseUrl, 'v1', '/models'), protocol === ANTHROPIC_PROTOCOL
    ? { after_id: request.pageToken }
    : { after: request.pageToken })
}

function requestHeaders(request: ModelDiscoveryRequest, protocol: ModelDiscoveryProtocol): Record<string, string> {
  const auth: Record<string, string> = protocol === ANTHROPIC_PROTOCOL
    ? { 'x-api-key': request.apiKey, 'anthropic-version': '2023-06-01' }
    : { authorization: `Bearer ${request.apiKey}` }
  return { accept: 'application/json', ...auth, ...(request.headers ?? {}) }
}

async function fetchJson(request: ModelDiscoveryRequest, url: string, protocol: ModelDiscoveryProtocol): Promise<unknown> {
  const fetchImplementation = getFetch(request.fetch)
  if (!request.apiKey.trim()) throw new TextModelError('invalid_request', '模型列表发现需要 API Key', { provider: request.providerType })
  if (request.signal?.aborted) throw new TextModelError('cancelled', '模型列表请求已取消', { provider: request.providerType })
  let response: Response
  try {
    response = await fetchImplementation(url, {
      method: 'GET',
      headers: requestHeaders(request, protocol),
      signal: request.signal,
    })
  } catch (error) {
    throw errorFromThrown(error, request.providerType, request.signal)
  }
  if (!response.ok) throw await errorFromResponse(response, request.providerType)
  try {
    return await response.json()
  } catch (error) {
    throw parseFailure('模型列表返回了无效 JSON', request.providerType, error)
  }
}

export async function discoverModels(request: ModelDiscoveryRequest): Promise<ModelDiscoveryResult> {
  const protocol = providerProtocol(request.providerType)
  const payload = await fetchJson(request, requestUrl(request, protocol), protocol)
  const parsed = protocol === ANTHROPIC_PROTOCOL
    ? parseAnthropicModels(request.providerType, payload, request.adapterCapabilities)
    : protocol === GEMINI_PROTOCOL
      ? parseGeminiModels(request.providerType, payload, request.adapterCapabilities)
      : parseOpenAIModels(request.providerType, payload, request.adapterCapabilities)
  return {
    providerType: request.providerType,
    protocol,
    models: parsed.models,
    ...(parsed.nextPageToken ? { nextPageToken: parsed.nextPageToken } : {}),
    fetchedAt: new Date().toISOString(),
  }
}

/** Applies a user capability confirmation without inferring anything from the model id. */
export function confirmModelCapabilities(
  model: ModelDiscoveryCandidate,
  capabilities: readonly ModelCapability[],
): ModelDiscoveryCandidate {
  return { ...model, capabilities: uniqueCapabilities(capabilities), capabilitySource: 'user' }
}

export type { ModelCapability, ModelDiscoveryCandidate, ModelDiscoveryProtocol, ModelDiscoveryResult } from '../../shared/contracts/models'
