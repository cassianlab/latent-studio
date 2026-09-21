import type {
  JsonObject,
  TextAdapterOptions,
  TextContent,
  TextMessage,
  TextModelAdapter,
  TextModelRequest,
  TextModelResponse,
  TextProvider,
  TextStreamEvent,
  TextToolCall,
} from './contracts'
import { DEFAULT_TEXT_CAPABILITIES, normalizeSearchRequest, textContentToParts, textContentToText } from './contracts'
import { endpointWithVersion, getFetch, postJson, readJsonResponse } from './http'
import { TextModelError, errorFromThrown, parseFailure } from './errors'
import { parseJsonStream } from './stream'

function mapContent(content: TextContent): string | JsonObject[] {
  if (typeof content === 'string') return content
  return textContentToParts(content).map((part) => {
    if (part.type === 'text') return { type: 'text', text: part.text }
    if (part.data) return { type: 'image', source: { type: 'base64', media_type: part.mimeType ?? 'application/octet-stream', data: part.data } }
    return { type: 'image', source: { type: 'url', url: part.url ?? '' } }
  })
}

function mapMessage(message: TextMessage): JsonObject {
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: message.toolCallId ?? message.name ?? 'tool',
        content: typeof message.content === 'string' ? message.content : textContentToText(message.content),
      }],
    }
  }
  const role = message.role === 'assistant' ? 'assistant' : 'user'
  const content = message.toolCalls?.length
    ? [
      ...(typeof message.content === 'string' ? [{ type: 'text', text: message.content }] : mapContent(message.content) as JsonObject[]),
      ...message.toolCalls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: parseArguments(call.arguments) })),
    ]
    : mapContent(message.content)
  return { role, content }
}

function parseArguments(value: string): JsonObject {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonObject : {}
  } catch {
    return {}
  }
}

function mapRequest(request: TextModelRequest, stream: boolean): JsonObject {
  const search = normalizeSearchRequest(request.search)
  const tools = [
    ...(request.tools ?? []).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema })),
    ...(search?.enabled ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: typeof search.options?.maxUses === 'number' ? search.options.maxUses : undefined }] : []),
  ]
  return {
    model: request.model,
    max_tokens: request.maxTokens ?? 4096,
    messages: request.messages.filter((message) => message.role !== 'system').map(mapMessage),
    ...(request.system ? { system: request.system } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(stream ? { stream: true } : {}),
    ...(tools.length ? { tools } : {}),
  }
}

function readText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part): part is Record<string, unknown> => Boolean(part && typeof part === 'object'))
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text as string)
    .join('')
}

function mapResponse(payload: unknown): TextModelResponse {
  if (!payload || typeof payload !== 'object') throw parseFailure('Anthropic 返回结构无效', 'anthropic')
  const root = payload as Record<string, unknown>
  const toolCalls: TextToolCall[] = Array.isArray(root.content)
    ? root.content.flatMap((raw): TextToolCall[] => {
      if (!raw || typeof raw !== 'object') return []
      const block = raw as Record<string, unknown>
      if (block.type !== 'tool_use' || typeof block.id !== 'string' || typeof block.name !== 'string') return []
      return [{ id: block.id, name: block.name, arguments: JSON.stringify(block.input ?? {}) }]
    })
    : []
  const usage = root.usage && typeof root.usage === 'object' ? root.usage as Record<string, unknown> : undefined
  const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined
  const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined
  return {
    id: typeof root.id === 'string' ? root.id : undefined,
    model: typeof root.model === 'string' ? root.model : undefined,
    text: readText(root.content),
    toolCalls,
    finishReason: typeof root.stop_reason === 'string' ? root.stop_reason : undefined,
    ...(inputTokens === undefined && outputTokens === undefined ? {} : { usage: { inputTokens, outputTokens, totalTokens: (inputTokens ?? 0) + (outputTokens ?? 0) } }),
    raw: payload,
  }
}

export class AnthropicTextAdapter implements TextModelAdapter {
  readonly protocol = 'anthropic.messages' as const
  readonly providerType: TextProvider = 'anthropic'
  readonly capabilities
  private readonly fetchImplementation
  private readonly headers: Record<string, string>
  private readonly baseUrl: string

  constructor(options: TextAdapterOptions) {
    this.baseUrl = options.baseUrl
    this.fetchImplementation = getFetch(options.fetch)
    this.headers = {
      'x-api-key': options.apiKey,
      'anthropic-version': '2023-06-01',
      ...(options.headers ?? {}),
    }
    this.capabilities = { ...DEFAULT_TEXT_CAPABILITIES, vision: true, nativeSearch: true, ...options.capabilities }
  }

  async generate(request: TextModelRequest): Promise<TextModelResponse> {
    if (request.signal?.aborted) throw new TextModelError('cancelled', '模型请求已取消', { provider: this.providerType })
    try {
      const response = await postJson(this.fetchImplementation, endpointWithVersion(this.baseUrl, 'v1', '/messages'), this.headers, mapRequest(request, false), this.providerType, request.signal)
      return mapResponse(await readJsonResponse(response, this.providerType))
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }

  async *stream(request: TextModelRequest): AsyncIterable<TextStreamEvent> {
    if (request.signal?.aborted) throw new TextModelError('cancelled', '模型请求已取消', { provider: this.providerType })
    let response: Response
    try {
      response = await postJson(this.fetchImplementation, endpointWithVersion(this.baseUrl, 'v1', '/messages'), this.headers, mapRequest(request, true), this.providerType, request.signal)
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
    try {
      const toolBlocks = new Map<number, { id?: string; name?: string }>()
      for await (const value of parseJsonStream(response, this.providerType, request.signal)) {
        if (!value || typeof value !== 'object') continue
        const event = value as Record<string, unknown>
        const type = event.type
        if (type === 'message_start') {
          const message = event.message && typeof event.message === 'object' ? event.message as Record<string, unknown> : undefined
          const usage = message?.usage && typeof message.usage === 'object' ? message.usage as Record<string, unknown> : undefined
          if (typeof usage?.input_tokens === 'number') yield { type: 'usage', usage: { inputTokens: usage.input_tokens } }
        } else if (type === 'content_block_start') {
          const index = typeof event.index === 'number' ? event.index : 0
          const block = event.content_block && typeof event.content_block === 'object' ? event.content_block as Record<string, unknown> : undefined
          if (block?.type === 'tool_use') {
            toolBlocks.set(index, {
              ...(typeof block.id === 'string' ? { id: block.id } : {}),
              ...(typeof block.name === 'string' ? { name: block.name } : {}),
            })
          }
        } else if (type === 'content_block_delta') {
          const delta = event.delta && typeof event.delta === 'object' ? event.delta as Record<string, unknown> : undefined
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') yield { type: 'text_delta', text: delta.text }
          if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
            const index = typeof event.index === 'number' ? event.index : 0
            const block = toolBlocks.get(index)
            yield {
              type: 'tool_call_delta',
              index,
              ...(block?.id ? { id: block.id } : {}),
              ...(block?.name ? { name: block.name } : {}),
              argumentsDelta: delta.partial_json,
            }
          }
        } else if (type === 'message_delta') {
          const delta = event.delta && typeof event.delta === 'object' ? event.delta as Record<string, unknown> : undefined
          const usage = event.usage && typeof event.usage === 'object' ? event.usage as Record<string, unknown> : undefined
          if (typeof usage?.output_tokens === 'number') yield { type: 'usage', usage: { outputTokens: usage.output_tokens } }
          if (typeof delta?.stop_reason === 'string') yield { type: 'finish', reason: delta.stop_reason }
        }
      }
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }
}
