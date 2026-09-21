import { randomUUID } from 'node:crypto'
import type { TextCompactInput, TextCompactResult, TextGenerationResult, TextGenerateInput, SerializedTextModelError, TextStreamCompletedPayload, TextStreamEventPayload, TextStreamInput } from '../../shared/contracts/text'
import type { ModelDiscoveryResult } from '../../shared/contracts/models'
import type { ModelProfile, ProviderConnection } from '../../shared/contracts/settings'
import { createTextModelAdapter, discoverModels, type FetchImplementation, type TextModelRequest, type TextModelResponse, type TextStreamEvent } from './index'
import { TextModelError as ModelError } from './errors'
import type { SettingsStore } from '../settings'
import { getSupportedReasoningEfforts, KNOWN_OPENAI_REASONING_PATTERNS, REASONING_EFFORT_LABELS } from '../../shared/models/reasoning'

interface ExecutionConfig {
  model: ModelProfile
  connection: ProviderConnection
  apiKey: string
}

interface ActiveStream {
  controller: AbortController
  ownerId?: number
}

const MAX_COMPACTION_MESSAGES = 512
const MAX_COMPACTION_BYTES = 4 * 1024 * 1024

function compactionCandidate(providerType: string, baseUrl: string): boolean {
  if (providerType !== 'openai') return false
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.openai.com'
  } catch {
    return false
  }
}

function normalizeCompactionInput(input: TextCompactInput): { modelProfileId: string; messages: TextCompactInput['messages']; previousItems: NonNullable<TextCompactInput['previousItems']> } {
  if (!input || typeof input !== 'object' || typeof input.modelProfileId !== 'string' || !input.modelProfileId.trim() || !Array.isArray(input.messages)) {
    throw new ModelError('invalid_request', '压缩请求格式无效')
  }
  if (input.messages.length > MAX_COMPACTION_MESSAGES) throw new ModelError('invalid_request', `压缩消息数量不能超过 ${MAX_COMPACTION_MESSAGES} 条`)
  const messages = input.messages.map((message) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || !message.content.trim()) throw new ModelError('invalid_request', '压缩消息格式无效')
    return { role: message.role, content: message.content }
  })
  const previousItems = input.previousItems ?? []
  if (!Array.isArray(previousItems) || !previousItems.every((item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item))) throw new ModelError('invalid_request', '官方压缩上下文格式无效')
  let serialized = ''
  try { serialized = JSON.stringify({ messages, previousItems }) } catch { throw new ModelError('invalid_request', '压缩上下文无法序列化') }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_COMPACTION_BYTES) throw new ModelError('invalid_request', '压缩上下文过大')
  return { modelProfileId: input.modelProfileId.trim(), messages, previousItems }
}

function redactMessage(message: string, secret?: string): string {
  if (!secret) return message
  return message.split(secret).join('[已隐藏]')
}

function serializeError(error: unknown, secret?: string): SerializedTextModelError {
  if (error instanceof ModelError) {
    return {
      code: error.code,
      message: redactMessage(error.message, secret),
      ...(error.provider ? { provider: error.provider } : {}),
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
      ...(error.requestId ? { requestId: error.requestId } : {}),
    }
  }
  const code = error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : 'unknown'
  const message = error instanceof Error ? redactMessage(error.message, secret) : '模型请求失败'
  return { code, message }
}

function sanitizedError(error: unknown, provider: Parameters<typeof createTextModelAdapter>[0]['providerType'], secret: string): ModelError {
  if (error instanceof ModelError) {
    return new ModelError(error.code, redactMessage(error.message, secret), {
      provider: error.provider ?? provider,
      status: error.status,
      retryAfterMs: error.retryAfterMs,
      requestId: error.requestId,
    })
  }
  return new ModelError('unknown', '模型请求失败', { provider })
}

function resultWithoutRaw(response: TextModelResponse): TextGenerationResult {
  const { raw: _raw, ...result } = response
  if (!result.usage) return result
  return { ...result, usage: completeUsage(result.usage) }
}

function completeUsage(usage: NonNullable<TextGenerationResult['usage']>): NonNullable<TextGenerationResult['usage']> {
  const totalTokens = usage.totalTokens
    ?? ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0))
  return { ...usage, totalTokens, contextTokens: usage.contextTokens ?? totalTokens }
}

function normalizeRequest(input: TextGenerateInput | TextStreamInput): TextModelRequest {
  if (!input || typeof input !== 'object' || typeof input.modelProfileId !== 'string' || !input.modelProfileId.trim()) {
    throw new ModelError('invalid_request', '模型配置标识缺失')
  }
  if (!input.request || typeof input.request !== 'object' || !Array.isArray(input.request.messages)) {
    throw new ModelError('invalid_request', '文本请求消息格式无效')
  }
  return { ...input.request, model: '' }
}

function explicitCapabilities(model: ModelProfile): Partial<NonNullable<Parameters<typeof createTextModelAdapter>[0]['capabilities']>> {
  const has = (capability: string) => model.capabilities.includes(capability) || capability === 'native-search' && model.capabilities.includes('search')
  const hasReasoning = has('reasoning-effort') || KNOWN_OPENAI_REASONING_PATTERNS.some((p) => p.test(model.modelId))
  return {
    toolCalls: model.capabilities.length === 0 || has('tool-calls'),
    ...(has('vision') ? { vision: true } : {}),
    ...(has('native-search') ? { nativeSearch: true } : {}),
    ...(hasReasoning ? { reasoningEffort: true } : {}),
  }
}

function hasImagePart(request: TextModelRequest): boolean {
  return request.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => Boolean(part && typeof part === 'object' && part.type === 'image')))
}

function validateCapabilities(request: TextModelRequest, model: ModelProfile, providerType?: string): void {
  const has = (capability: string) => model.capabilities.includes(capability) || capability === 'native-search' && model.capabilities.includes('search')
  const searchEnabled = request.search === true || (Boolean(request.search) && typeof request.search === 'object' && request.search.enabled)
  const supportsToolCalls = model.capabilities.length === 0 || has('tool-calls')
  if (searchEnabled && !has('native-search')) throw new ModelError('invalid_request', '当前文本模型未确认支持联网搜索')
  if (request.tools?.length && !supportsToolCalls) throw new ModelError('invalid_request', '当前文本模型未确认支持工具调用')
  if (hasImagePart(request) && !has('vision')) throw new ModelError('invalid_request', '当前文本模型未确认支持图片输入')
  if (request.reasoningEffort && request.reasoningEffort !== 'auto') {
    if (!(request.reasoningEffort in REASONING_EFFORT_LABELS)) throw new ModelError('invalid_request', '思考强度参数无效')
    const info = getSupportedReasoningEfforts({
      modelId: model.modelId,
      capabilities: model.capabilities,
      providerType,
    })
    if (!info.supported.includes(request.reasoningEffort) && providerType !== 'openai-compatible') {
      throw new ModelError('invalid_request', `当前模型未确认支持思考强度“${request.reasoningEffort}”`)
    }
  }
}

function searchEnabled(request: TextModelRequest): boolean {
  return request.search === true || (Boolean(request.search) && typeof request.search === 'object' && request.search.enabled)
}

function aggregateStream(events: TextStreamEvent[]): TextGenerationResult {
  let text = ''
  let finishReason: string | undefined
  let usage: TextGenerationResult['usage']
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
  for (const event of events) {
    if (event.type === 'text_delta') text += event.text
    if (event.type === 'finish') finishReason = event.reason
    if (event.type === 'usage') usage = { ...usage, ...event.usage }
    if (event.type === 'tool_call_delta') {
      const index = event.index ?? 0
      const previous = toolCalls.get(index) ?? { id: '', name: '', arguments: '' }
      toolCalls.set(index, {
        id: event.id ?? previous.id,
        name: event.name ?? previous.name,
        arguments: previous.arguments + (event.argumentsDelta ?? ''),
      })
    }
  }
  return {
    text,
    toolCalls: [...toolCalls.values()].filter((call) => call.id || call.name || call.arguments),
    ...(finishReason ? { finishReason } : {}),
    ...(usage ? { usage: completeUsage(usage) } : {}),
  }
}

export interface TextModelService {
  discoverModels(input: { connectionId: string; pageToken?: string }): Promise<ModelDiscoveryResult>
  generate(input: TextGenerateInput, signal?: AbortSignal): Promise<TextGenerationResult>
  compact(input: TextCompactInput, signal?: AbortSignal): Promise<TextCompactResult>
  startStream(input: TextStreamInput, emit: (payload: TextStreamEventPayload | TextStreamCompletedPayload) => void, ownerId?: number): Promise<{ requestId: string }>
  stopStream(requestId: string, ownerId?: number): void
  dispose(): void
}

export interface TextModelServiceOptions {
  fetch?: FetchImplementation
}

export function createTextModelService(store: SettingsStore, options: TextModelServiceOptions = {}): TextModelService {
  const activeStreams = new Map<string, ActiveStream>()
  const compactionCapabilities = new Map<string, 'supported' | 'unsupported'>()

  function configFor(modelProfileId: string): ExecutionConfig {
    return store.getModelExecutionConfig(modelProfileId)
  }

  function configForRequest(modelProfileId: string, request: TextModelRequest): ExecutionConfig {
    const selected = configFor(modelProfileId)
    if (!searchEnabled(request) || selected.model.capabilities.includes('native-search') || selected.model.capabilities.includes('search')) return selected
    const fallback = store.get().models.find((model) => model.kind === 'text' && (model.capabilities.includes('native-search') || model.capabilities.includes('search')))
    if (!fallback) return selected
    return configFor(fallback.id)
  }

  function requiredModelId(input: TextGenerateInput | TextStreamInput): string {
    if (!input || typeof input !== 'object' || typeof input.modelProfileId !== 'string' || !input.modelProfileId.trim()) {
      throw new ModelError('invalid_request', '模型配置标识缺失')
    }
    return input.modelProfileId.trim()
  }

  async function discover(input: { connectionId: string; pageToken?: string }): Promise<ModelDiscoveryResult> {
    const config = store.getConnectionExecutionConfig(input.connectionId)
    try {
      return await discoverModels({
        providerType: config.connection.providerType,
        baseUrl: config.connection.baseUrl,
        apiKey: config.apiKey,
        ...(options.fetch ? { fetch: options.fetch } : {}),
        ...(input.pageToken ? { pageToken: input.pageToken } : {}),
      })
    } catch (error) {
      throw sanitizedError(error, config.connection.providerType, config.apiKey)
    }
  }

  async function generate(input: TextGenerateInput, signal?: AbortSignal): Promise<TextGenerationResult> {
    const config = configFor(requiredModelId(input))
    if (config.model.kind !== 'text') throw new ModelError('invalid_request', '图片模型不能用于文本生成', { provider: config.connection.providerType })
    const request = normalizeRequest(input)
    const routedConfig = configForRequest(config.model.id, request)
    if (routedConfig.model.kind !== 'text') throw new ModelError('invalid_request', '图片模型不能用于文本生成', { provider: routedConfig.connection.providerType })
    validateCapabilities(request, routedConfig.model, routedConfig.connection.providerType)
    const adapter = createTextModelAdapter({
      providerType: routedConfig.connection.providerType,
      baseUrl: routedConfig.connection.baseUrl,
      apiKey: routedConfig.apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      capabilities: explicitCapabilities(routedConfig.model),
    })
    try {
      return resultWithoutRaw(await adapter.generate({ ...request, model: routedConfig.model.modelId, ...(signal ? { signal } : {}) }))
    } catch (error) {
      throw sanitizedError(error, routedConfig.connection.providerType, routedConfig.apiKey)
    }
  }

  async function compact(input: TextCompactInput, signal?: AbortSignal): Promise<TextCompactResult> {
    const normalizedInput = normalizeCompactionInput(input)
    const config = configFor(normalizedInput.modelProfileId)
    if (config.model.kind !== 'text' || !compactionCandidate(config.connection.providerType, config.connection.baseUrl)) {
      return { status: 'unsupported', reason: '当前连接不是 OpenAI 官方直连，请使用模型摘要压缩', capabilityCached: false }
    }
    const cacheKey = `${config.connection.id}:${config.model.modelId}`
    const cached = compactionCapabilities.get(cacheKey)
    if (cached === 'unsupported') return { status: 'unsupported', reason: '连接探测结果表明不支持 Responses Compaction', capabilityCached: true }
    const adapter = createTextModelAdapter({
      providerType: config.connection.providerType,
      baseUrl: config.connection.baseUrl,
      apiKey: config.apiKey,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      capabilities: explicitCapabilities(config.model),
    })
    if (!adapter.compact) return { status: 'unsupported', reason: '当前适配器不支持 Responses Compaction', capabilityCached: false }
    try {
      const result = await adapter.compact({
        model: config.model.modelId,
        input: [
          ...normalizedInput.previousItems,
          ...normalizedInput.messages.map((message) => ({ role: message.role, content: message.content })),
        ],
        ...(signal ? { signal } : {}),
      })
      compactionCapabilities.set(cacheKey, 'supported')
      return { status: 'compacted', items: result.output, capabilityCached: Boolean(cached) }
    } catch (error) {
      const normalized = error instanceof ModelError ? error : undefined
      const status = normalized?.status ?? (error && typeof error === 'object' && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined)
      const code = normalized?.code ?? (error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : undefined)
      if (status === 404 || status === 405 || status === 501 || code === 'not_found') {
        compactionCapabilities.set(cacheKey, 'unsupported')
        return { status: 'unsupported', reason: normalized?.message ?? '当前连接不支持 Responses Compaction', capabilityCached: false }
      }
      const safe = sanitizedError(error, config.connection.providerType, config.apiKey)
      return { status: 'failed', reason: safe.message, capabilityCached: Boolean(cached) }
    }
  }

  async function startStream(
    input: TextStreamInput,
    emit: (payload: TextStreamEventPayload | TextStreamCompletedPayload) => void,
    ownerId?: number,
  ): Promise<{ requestId: string }> {
    const requestId = input.requestId ?? randomUUID()
    if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(requestId) || activeStreams.has(requestId)) {
      throw new ModelError('invalid_request', '流式请求标识无效或已在使用')
    }
    const controller = new AbortController()
    activeStreams.set(requestId, { controller, ownerId })
    void (async () => {
      const events: TextStreamEvent[] = []
      let secret: string | undefined
      try {
        const config = configFor(requiredModelId(input))
        if (config.model.kind !== 'text') throw new ModelError('invalid_request', '图片模型不能用于文本生成', { provider: config.connection.providerType })
        const request = normalizeRequest(input)
        const routedConfig = configForRequest(config.model.id, request)
        secret = routedConfig.apiKey
        validateCapabilities(request, routedConfig.model, routedConfig.connection.providerType)
        const adapter = createTextModelAdapter({
          providerType: routedConfig.connection.providerType,
          baseUrl: routedConfig.connection.baseUrl,
          apiKey: routedConfig.apiKey,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          capabilities: explicitCapabilities(routedConfig.model),
        })
        for await (const event of adapter.stream({ ...request, model: routedConfig.model.modelId, signal: controller.signal })) {
          events.push(event)
          emit({ requestId, event })
        }
        emit({ requestId, result: aggregateStream(events) })
      } catch (error) {
        emit({ requestId, error: serializeError(error, secret) })
      } finally {
        activeStreams.delete(requestId)
      }
    })()
    return { requestId }
  }

  function stopStream(requestId: string, ownerId?: number): void {
    const active = activeStreams.get(requestId)
    if (!active || (active.ownerId !== undefined && ownerId !== undefined && active.ownerId !== ownerId)) return
    active.controller.abort()
  }

  function dispose(): void {
    for (const active of activeStreams.values()) active.controller.abort()
    activeStreams.clear()
  }

  return { discoverModels: discover, generate, compact, startStream, stopStream, dispose }
}

export type { TextGenerationResult }
