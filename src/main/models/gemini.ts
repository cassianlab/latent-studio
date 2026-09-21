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

function mapContent(content: TextContent): JsonObject[] {
  return textContentToParts(content).map((part) => {
    if (part.type === 'text') return { text: part.text }
    if (part.data) return { inlineData: { mimeType: part.mimeType ?? 'application/octet-stream', data: part.data } }
    return { fileData: { fileUri: part.url ?? '' } }
  })
}

function mapMessage(message: TextMessage): JsonObject {
  if (message.role === 'tool') {
    return {
      role: 'user',
      parts: [{ functionResponse: { name: message.name ?? message.toolCallId ?? 'tool', response: { result: textContentToText(message.content) } } }],
    }
  }
  const role = message.role === 'assistant' ? 'model' : 'user'
  return { role, parts: mapContent(message.content) }
}

function mapRequest(request: TextModelRequest): JsonObject {
  const search = normalizeSearchRequest(request.search)
  const functionDeclarations = request.tools?.map((tool) => ({ name: tool.name, description: tool.description, parametersJsonSchema: tool.inputSchema }))
  const contents = request.messages.filter((message) => message.role !== 'system').map(mapMessage)
  return {
    contents,
    ...(request.system ? { systemInstruction: { parts: [{ text: request.system }] } } : {}),
    ...(functionDeclarations?.length || search?.enabled ? {
      tools: [
        ...(functionDeclarations?.length ? [{ functionDeclarations }] : []),
        ...(search?.enabled ? [{ googleSearch: {} }] : []),
      ],
    } : {}),
    ...(request.toolChoice ? { toolConfig: { functionCallingConfig: { mode: request.toolChoice.mode === 'named' ? 'ANY' : request.toolChoice.mode.toUpperCase(), ...(request.toolChoice.name ? { allowedFunctionNames: [request.toolChoice.name] } : {}) } } } : {}),
    ...(request.temperature === undefined && request.topP === undefined && request.maxTokens === undefined ? {} : {
      generationConfig: {
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.topP === undefined ? {} : { topP: request.topP }),
        ...(request.maxTokens === undefined ? {} : { maxOutputTokens: request.maxTokens }),
      },
    }),
  }
}

function responseParts(payload: Record<string, unknown>): JsonObject[] {
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : []
  const candidate = candidates[0] && typeof candidates[0] === 'object' ? candidates[0] as Record<string, unknown> : undefined
  const content = candidate?.content && typeof candidate.content === 'object' ? candidate.content as Record<string, unknown> : undefined
  return Array.isArray(content?.parts) ? content.parts.filter((part): part is JsonObject => Boolean(part && typeof part === 'object')) : []
}

function mapResponse(payload: unknown): TextModelResponse {
  if (!payload || typeof payload !== 'object') throw parseFailure('Gemini 返回结构无效', 'gemini')
  const root = payload as Record<string, unknown>
  const parts = responseParts(root)
  const toolCalls: TextToolCall[] = parts.flatMap((part): TextToolCall[] => {
    const call = part.functionCall
    if (!call || typeof call !== 'object') return []
    const fn = call as Record<string, unknown>
    if (typeof fn.name !== 'string') return []
    return [{ id: typeof fn.id === 'string' ? fn.id : fn.name, name: fn.name, arguments: JSON.stringify(fn.args ?? {}) }]
  })
  const usage = root.usageMetadata && typeof root.usageMetadata === 'object' ? root.usageMetadata as Record<string, unknown> : undefined
  const inputTokens = typeof usage?.promptTokenCount === 'number' ? usage.promptTokenCount : undefined
  const outputTokens = typeof usage?.candidatesTokenCount === 'number' ? usage.candidatesTokenCount : undefined
  const reasoningTokens = typeof usage?.thoughtsTokenCount === 'number' ? usage.thoughtsTokenCount : undefined
  const totalTokens = typeof usage?.totalTokenCount === 'number'
    ? usage.totalTokenCount
    : inputTokens === undefined && outputTokens === undefined
      ? undefined
      : (inputTokens ?? 0) + (outputTokens ?? 0) + (reasoningTokens ?? 0)
  const candidate = Array.isArray(root.candidates) && root.candidates[0] && typeof root.candidates[0] === 'object' ? root.candidates[0] as Record<string, unknown> : undefined
  return {
    id: typeof root.responseId === 'string' ? root.responseId : undefined,
    model: typeof root.modelVersion === 'string' ? root.modelVersion : undefined,
    text: parts.filter((part) => typeof part.text === 'string').map((part) => part.text as string).join(''),
    toolCalls,
    finishReason: typeof candidate?.finishReason === 'string' ? candidate.finishReason : undefined,
    ...(inputTokens === undefined && outputTokens === undefined && totalTokens === undefined ? {} : { usage: { inputTokens, outputTokens, totalTokens, ...(reasoningTokens === undefined ? {} : { reasoningTokens }) } }),
    raw: payload,
  }
}

export class GeminiTextAdapter implements TextModelAdapter {
  readonly protocol = 'gemini.generateContent' as const
  readonly providerType: TextProvider = 'gemini'
  readonly capabilities
  private readonly fetchImplementation
  private readonly headers: Record<string, string>
  private readonly baseUrl: string
  private readonly apiKey: string

  constructor(options: TextAdapterOptions) {
    this.baseUrl = options.baseUrl
    this.apiKey = options.apiKey
    this.fetchImplementation = getFetch(options.fetch)
    this.headers = { ...(options.headers ?? {}), 'x-goog-api-key': options.apiKey }
    this.capabilities = { ...DEFAULT_TEXT_CAPABILITIES, vision: true, nativeSearch: true, ...options.capabilities }
  }

  private url(model: string, stream: boolean): string {
    const action = stream ? 'streamGenerateContent' : 'generateContent'
    const endpoint = endpointWithVersion(this.baseUrl, 'v1beta', `/models/${encodeURIComponent(model)}:${action}`)
    return stream ? `${endpoint}?alt=sse` : endpoint
  }

  async generate(request: TextModelRequest): Promise<TextModelResponse> {
    if (request.signal?.aborted) throw new TextModelError('cancelled', '模型请求已取消', { provider: this.providerType })
    try {
      const response = await postJson(this.fetchImplementation, this.url(request.model, false), this.headers, mapRequest(request), this.providerType, request.signal)
      return mapResponse(await readJsonResponse(response, this.providerType))
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }

  async *stream(request: TextModelRequest): AsyncIterable<TextStreamEvent> {
    if (request.signal?.aborted) throw new TextModelError('cancelled', '模型请求已取消', { provider: this.providerType })
    let response: Response
    try {
      response = await postJson(this.fetchImplementation, this.url(request.model, true), this.headers, mapRequest(request), this.providerType, request.signal)
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
    try {
      for await (const value of parseJsonStream(response, this.providerType, request.signal)) {
        if (!value || typeof value !== 'object') continue
        const frame = value as Record<string, unknown>
        const parts = responseParts(frame)
        for (const part of parts) {
          if (typeof part.text === 'string') yield { type: 'text_delta', text: part.text }
          if (part.functionCall && typeof part.functionCall === 'object') {
            const call = part.functionCall as Record<string, unknown>
            yield {
              type: 'tool_call_delta',
              ...(typeof call.id === 'string' ? { id: call.id } : {}),
              ...(typeof call.name === 'string' ? { name: call.name } : {}),
              ...(call.args ? { argumentsDelta: JSON.stringify(call.args) } : {}),
            }
          }
        }
        const usage = frame.usageMetadata && typeof frame.usageMetadata === 'object' ? frame.usageMetadata as Record<string, unknown> : undefined
        if (usage) yield {
          type: 'usage',
          usage: {
            ...(typeof usage.promptTokenCount === 'number' ? { inputTokens: usage.promptTokenCount } : {}),
            ...(typeof usage.candidatesTokenCount === 'number' ? { outputTokens: usage.candidatesTokenCount } : {}),
            ...(typeof usage.totalTokenCount === 'number' ? { totalTokens: usage.totalTokenCount } : {}),
            ...(typeof usage.thoughtsTokenCount === 'number' ? { reasoningTokens: usage.thoughtsTokenCount } : {}),
          },
        }
        const candidates = Array.isArray(frame.candidates) ? frame.candidates : []
        const candidate = candidates[0] && typeof candidates[0] === 'object' ? candidates[0] as Record<string, unknown> : undefined
        if (typeof candidate?.finishReason === 'string') yield { type: 'finish', reason: candidate.finishReason }
      }
    } catch (error) {
      throw errorFromThrown(error, this.providerType, request.signal)
    }
  }
}
