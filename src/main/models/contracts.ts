export type JsonObject = Record<string, unknown>

export type TextProvider =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'deepseek'
  | 'glm'
  | 'kimi'
  | 'openai-compatible'

export type TextRole = 'system' | 'user' | 'assistant' | 'tool'

export interface TextImagePart {
  type: 'image'
  /** A data URL, a provider URL, or a local file URI already made accessible by the caller. */
  url?: string
  /** Raw base64 without a data-URL prefix. */
  data?: string
  mimeType?: string
}

export interface TextTextPart {
  type: 'text'
  text: string
}

export type TextContentPart = TextTextPart | TextImagePart
export type TextContent = string | readonly TextContentPart[]

export interface TextToolCall {
  id: string
  name: string
  arguments: string
}

export interface TextMessage {
  role: TextRole
  content: TextContent
  name?: string
  toolCallId?: string
  toolCalls?: readonly TextToolCall[]
}

export interface TextToolDefinition {
  name: string
  description?: string
  inputSchema: JsonObject
}

export interface TextToolChoice {
  mode: 'auto' | 'none' | 'required' | 'named'
  name?: string
}

export interface TextSearchRequest {
  enabled: boolean
  /** Provider-specific search options are passed through only by the adapter that supports them. */
  options?: JsonObject
}

export type TextReasoningEffort =
  | 'auto'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface TextModelRequest {
  model: string
  messages: readonly TextMessage[]
  system?: string
  temperature?: number
  maxTokens?: number
  topP?: number
  stream?: boolean
  includeUsage?: boolean
  tools?: readonly TextToolDefinition[]
  toolChoice?: TextToolChoice
  search?: boolean | TextSearchRequest
  reasoningEffort?: TextReasoningEffort
  signal?: AbortSignal
  metadata?: JsonObject
  /** Opaque canonical context returned by OpenAI Responses compaction. */
  officialCompactionItems?: readonly JsonObject[]
}

export interface TextCompactionRequest {
  model: string
  input: readonly JsonObject[]
  signal?: AbortSignal
}

export interface TextCompactionResponse {
  output: JsonObject[]
  raw: unknown
}

export interface TextUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
}

export interface TextModelResponse {
  id?: string
  model?: string
  text: string
  toolCalls: TextToolCall[]
  finishReason?: string
  usage?: TextUsage
  raw: unknown
}

export interface TextModelCapabilities {
  streaming: boolean
  toolCalls: boolean
  vision: boolean
  nativeSearch: boolean
  reasoningEffort?: boolean
}

export interface TextDeltaEvent {
  type: 'text_delta'
  text: string
}

export interface TextToolCallDeltaEvent {
  type: 'tool_call_delta'
  index?: number
  id?: string
  name?: string
  argumentsDelta?: string
}

export interface TextUsageEvent {
  type: 'usage'
  usage: TextUsage
}

export interface TextFinishEvent {
  type: 'finish'
  reason?: string
}

export type TextStreamEvent =
  | TextDeltaEvent
  | TextToolCallDeltaEvent
  | TextUsageEvent
  | TextFinishEvent

export type FetchImplementation = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

export interface TextAdapterOptions {
  baseUrl: string
  apiKey: string
  providerType?: TextProvider
  fetch?: FetchImplementation
  headers?: Record<string, string>
  capabilities?: Partial<TextModelCapabilities>
}

export interface TextModelAdapter {
  readonly providerType: TextProvider
  readonly protocol: 'openai.chat.completions' | 'anthropic.messages' | 'gemini.generateContent'
  readonly capabilities: TextModelCapabilities
  generate(request: TextModelRequest): Promise<TextModelResponse>
  stream(request: TextModelRequest): AsyncIterable<TextStreamEvent>
  compact?(request: TextCompactionRequest): Promise<TextCompactionResponse>
}

export function normalizeSearchRequest(
  search: TextModelRequest['search'],
): TextSearchRequest | undefined {
  if (search === true) return { enabled: true }
  if (!search) return undefined
  return search
}

export function textContentToParts(content: TextContent): readonly TextContentPart[] {
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

export function textContentToText(content: TextContent): string {
  return textContentToParts(content)
    .filter((part): part is TextTextPart => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export const DEFAULT_TEXT_CAPABILITIES: TextModelCapabilities = {
  streaming: true,
  toolCalls: true,
  vision: false,
  nativeSearch: false,
}
