import type {
  JsonObject,
  TextAdapterOptions,
  TextContent,
  TextCompactionRequest,
  TextCompactionResponse,
  TextMessage,
  TextModelAdapter,
  TextModelRequest,
  TextModelResponse,
  TextProvider,
  TextStreamEvent,
  TextToolCall,
} from './contracts'
import { DEFAULT_TEXT_CAPABILITIES, normalizeSearchRequest, textContentToParts, textContentToText } from './contracts'
import { getFetch, endpointWithVersion, postJson, readJsonResponse } from './http'
import { TextModelError, errorFromThrown, parseFailure } from './errors'
import { parseJsonStream } from './stream'
import { KNOWN_OPENAI_REASONING_PATTERNS } from '../../shared/models/reasoning'

function mapContent(content: TextContent): string | JsonObject[] {
  if (typeof content === 'string') return content
  return textContentToParts(content).map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    const url = part.url ?? (part.data ? `data:${part.mimeType ?? 'application/octet-stream'};base64,${part.data}` : undefined)
    return { type: 'image_url', image_url: { url: url ?? '' } }
  })
}

function mapMessage(message: TextMessage): JsonObject {
  return {
    role: message.role,
    content: mapContent(message.content),
    ...(message.name ? { name: message.name } : {}),
    ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    ...(message.toolCalls ? {
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    } : {}),
  }
}

function mapTools(request: TextModelRequest): JsonObject[] | undefined {
  if (!request.tools?.length) return undefined
  return request.tools.map((tool) => ({
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }))
}

function mapToolChoice(request: TextModelRequest): unknown {
  const choice = request.toolChoice
  if (!choice) return undefined
  if (choice.mode === 'named' && choice.name) return { type: 'function', function: { name: choice.name } }
  return choice.mode === 'required' ? 'required' : choice.mode
}

function mapRequest(request: TextModelRequest, stream: boolean, supportsReasoningEffort: boolean = false): JsonObject {
  const search = normalizeSearchRequest(request.search)
  const messages: TextMessage[] = []
  if (request.system && !request.messages.some((m) => m.role === 'system')) {
    messages.push({ role: 'system', content: request.system })
  }
  messages.push(...request.messages)
  const shouldSendReasoning = supportsReasoningEffort && request.reasoningEffort && request.reasoningEffort !== 'auto'
  return {
    model: request.model,
    messages: messages.map(mapMessage),
    stream,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.includeUsage && stream ? { stream_options: { include_usage: true } } : {}),
    ...(mapTools(request) ? { tools: mapTools(request) } : {}),
    ...(mapToolChoice(request) === undefined ? {} : { tool_choice: mapToolChoice(request) }),
    ...(search?.enabled ? { web_search_options: search.options ?? {} } : {}),
    ...(shouldSendReasoning ? { reasoning_effort: request.reasoningEffort } : {}),
  }
}

function readText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  return value.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object'))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

function mapResponse(payload: unknown): TextModelResponse {
  if (!payload || typeof payload !== 'object') throw parseFailure('OpenAI 返回结构无效', 'openai-compatible')
  const root = payload as Record<string, unknown>
  const choice = Array.isArray(root.choices) && root.choices[0] && typeof root.choices[0] === 'object'
    ? root.choices[0] as Record<string, unknown>
    : undefined
  const message = choice?.message && typeof choice.message === 'object' ? choice.message as Record<string, unknown> : undefined
  const toolCalls: TextToolCall[] = Array.isArray(message?.tool_calls)
    ? message.tool_calls.flatMap((raw): TextToolCall[] => {
      if (!raw || typeof raw !== 'object') return []
      const call = raw as Record<string, unknown>
      const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {}
      if (typeof call.id !== 'string' || typeof fn.name !== 'string') return []
      return [{ id: call.id, name: fn.name, arguments: typeof fn.arguments === 'string' ? fn.arguments : '' }]
    })
    : []
  const usage = root.usage && typeof root.usage === 'object' ? root.usage as Record<string, unknown> : undefined
  const inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : undefined
  const outputTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : undefined
  const totalTokens = typeof usage?.total_tokens === 'number' ? usage.total_tokens : undefined
  const completionDetails = usage?.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
    ? usage.completion_tokens_details as Record<string, unknown>
    : undefined
  const reasoningTokens = typeof completionDetails?.reasoning_tokens === 'number' ? completionDetails.reasoning_tokens : undefined
  return {
    id: typeof root.id === 'string' ? root.id : undefined,
    model: typeof root.model === 'string' ? root.model : undefined,
    text: readText(message?.content),
    toolCalls,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    ...(inputTokens === undefined && outputTokens === undefined && totalTokens === undefined ? {} : {
      usage: { inputTokens, outputTokens, totalTokens, ...(reasoningTokens === undefined ? {} : { reasoningTokens }) },
    }),
    raw: payload,
  }
}

function frameUsage(frame: Record<string, unknown>): TextModelResponse['usage'] | undefined {
  const usage = frame.usage && typeof frame.usage === 'object' ? frame.usage as Record<string, unknown> : undefined
  if (!usage) return undefined
  const completionDetails = usage.completion_tokens_details && typeof usage.completion_tokens_details === 'object'
    ? usage.completion_tokens_details as Record<string, unknown>
    : undefined
  return {
    ...(typeof usage.prompt_tokens === 'number' ? { inputTokens: usage.prompt_tokens } : {}),
    ...(typeof usage.completion_tokens === 'number' ? { outputTokens: usage.completion_tokens } : {}),
    ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
    ...(typeof completionDetails?.reasoning_tokens === 'number' ? { reasoningTokens: completionDetails.reasoning_tokens } : {}),
  }
}

function mapResponsesInput(request: TextModelRequest): JsonObject[] {
  const items: JsonObject[] = []
  for (const message of request.messages) {
    if (message.role === 'system') continue
    else if (message.role === 'user') items.push({ role: 'user', content: textContentToParts(message.content).map((part) => part.type === 'text'
      ? { type: 'input_text', text: part.text }
      : { type: 'input_image', image_url: part.url ?? (part.data ? `data:${part.mimeType ?? 'application/octet-stream'};base64,${part.data}` : '') }) })
    else if (message.role === 'assistant') {
      if (textContentToText(message.content).trim()) items.push({ role: 'assistant', content: textContentToText(message.content) })
      for (const call of message.toolCalls ?? []) items.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments })
    } else if (message.toolCallId) items.push({ type: 'function_call_output', call_id: message.toolCallId, output: textContentToText(message.content) })
  }
  return items
}

function readResponsesText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === 'string') return payload.output_text
  if (!Array.isArray(payload.output)) return ''
  return payload.output.flatMap((item): string[] => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    if (value.type !== 'message' || !Array.isArray(value.content)) return []
    return value.content.flatMap((part): string[] => part && typeof part === 'object' && (part as Record<string, unknown>).type === 'output_text' && typeof (part as Record<string, unknown>).text === 'string' ? [(part as Record<string, unknown>).text as string] : [])
  }).join('')
}

function mapResponsesToolCalls(payload: Record<string, unknown>): TextToolCall[] {
  if (!Array.isArray(payload.output)) return []
  return payload.output.flatMap((item): TextToolCall[] => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    if (value.type !== 'function_call' || typeof value.name !== 'string') return []
    const id = typeof value.call_id === 'string' ? value.call_id : typeof value.id === 'string' ? value.id : ''
    return [{ id, name: value.name, arguments: typeof value.arguments === 'string' ? value.arguments : '' }]
  })
}

function mapResponsesResponse(payload: unknown): TextModelResponse {
  if (!payload || typeof payload !== 'object') throw parseFailure('OpenAI Responses 返回结构无效', 'openai')
  const root = payload as Record<string, unknown>
  const usage = root.usage && typeof root.usage === 'object' ? root.usage as Record<string, unknown> : undefined
  const outputDetails = usage?.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? usage.output_tokens_details as Record<string, unknown>
    : undefined
  return {
    id: typeof root.id === 'string' ? root.id : undefined,
    model: typeof root.model === 'string' ? root.model : undefined,
    text: readResponsesText(root),
    toolCalls: mapResponsesToolCalls(root),
    finishReason: typeof root.status === 'string' ? root.status : undefined,
    ...(usage ? { usage: {
      ...(typeof usage.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
      ...(typeof usage.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
      ...(typeof usage.total_tokens === 'number' ? { totalTokens: usage.total_tokens } : {}),
      ...(typeof outputDetails?.reasoning_tokens === 'number' ? { reasoningTokens: outputDetails.reasoning_tokens } : {}),
    } } : {}),
    raw: payload,
  }
}

export class OpenAICompatibleTextAdapter implements TextModelAdapter {
  readonly protocol = 'openai.chat.completions' as const
  readonly providerType: TextProvider
  readonly capabilities
  private readonly fetchImplementation
  private readonly headers: Record<string, string>
  private readonly baseUrl: string

  constructor(options: TextAdapterOptions) {
    this.providerType = options.providerType ?? 'openai-compatible'
    this.baseUrl = options.baseUrl
    this.fetchImplementation = getFetch(options.fetch)
    this.headers = { authorization: `Bearer ${options.apiKey}`, ...(options.headers ?? {}) }
    this.capabilities = { ...DEFAULT_TEXT_CAPABILITIES, ...options.capabilities }
  }

  private supportsReasoningEffort(request: TextModelRequest): boolean {
    if (this.capabilities.reasoningEffort) return true
    if (this.providerType === 'openai-compatible' && request.reasoningEffort && request.reasoningEffort !== 'auto') return true
    const model = request.model.toLowerCase()
    if (model.includes('o1-preview')) return false
    if (this.providerType === 'openai') {
      return (/^(o1|o3|o4|gpt-5|codex)|(^|[-/_])(o1|o3|o4|gpt-5|codex)/i).test(model)
    }
    if (this.providerType === 'openai-compatible') {
      return KNOWN_OPENAI_REASONING_PATTERNS.some((pattern) => pattern.test(model))
    }
    return false
  }

  async generate(request: TextModelRequest): Promise<TextModelResponse> {
    if (request.signal?.aborted) throw new TextModelError('cancelled', '模型请求已取消', { provider: this.providerType })
    try {
      if (request.officialCompactionItems?.length) {
        const body: JsonObject = {
          model: request.model,
          input: [...(request.officialCompactionItems ?? []), ...mapResponsesInput(request)],
          store: false,
          ...(request.system ? { instructions: request.system } : {}),
          ...(request.maxTokens === undefined ? {} : { max_output_tokens: request.maxTokens }),
          ...(request.tools?.length ? { tools: request.tools.map((tool) => ({ type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema })) } : {}),
        }
        const response = await postJson(this.fetchImplementation, endpointWithVersion(this.baseUrl, 'v1', '/responses'), this.headers, body, this.providerType, request.signal)
        return mapResponsesResponse(await readJsonResponse(response, this.providerType))
      }
      const body = mapRequest(request, false, this.supportsReasoningEffort(request))
      const response = await postJson(this.fetchImplementation, endpointWithVersion(this.baseUrl, 'v1', '/chat/completions'), this.headers, body, this.providerType, request.signal)
      return mapResponse(await readJsonResponse(response, this.providerType))
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }

  async compact(request: TextCompactionRequest): Promise<TextCompactionResponse> {
    const body: JsonObject = { model: request.model, input: request.input }
    try {
      const response = await postJson(this.fetchImplementation, endpointWithVersion(this.baseUrl, 'v1', '/responses/compact'), this.headers, body, this.providerType, request.signal)
      const payload = await readJsonResponse(response, this.providerType)
      if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>).output)) throw parseFailure('OpenAI Compaction 返回结构无效', this.providerType)
      return { output: (payload as Record<string, unknown>).output as JsonObject[], raw: payload }
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }

  async *stream(request: TextModelRequest): AsyncIterable<TextStreamEvent> {
    if (request.signal?.aborted) throw new TextModelError('cancelled', '模型请求已取消', { provider: this.providerType })
    if (request.officialCompactionItems?.length) {
      const result = await this.generate(request)
      if (result.text) yield { type: 'text_delta', text: result.text }
      for (const [index, call] of result.toolCalls.entries()) {
        yield { type: 'tool_call_delta', index, id: call.id, name: call.name, argumentsDelta: call.arguments }
      }
      if (result.usage) yield { type: 'usage', usage: result.usage }
      yield { type: 'finish', ...(result.finishReason ? { reason: result.finishReason } : {}) }
      return
    }
    let response: Response
    try {
      const body = mapRequest(request, true, this.supportsReasoningEffort(request))
      response = await postJson(this.fetchImplementation, endpointWithVersion(this.baseUrl, 'v1', '/chat/completions'), this.headers, body, this.providerType, request.signal)
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
    try {
      for await (const value of parseJsonStream(response, this.providerType, request.signal)) {
        if (!value || typeof value !== 'object') continue
        const frame = value as Record<string, unknown>
        const choices = Array.isArray(frame.choices) ? frame.choices : []
        const choice = choices[0] && typeof choices[0] === 'object' ? choices[0] as Record<string, unknown> : undefined
        const delta = choice?.delta && typeof choice.delta === 'object' ? choice.delta as Record<string, unknown> : undefined
        const text = readText(delta?.content)
        if (text) yield { type: 'text_delta', text }
        if (Array.isArray(delta?.tool_calls)) {
          for (const raw of delta.tool_calls) {
            if (!raw || typeof raw !== 'object') continue
            const call = raw as Record<string, unknown>
            const fn = call.function && typeof call.function === 'object' ? call.function as Record<string, unknown> : {}
            yield {
              type: 'tool_call_delta',
              ...(typeof call.index === 'number' ? { index: call.index } : {}),
              ...(typeof call.id === 'string' ? { id: call.id } : {}),
              ...(typeof fn.name === 'string' ? { name: fn.name } : {}),
              ...(typeof fn.arguments === 'string' ? { argumentsDelta: fn.arguments } : {}),
            }
          }
        }
        const usage = frameUsage(frame)
        if (usage) yield { type: 'usage', usage }
        if (typeof choice?.finish_reason === 'string') yield { type: 'finish', reason: choice.finish_reason }
      }
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }
}
