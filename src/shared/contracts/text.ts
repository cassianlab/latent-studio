import type { ModelDiscoveryResult } from './models'

export type JsonObject = Record<string, unknown>
export type TextRole = 'system' | 'user' | 'assistant' | 'tool'
export interface TextImagePart { type: 'image'; url?: string; data?: string; mimeType?: string }
export interface TextTextPart { type: 'text'; text: string }
export type TextContentPart = TextTextPart | TextImagePart
export type TextContent = string | readonly TextContentPart[]
export interface TextToolCall { id: string; name: string; arguments: string }
export interface TextMessage { role: TextRole; content: TextContent; name?: string; toolCallId?: string; toolCalls?: readonly TextToolCall[] }
export interface TextToolDefinition { name: string; description?: string; inputSchema: JsonObject }
export interface TextToolChoice { mode: 'auto' | 'none' | 'required' | 'named'; name?: string }
export interface TextSearchRequest { enabled: boolean; options?: JsonObject }

export type TextReasoningEffort =
  | 'auto'
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

/** Renderer input deliberately omits the model id and AbortSignal. */
export interface TextModelRequestInput {
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
  metadata?: JsonObject
  /** Opaque canonical context returned by OpenAI Responses compaction. */
  officialCompactionItems?: readonly JsonObject[]
}

/** Response shape safe to send over IPC; provider payloads stay in the main process. */
export interface TextUsage {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  /** Tokens occupied by the most recent model request, including its output. */
  contextTokens?: number
}
export interface TextGenerationResult {
  id?: string
  model?: string
  text: string
  toolCalls: TextToolCall[]
  finishReason?: string
  usage?: TextUsage
}

export interface TextGenerateInput { modelProfileId: string; request: TextModelRequestInput }
export interface TextStreamInput extends TextGenerateInput { requestId?: string }
export interface TextStreamStarted { requestId: string }
export interface TextDeltaEvent { type: 'text_delta'; text: string }
export interface TextToolCallDeltaEvent { type: 'tool_call_delta'; index?: number; id?: string; name?: string; argumentsDelta?: string }
export interface TextUsageEvent { type: 'usage'; usage: TextUsage }
export interface TextFinishEvent { type: 'finish'; reason?: string }
export type TextStreamEvent = TextDeltaEvent | TextToolCallDeltaEvent | TextUsageEvent | TextFinishEvent
export interface TextStreamEventPayload { requestId: string; event: TextStreamEvent }

export interface SerializedTextModelError {
  code: string
  message: string
  provider?: string
  status?: number
  retryAfterMs?: number
  requestId?: string
}

export type TextStreamCompletedPayload =
  | { requestId: string; result: TextGenerationResult }
  | { requestId: string; error: SerializedTextModelError }

export interface ModelDiscoveryInput { connectionId: string; pageToken?: string }

export interface TextCompactionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface TextCompactInput {
  modelProfileId: string
  messages: readonly TextCompactionMessage[]
  previousItems?: readonly JsonObject[]
}

export type TextCompactResult =
  | { status: 'compacted'; items: JsonObject[]; capabilityCached: boolean }
  | { status: 'unsupported' | 'failed'; reason: string; capabilityCached: boolean }

export interface TextApi {
  discoverModels(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult>
  generate(input: TextGenerateInput): Promise<TextGenerationResult>
  compact(input: TextCompactInput): Promise<TextCompactResult>
  startStream(input: TextStreamInput): Promise<TextStreamStarted>
  stopStream(requestId: string): Promise<void>
  onStreamEvent(listener: (payload: TextStreamEventPayload) => void): () => void
  onStreamComplete(listener: (payload: TextStreamCompletedPayload) => void): () => void
}
