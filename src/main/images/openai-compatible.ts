import { readFile as nodeReadFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import type {
  ImageDataReference,
  ImageFileReference,
  ImageModelRequest,
  ImageModelResponse,
  ImageQuality,
  ImageReference,
  ImageResult,
  ImageRequest,
} from '../../shared/contracts/images'
import type { ProviderType } from '../../shared/contracts/settings'
import type { FetchImplementation } from '../models/contracts'
import { imageEndpoint, imageFetch, imagePostJson, imagePostMultipart, imageReadJson } from './http'
import { ImageModelError, imageErrorFromThrown, imageParseFailure } from './errors'

export interface ImageFileData {
  bytes: Uint8Array
  mimeType?: string
  filename?: string
}

export type ImageFileReader = (path: string) => Promise<Uint8Array | ImageFileData>
export type ImageReferenceReader = ImageFileReader
export type ImageAdapterOptions = OpenAICompatibleImageAdapterOptions

export interface OpenAICompatibleImageAdapterOptions {
  baseUrl: string
  apiKey: string
  providerType?: ProviderType
  fetch?: FetchImplementation
  readFile?: ImageFileReader
  headers?: Record<string, string>
}

export interface ImageModelAdapter {
  readonly providerType: ProviderType
  readonly protocol: 'openai.images'
  generate(request: ImageExecutionRequest): Promise<ImageModelResponse>
  edit(request: ImageExecutionEditRequest): Promise<ImageModelResponse>
  execute(request: ImageExecutionRequest): Promise<ImageModelResponse>
}

export type ImageExecutionRequest = ImageRequest & { signal?: AbortSignal }
export type ImageExecutionEditRequest = Extract<ImageRequest, { operation: 'edit' }> & { signal?: AbortSignal }

const DEFAULT_MIME = 'image/png'

function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new ImageModelError('invalid_request', message)
  return value.trim()
}

function mimeForPath(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.avif': return 'image/avif'
    default: return DEFAULT_MIME
  }
}

function decodeDataReference(reference: ImageDataReference): ImageFileData {
  const input = (reference.data || reference.base64 || '').trim()
  if (!input) throw new ImageModelError('invalid_request', '参考图数据不能为空')
  const match = input.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s)
  if (match) {
    const encoded = match[2] ?? ''
    if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded.replace(/\s/g, '')) || encoded.replace(/\s/g, '').length % 4 === 1) {
      throw new ImageModelError('invalid_request', '参考图 Base64 数据无效')
    }
    try {
      return {
        bytes: Uint8Array.from(Buffer.from(decodeURIComponent(encoded), 'base64')),
        mimeType: reference.mimeType ?? match[1] ?? DEFAULT_MIME,
        filename: reference.filename,
      }
    } catch (error) {
      throw new ImageModelError('invalid_request', '参考图 Base64 数据无效', { cause: error })
    }
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(input.replace(/\s/g, '')) || input.replace(/\s/g, '').length % 4 === 1) {
    throw new ImageModelError('invalid_request', '参考图 Base64 数据无效')
  }
  try {
    return {
      bytes: Uint8Array.from(Buffer.from(input, 'base64')),
      mimeType: reference.mimeType ?? DEFAULT_MIME,
      filename: reference.filename,
    }
  } catch (error) {
    throw new ImageModelError('invalid_request', '参考图 Base64 数据无效', { cause: error })
  }
}

async function readReference(
  reference: ImageReference,
  readFile: ImageFileReader,
): Promise<Required<ImageFileData>> {
  if (reference.type === 'data' || 'data' in reference || 'base64' in reference) {
    const decoded = decodeDataReference(reference)
    return {
      bytes: decoded.bytes,
      mimeType: decoded.mimeType ?? DEFAULT_MIME,
      filename: decoded.filename ?? 'reference.png',
    }
  }
  const fileReference = reference as ImageFileReference
  const selectedPath = requiredText(fileReference.path, '参考图路径不能为空')
  let loaded: Uint8Array | ImageFileData
  try {
    loaded = await readFile(selectedPath)
  } catch (error) {
    if (error instanceof ImageModelError) throw error
    throw new ImageModelError('network', '读取参考图失败', { cause: error })
  }
  const loadedData: ImageFileData = loaded instanceof Uint8Array ? { bytes: loaded } : loaded
  const bytes = loadedData.bytes
  if (!bytes?.byteLength) throw new ImageModelError('invalid_request', '参考图文件为空')
  return {
    bytes,
    mimeType: fileReference.mimeType ?? loadedData.mimeType ?? mimeForPath(selectedPath),
    filename: fileReference.filename ?? loadedData.filename ?? (basename(selectedPath) || 'reference.png'),
  }
}

function mapResponse(payload: unknown, provider: ProviderType): ImageModelResponse {
  if (!payload || typeof payload !== 'object') throw imageParseFailure('图片服务返回结构无效', provider)
  const root = payload as Record<string, unknown>
  if (!Array.isArray(root.data)) throw imageParseFailure('图片服务未返回图片列表', provider)
  const images: ImageResult[] = root.data.flatMap((raw): ImageResult[] => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    const url = typeof item.url === 'string' && item.url ? item.url : undefined
    const b64Json = typeof item.b64_json === 'string' && item.b64_json ? item.b64_json : undefined
    if (!url && !b64Json) return []
    return [{
      ...(url ? { url } : {}),
      ...(b64Json ? { b64Json } : {}),
      ...(typeof item.revised_prompt === 'string' ? { revisedPrompt: item.revised_prompt } : {}),
    }]
  })
  if (!images.length) throw imageParseFailure('图片服务未返回有效图片数据', provider)
  return {
    ...(typeof root.id === 'string' ? { id: root.id } : {}),
    ...(typeof root.model === 'string' ? { model: root.model } : {}),
    ...(typeof root.created === 'number' ? { createdAt: new Date(root.created * 1000).toISOString() } : {}),
    images,
  }
}

function mapQualityForModel(model: string, quality?: ImageQuality): string | undefined {
  if (!quality || quality === 'auto') return undefined
  const lower = model.toLowerCase()
  if (/gpt[-_]?image[-_]?2[._-]?5/.test(lower)) {
    if (quality === 'max' || quality === 'xhigh' || quality === 'high' || quality === 'medium' || quality === 'low') return quality
    return undefined
  }
  if (/gpt[-_]?image[-_]?2(?:$|[-_.])/.test(lower)) {
    if (quality === 'max' || quality === 'xhigh' || quality === 'high') return 'high'
    if (quality === 'medium') return 'medium'
    if (quality === 'low') return 'low'
    return undefined
  }
  return undefined
}

function jsonBody(request: ImageModelRequest): Record<string, unknown> {
  const model = requiredText(request.model, '图片模型不能为空')
  const prompt = requiredText(request.prompt, '图片提示词不能为空')
  const n = request.n ?? 1
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new ImageModelError('invalid_request', '图片数量需要是 1-10 的整数')
  if (request.outputCompression !== undefined && (!Number.isInteger(request.outputCompression) || request.outputCompression < 0 || request.outputCompression > 100)) {
    throw new ImageModelError('invalid_request', '图片压缩质量需要是 0-100 的整数')
  }
  if (request.background === 'transparent' && request.outputFormat === 'jpeg') {
    throw new ImageModelError('invalid_request', '透明背景仅支持 PNG 或 WebP 输出格式')
  }
  const mappedQuality = mapQualityForModel(model, request.quality)
  const outputFormat = request.background === 'transparent' ? request.outputFormat ?? 'png' : request.outputFormat
  return {
    model,
    prompt,
    n,
    ...(request.size ? { size: request.size } : {}),
    ...(mappedQuality ? { quality: mappedQuality } : {}),
    ...(request.background ? { background: request.background } : {}),
    ...(outputFormat ? { output_format: outputFormat } : {}),
    ...(request.outputCompression === undefined ? {} : { output_compression: request.outputCompression }),
    ...(request.metadata ? { metadata: request.metadata } : {}),
  }
}

function appendField(form: FormData, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  form.append(key, String(value))
}

function makeBlob(bytes: Uint8Array, mimeType: string): Blob {
  // Copy into an ArrayBuffer so TypeScript's SharedArrayBuffer union cannot leak to Blob's DOM type.
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy.buffer], { type: mimeType })
}

export class OpenAICompatibleImageAdapter implements ImageModelAdapter {
  readonly protocol = 'openai.images' as const
  readonly providerType: ProviderType
  private readonly fetchImplementation: FetchImplementation
  private readonly readFile: ImageFileReader
  private readonly headers: Record<string, string>
  private readonly baseUrl: string

  constructor(options: OpenAICompatibleImageAdapterOptions) {
    this.providerType = options.providerType ?? 'openai-compatible'
    this.baseUrl = options.baseUrl
    this.fetchImplementation = imageFetch(options.fetch)
    this.readFile = options.readFile ?? (async (filePath) => nodeReadFile(filePath))
    this.headers = { authorization: `Bearer ${options.apiKey}`, ...(options.headers ?? {}) }
  }

  async generate(request: ImageExecutionRequest): Promise<ImageModelResponse> {
    if (request.signal?.aborted) throw new ImageModelError('cancelled', '图片请求已取消', { provider: this.providerType })
    try {
      const response = await imagePostJson(
        this.fetchImplementation,
        imageEndpoint(this.baseUrl, '/images/generations'),
        this.headers,
        jsonBody(request),
        this.providerType,
        request.signal,
      )
      return mapResponse(await imageReadJson(response, this.providerType), this.providerType)
    } catch (error) {
      throw imageErrorFromThrown(error, this.providerType, request.signal)
    }
  }

  async edit(request: ImageExecutionEditRequest): Promise<ImageModelResponse> {
    if (request.signal?.aborted) throw new ImageModelError('cancelled', '图片请求已取消', { provider: this.providerType })
    if (!request.references.length) throw new ImageModelError('invalid_request', '图片编辑至少需要一张参考图', { provider: this.providerType })
    try {
      const body = jsonBody(request)
      const form = new FormData()
      for (const [key, value] of Object.entries(body)) appendField(form, key, value)
      for (const reference of request.references) {
        const file = await readReference(reference, this.readFile)
        form.append('image[]', makeBlob(file.bytes, file.mimeType), file.filename)
      }
      if (request.mask) {
        const mask = await readReference(request.mask, this.readFile)
        form.append('mask', makeBlob(mask.bytes, mask.mimeType), mask.filename)
      }
      const response = await imagePostMultipart(
        this.fetchImplementation,
        imageEndpoint(this.baseUrl, '/images/edits'),
        this.headers,
        form,
        this.providerType,
        request.signal,
      )
      return mapResponse(await imageReadJson(response, this.providerType), this.providerType)
    } catch (error) {
      throw imageErrorFromThrown(error, this.providerType, request.signal)
    }
  }

  execute(request: ImageExecutionRequest): Promise<ImageModelResponse> {
    return request.operation === 'edit' || request.references?.length
      ? this.edit({ ...request, operation: 'edit', references: request.references ?? [] })
      : this.generate(request)
  }
}

export function createImageModelAdapter(options: OpenAICompatibleImageAdapterOptions): ImageModelAdapter {
  return new OpenAICompatibleImageAdapter(options)
}
