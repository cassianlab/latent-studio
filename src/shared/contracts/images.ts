import type { ProviderType } from './settings'

export type ImageOperation = 'generate' | 'edit'
export type ImageQuality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type ImageBackground = 'auto' | 'opaque' | 'transparent'
export type ImageOutputFormat = 'png' | 'jpeg' | 'webp'

/** A reference image can be supplied without exposing a local path to a provider adapter. */
export interface ImageDataReference {
  type?: 'data'
  /** Raw base64 or a complete data URL. */
  data?: string
  /** Alias accepted when callers already name the encoded payload. */
  base64?: string
  mimeType?: string
  filename?: string
}

export interface ImageFileReference {
  type?: 'file'
  path: string
  mimeType?: string
  filename?: string
}

export type ImageReference = ImageDataReference | ImageFileReference

export interface ImageModelRequest {
  model: string
  prompt: string
  size?: string
  /** Local export dimensions; never sent to the provider. */
  outputSize?: string
  quality?: ImageQuality
  background?: ImageBackground
  outputFormat?: ImageOutputFormat
  outputCompression?: number
  /** A provider may support more than one output, but queues normally submit one task at a time. */
  n?: number
  metadata?: Record<string, unknown>
}

export interface ImageGenerateRequest extends ImageModelRequest {
  operation?: 'generate'
  references?: readonly ImageReference[]
}

export interface ImageEditRequest extends ImageModelRequest {
  operation: 'edit'
  references: readonly ImageReference[]
  mask?: ImageReference
}

export type ImageRequest = ImageGenerateRequest | ImageEditRequest

export interface ImageResult {
  url?: string
  /** Raw base64 returned by the provider; never includes an API key. */
  b64Json?: string
  revisedPrompt?: string
  /** Absolute local output path, when the main process persisted the result. */
  localPath?: string
  mimeType?: string
  byteLength?: number
  width?: number
  height?: number
  normalization?: {
    sourceMimeType: string
    sourceWidth?: number
    sourceHeight?: number
  }
}

export interface ImageModelResponse {
  id?: string
  model?: string
  createdAt?: string
  images: ImageResult[]
}

export type ImageGenerationRequest = ImageModelRequest
export type ImageGenerationResponse = ImageModelResponse

export type ImageErrorCode =
  | 'auth'
  | 'rate_limit'
  | 'invalid_request'
  | 'not_found'
  | 'server'
  | 'network'
  | 'cancelled'
  | 'parse'
  | 'unknown'

export interface SerializedImageError {
  code: ImageErrorCode
  message: string
  provider?: ProviderType
  status?: number
  retryAfterMs?: number
  requestId?: string
}

export type ImageTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ImageTaskInput {
  id?: string
  title?: string
  connectionId: string
  request: ImageRequest
  /** Optional per-connection limit; persisted connection settings remain the source of truth. */
  maxConcurrency?: number
  maxRetries?: number
  /** Internal restart recovery flag; deferred tasks run after an explicit resume. */
  deferUntilResume?: boolean
}

export interface ImageTaskRecord {
  id: string
  connectionId: string
  request: ImageRequest
  status: ImageTaskStatus
  attempts: number
  maxRetries: number
  createdAt: string
  updatedAt: string
  archivedAt?: string
  result?: ImageModelResponse
  error?: SerializedImageError
  title?: string
}

export interface ImageTaskListInput {
  archived?: boolean
}

export type ImageTask = ImageTaskRecord

export type ImageTaskEvent =
  | { type: 'created' | 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'; task: ImageTaskRecord }
  | { type: 'retrying'; task: ImageTaskRecord; delayMs: number }

/** Renderer-facing request. The main process resolves model and connection details. */
export type ImageRequestInput =
  | Omit<ImageGenerateRequest, 'model'>
  | Omit<ImageEditRequest, 'model'>

export interface ImageEnqueueInput {
  id?: string
  title?: string
  modelProfileId: string
  request: ImageRequestInput
  maxRetries?: number
}

export interface ImageApi {
  enqueue(input: ImageEnqueueInput): Promise<ImageTaskRecord>
  list(input?: ImageTaskListInput): Promise<ImageTaskRecord[]>
  get(taskId: string): Promise<ImageTaskRecord | null>
  cancel(taskId: string): Promise<boolean>
  retry(taskId: string): Promise<boolean>
  archive(taskId: string): Promise<boolean>
  restore(taskId: string): Promise<boolean>
  remove(taskId: string, localPath?: string): Promise<boolean>
  pause(connectionId?: string): Promise<void>
  resume(connectionId?: string): Promise<void>
  setConnectionConcurrency(input: { connectionId: string; maxConcurrency: number }): Promise<void>
  revealOutput?(input: { taskId?: string; localPath?: string }): Promise<boolean>
  onTaskEvent(listener: (event: ImageTaskEvent) => void): () => void
}
