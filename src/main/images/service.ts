import { promises as nodeFs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isIP } from 'node:net'
import sharp from 'sharp'
import type {
  ImageApi,
  ImageEnqueueInput,
  ImageModelResponse,
  ImageRequest,
  ImageTaskEvent,
  ImageTaskRecord,
} from '../../shared/contracts/images'
import type { ProviderType } from '../../shared/contracts/settings'
import type { ModelExecutionConfig, SettingsStore } from '../settings'
import type { TaskStore } from '../tasks/store'
import type { FetchImplementation } from '../models/contracts'
import type { ProjectAssetStore } from '../../shared/contracts/library'
import { MAX_REFERENCE_IMAGES } from '../../shared/reference-images'
import { ImageModelError, isImageModelError } from './errors'
import { imageFetch } from './http'
import { createImageModelAdapter, type ImageExecutionRequest, type ImageFileData } from './openai-compatible'
import { createImageTaskQueue, type ImageTaskExecutor, type ImageTaskQueue } from './queue'

const OPENAI_IMAGE_PROVIDERS: readonly ProviderType[] = ['openai', 'deepseek', 'glm', 'kimi', 'openai-compatible']
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024
const MAX_OUTPUT_BYTES = 50 * 1024 * 1024
const DEFAULT_IMAGE_RETRIES = 2

export interface ImageModelServiceOptions {
  fetch?: FetchImplementation
  getProjectRoot?: () => string | undefined
  readFile?: (path: string) => Promise<Uint8Array | ImageFileData>
  getTaskStore?: (projectRoot: string) => TaskStore
  getAssetStore?: (projectRoot: string) => ProjectAssetStore
}

interface ExecutionBinding {
  /** The model and credential are pinned when the task is accepted. */
  config: ModelExecutionConfig
  /** Project scope is also pinned so switching projects cannot redirect output. */
  projectRoot?: string
}

function redact(value: string, secret: string): string {
  return secret ? value.split(secret).join('[已隐藏]') : value
}

function asModelError(error: unknown, provider: ProviderType, secret: string): ImageModelError {
  if (isImageModelError(error)) {
    return new ImageModelError(error.code, redact(error.message, secret), {
      provider: error.provider ?? provider,
      status: error.status,
      retryAfterMs: error.retryAfterMs,
      requestId: error.requestId,
    })
  }
  return new ImageModelError('unknown', '图片模型请求失败', { provider })
}

function taskRequest(input: ImageEnqueueInput, model: string): ImageRequest {
  const request = input.request
  if (!request || typeof request !== 'object' || typeof request.prompt !== 'string' || !request.prompt.trim()) {
    throw new ImageModelError('invalid_request', '图片提示词不能为空')
  }
  if (request.outputSize !== undefined && (typeof request.outputSize !== 'string' || !requestedDimensions(request.outputSize))) {
    throw new ImageModelError('invalid_request', '导出尺寸无效或超过 1 亿像素')
  }
  const references = Array.isArray(request.references) ? request.references : []
  if (references.length > MAX_REFERENCE_IMAGES) throw new ImageModelError('invalid_request', `单轮最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`)
  if (request.operation === 'edit' || references.length > 0) {
    if (references.length === 0) {
      throw new ImageModelError('invalid_request', '图片编辑至少需要一张参考图')
    }
    return { ...request, model, operation: 'edit', references }
  }
  return { ...request, model, operation: 'generate', references: [] }
}

function isWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child !== '..' && child !== '' && !child.startsWith(`..${sep}`) && !isAbsolute(child)
}

function isPrivateAddress(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 0) || (a === 192 && b === 168) || (a === 198 && b >= 18 && b <= 19)
  }
  if (isIP(host) === 6) {
    if (host === '::1' || host === '::' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb')) return true
    const mapped = host.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    return mapped ? isPrivateAddress(mapped[1]) : false
  }
  return false
}

function outputExtension(mimeType: string | undefined, fallbackUrl?: string): string {
  const mime = mimeType?.split(';', 1)[0]?.trim().toLowerCase()
  if (mime === 'image/png') return '.png'
  if (mime === 'image/jpeg') return '.jpg'
  if (mime === 'image/webp') return '.webp'
  if (mime === 'image/gif') return '.gif'
  if (mime === 'image/avif') return '.avif'
  let extension = ''
  try { extension = fallbackUrl ? extname(new URL(fallbackUrl).pathname).toLowerCase() : '' } catch { /* use PNG fallback */ }
  return ['.jpg', '.jpeg', '.webp', '.gif', '.avif'].includes(extension) ? extension : '.png'
}

function imageMime(bytes: Uint8Array): string | undefined {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png'
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp'
  if (bytes.length >= 6 && (String.fromCharCode(...bytes.slice(0, 6)) === 'GIF87a' || String.fromCharCode(...bytes.slice(0, 6)) === 'GIF89a')) return 'image/gif'
  return undefined
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim()
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) throw new ImageModelError('parse', '图片服务返回了无效 Base64')
  const bytes = Uint8Array.from(Buffer.from(normalized, 'base64'))
  if (!bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES) throw new ImageModelError('parse', '图片结果大小无效')
  return bytes
}

async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await nodeFs.mkdir(resolve(path, '..'), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await nodeFs.writeFile(temporary, bytes)
    await nodeFs.rename(temporary, path)
  } catch (error) {
    try { await nodeFs.unlink(temporary) } catch { /* best effort cleanup */ }
    throw error
  }
}

async function readResponseBytes(response: Response, signal?: AbortSignal): Promise<Uint8Array> {
  if (signal?.aborted) throw new ImageModelError('cancelled', '图片下载已取消')
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > MAX_OUTPUT_BYTES) throw new ImageModelError('parse', '图片结果大小无效')
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (!bytes.byteLength || bytes.byteLength > MAX_OUTPUT_BYTES) throw new ImageModelError('parse', '图片结果大小无效')
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  const abort = (): void => { void reader.cancel(signal?.reason) }
  signal?.addEventListener('abort', abort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw new ImageModelError('cancelled', '图片下载已取消')
      const next = await reader.read()
      if (next.done) break
      const chunk = next.value
      total += chunk.byteLength
      if (total > MAX_OUTPUT_BYTES) throw new ImageModelError('parse', '图片结果大小无效')
      chunks.push(chunk)
    }
  } catch (error) {
    try { await reader.cancel() } catch { /* best effort cleanup */ }
    throw error
  } finally {
    signal?.removeEventListener('abort', abort)
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  if (!bytes.byteLength) throw new ImageModelError('parse', '图片结果大小无效')
  return bytes
}

async function downloadImage(urlValue: string, baseUrl: string, fetchImplementation: FetchImplementation, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mimeType?: string }> {
  let url: URL
  let provider: URL
  try { url = new URL(urlValue, `${baseUrl.replace(/\/$/, '')}/`); provider = new URL(baseUrl) } catch { throw new ImageModelError('parse', '图片服务返回了无效下载地址') }
  const localProvider = isPrivateAddress(provider.hostname) && url.origin === provider.origin
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (isPrivateAddress(url.hostname) && !localProvider)) {
    throw new ImageModelError('parse', '图片服务返回了不安全的下载地址')
  }
  let response: Response
  const timeout = AbortSignal.timeout(60_000)
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
  try { response = await fetchImplementation(url, { redirect: 'error', signal: requestSignal }) } catch (error) {
    if (signal?.aborted) throw new ImageModelError('cancelled', '图片下载已取消', { cause: error })
    throw new ImageModelError('network', '图片下载失败', { cause: error })
  }
  if (response.redirected || (response.status >= 300 && response.status < 400)) throw new ImageModelError('parse', '图片服务返回了重定向地址')
  if (!response.ok) throw new ImageModelError('network', `图片下载失败（HTTP ${response.status}）`, { status: response.status })
  const bytes = await readResponseBytes(response, signal)
  const detectedMime = imageMime(bytes)
  if (!detectedMime) throw new ImageModelError('parse', '图片服务返回了无效图片数据')
  const declaredMime = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (declaredMime && (!declaredMime.startsWith('image/') || declaredMime !== detectedMime)) throw new ImageModelError('parse', '图片服务返回了无效图片格式')
  return { bytes, mimeType: detectedMime }
}

function requestedDimensions(size: string | undefined): { width: number; height: number } | undefined {
  const match = size?.trim().match(/^([1-9]\d{0,4})x([1-9]\d{0,4})$/i)
  if (!match) return undefined
  const width = Number.parseInt(match[1], 10)
  const height = Number.parseInt(match[2], 10)
  return width * height <= 100_000_000 ? { width, height } : undefined
}

async function normalizeOutput(bytes: Uint8Array, sourceMimeType: string, request: ImageRequest): Promise<{
  bytes: Uint8Array
  mimeType: string
  width?: number
  height?: number
  normalization?: { sourceMimeType: string; sourceWidth?: number; sourceHeight?: number }
}> {
  const metadata = await sharp(bytes).metadata()
  const targetSize = requestedDimensions(request.outputSize ?? request.size)
  const targetMime = request.outputFormat === 'jpeg' ? 'image/jpeg' : request.outputFormat === 'webp' ? 'image/webp' : request.outputFormat === 'png' ? 'image/png' : sourceMimeType
  const needsResize = Boolean(targetSize && (metadata.width !== targetSize.width || metadata.height !== targetSize.height))
  const needsFormat = targetMime !== sourceMimeType
  if (!needsResize && !needsFormat) return { bytes, mimeType: sourceMimeType, width: metadata.width, height: metadata.height }

  let pipeline = sharp(bytes).rotate()
  if (targetSize) {
    // Preserve the whole generated frame. Contain avoids both clipping and geometric distortion.
    pipeline = pipeline.resize(targetSize.width, targetSize.height, {
      fit: 'contain',
      kernel: 'lanczos3',
      background: targetMime === 'image/png' ? { r: 0, g: 0, b: 0, alpha: 0 } : { r: 255, g: 255, b: 255, alpha: 1 },
    })
  }
  const quality = request.outputCompression === undefined ? 95 : Math.max(1, Math.min(100, Math.round(request.outputCompression)))
  if (targetMime === 'image/jpeg') pipeline = pipeline.jpeg({ quality, mozjpeg: true })
  else if (targetMime === 'image/webp') pipeline = pipeline.webp({ quality })
  else if (targetMime === 'image/gif') pipeline = pipeline.gif()
  else pipeline = pipeline.png({ compressionLevel: 9 })
  const normalized = new Uint8Array(await pipeline.toBuffer())
  if (normalized.byteLength > MAX_OUTPUT_BYTES) throw new ImageModelError('parse', '标准化后的图片超过 50 MiB')
  const finalMetadata = await sharp(normalized).metadata()
  return {
    bytes: normalized,
    mimeType: targetMime,
    width: finalMetadata.width,
    height: finalMetadata.height,
    normalization: { sourceMimeType, ...(metadata.width ? { sourceWidth: metadata.width } : {}), ...(metadata.height ? { sourceHeight: metadata.height } : {}) },
  }
}

async function persistResponse(response: ImageModelResponse, request: ImageRequest, projectRoot: string | undefined, baseUrl: string, fetchImplementation: FetchImplementation, signal?: AbortSignal): Promise<ImageModelResponse> {
  if (!projectRoot) return response
  const root = await nodeFs.realpath(resolve(projectRoot))
  const outputDirectory = join(root, 'outputs')
  const images = []
  for (const result of response.images) {
    if (signal?.aborted) throw new ImageModelError('cancelled', '图片任务已取消')
    const downloaded = result.b64Json
      ? (() => { const bytes = decodeBase64(result.b64Json as string); return { bytes, mimeType: imageMime(bytes) } })()
      : result.url ? await downloadImage(result.url, baseUrl, fetchImplementation, signal) : undefined
    const detectedMime = downloaded && imageMime(downloaded.bytes)
    if (!downloaded || !detectedMime) throw new ImageModelError('parse', '图片服务未返回可保存的图片')
    const output = await normalizeOutput(downloaded.bytes, detectedMime, request)
    const filePath = join(outputDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}${outputExtension(output.mimeType, result.url)}`)
    if (signal?.aborted) throw new ImageModelError('cancelled', '图片任务已取消')
    await writeAtomic(filePath, output.bytes)
    const { b64Json: _b64Json, url: _url, ...metadata } = result
    images.push({ ...metadata, localPath: filePath, mimeType: output.mimeType, byteLength: output.bytes.byteLength, ...(output.width ? { width: output.width } : {}), ...(output.height ? { height: output.height } : {}), ...(output.normalization ? { normalization: output.normalization } : {}) })
  }
  return { ...response, images }
}

function projectReadFile(
  getProjectRoot: () => string | undefined,
  readFile: (path: string) => Promise<Uint8Array | ImageFileData>,
  getAssetStore?: (projectRoot: string) => ProjectAssetStore,
) {
  return async (path: string): Promise<Uint8Array | ImageFileData> => {
    const root = getProjectRoot()
    if (!root) throw new ImageModelError('invalid_request', '请先打开一个项目')
    const rootPath = await nodeFs.realpath(resolve(root))
    const lexicalPath = isAbsolute(path) ? resolve(path) : resolve(rootPath, path)
    const inside = isWithin(rootPath, lexicalPath)
    if (!inside) {
      let found = false
      if (getAssetStore) {
        try {
          const assets = await getAssetStore(rootPath).list({ projectRoot: rootPath })
          found = assets.some((a) => (isAbsolute(a.relativePath) ? resolve(a.relativePath) === lexicalPath : resolve(rootPath, a.relativePath) === lexicalPath))
        } catch {
          /* ignore lookup error */
        }
      }
      if (!found) throw new ImageModelError('invalid_request', '参考图必须位于当前项目内或已导入素材库中')
    }
    const canonicalPath = await nodeFs.realpath(lexicalPath)
    if (inside && !isWithin(rootPath, canonicalPath)) throw new ImageModelError('invalid_request', '参考图不能通过符号链接离开项目')
    const details = await nodeFs.stat(canonicalPath)
    if (!details.isFile()) throw new ImageModelError('invalid_request', '参考图路径不是文件')
    if (details.size > MAX_REFERENCE_BYTES) throw new ImageModelError('invalid_request', '参考图不能超过 20 MiB')
    return readFile(canonicalPath)
  }
}

export interface ImageModelService extends ImageApi {
  switchProject(): Promise<void>
  dispose(): void
}

export function createImageModelService(store: SettingsStore, options: ImageModelServiceOptions = {}): ImageModelService {
  const bindings = new Map<string, ExecutionBinding>()
  const listeners = new Set<(event: ImageTaskEvent) => void>()
  const defaultReader = options.readFile ?? ((path: string) => nodeFs.readFile(path))
  const taskStore = options.getTaskStore
  let taskWrites: Promise<void> = Promise.resolve()
  let hydratedRoot: string | undefined
  let activeRoot: string | undefined
  let queue: ImageTaskQueue

  const currentRoot = async (): Promise<string | undefined> => {
    const raw = options.getProjectRoot?.()
    if (!raw) return undefined
    try { return await nodeFs.realpath(resolve(raw)) } catch { return resolve(raw) }
  }

  const alignProject = async (): Promise<string | undefined> => {
    const root = await currentRoot()
    if (root === activeRoot) return root
    if (activeRoot !== undefined) {
      const previousQueue = queue
      for (const [taskId, binding] of bindings) if (binding.projectRoot === activeRoot) previousQueue.cancel(taskId)
      previousQueue.dispose()
      queue = createQueue()
    }
    activeRoot = root
    hydratedRoot = undefined
    return root
  }

  const hydrate = async (): Promise<void> => {
    const root = await alignProject()
    if (!root || !taskStore || hydratedRoot === root) return
    hydratedRoot = root
    const persistedStore = taskStore(root)
    if (await persistedStore.isPaused()) queue.pause()
    for (const task of await persistedStore.listImageTasks()) {
      if (!['pending', 'running', 'paused'].includes(task.status)) continue
      const modelProfileId = typeof (task as ImageTaskRecord & { modelProfileId?: unknown }).modelProfileId === 'string'
        ? (task as ImageTaskRecord & { modelProfileId: string }).modelProfileId
        : undefined
      if (!modelProfileId) continue
      try {
        const config = store.getModelExecutionConfig(modelProfileId)
        bindings.set(task.id, { config, projectRoot: root })
        queue.setConnectionConcurrency(config.connection.id, config.connection.maxConcurrency)
        queue.enqueue({ id: task.id, title: task.title, connectionId: config.connection.id, request: task.request, maxRetries: task.maxRetries, deferUntilResume: (task.status as string) === 'paused' })
      } catch { /* stale settings leave the persisted task visible for diagnosis */ }
    }
  }

  const execute: ImageTaskExecutor = async (request, context): Promise<ImageModelResponse> => {
    const binding = bindings.get(context.taskId)
    if (!binding) throw new ImageModelError('invalid_request', '图片任务路由已失效')
    const config = binding.config
    if (config.model.kind !== 'image') throw new ImageModelError('invalid_request', '文本模型不能用于图片生成', { provider: config.connection.providerType })
    if (!OPENAI_IMAGE_PROVIDERS.includes(config.connection.providerType)) {
      throw new ImageModelError('invalid_request', '当前图片服务商暂不支持 OpenAI 图片协议', { provider: config.connection.providerType })
    }
    const adapter = createImageModelAdapter({
      providerType: config.connection.providerType,
      baseUrl: config.connection.baseUrl,
      apiKey: config.apiKey,
      readFile: binding.projectRoot && options.getProjectRoot
        ? projectReadFile(() => binding.projectRoot, defaultReader, options.getAssetStore)
        : defaultReader,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    })
    try {
      const response = await adapter.execute({ ...request, model: config.model.modelId, signal: context.signal } as ImageExecutionRequest)
      return await persistResponse(response, request, binding.projectRoot, config.connection.baseUrl, options.fetch ?? imageFetch(), context.signal)
    } catch (error) {
      throw asModelError(error, config.connection.providerType, config.apiKey)
    }
  }

  const assetStore = options.getAssetStore
  const createQueue = (): ImageTaskQueue => createImageTaskQueue({
    execute,
    retryDelayMs: 2_000,
    onEvent: (event) => {
      const root = bindings.get(event.task.id)?.projectRoot
      if (root && taskStore) {
        const modelProfileId = bindings.get(event.task.id)?.config.model.id
        taskWrites = taskWrites.then(async () => { await taskStore(root).syncImage(event.task, modelProfileId, root) }).catch(() => undefined)
      }
      if (root && assetStore && event.task.status === 'completed' && event.task.result?.images) {
        for (const img of event.task.result.images) {
          if (img.localPath) {
            const promptTitle = event.task.request.prompt.slice(0, 30).trim() || '生成图片'
            taskWrites = taskWrites.then(async () => {
              await assetStore(root).recordGenerated?.({
                projectRoot: root,
                taskId: event.task.id,
                title: promptTitle,
                localPath: img.localPath!,
                mimeType: img.mimeType,
                byteLength: img.byteLength ?? 0,
              })
            }).catch(() => undefined)
          }
        }
      }
      if (root !== activeRoot) return
      for (const listener of listeners) { try { listener(event) } catch { /* observers must not stop task scheduling */ } }
    },
  })
  queue = createQueue()

  const requireId = (value: unknown, message: string): string => {
    if (typeof value !== 'string' || !value.trim()) throw new ImageModelError('invalid_request', message)
    return value.trim()
  }

  return {
    switchProject: async () => { await alignProject(); await hydrate() },
    async enqueue(input) {
      await hydrate()
      const modelProfileId = requireId(input.modelProfileId, '图片模型配置标识缺失')
      const config = store.getModelExecutionConfig(modelProfileId)
      if (config.model.kind !== 'image') throw new ImageModelError('invalid_request', '请选择图片模型')
      queue.setConnectionConcurrency(config.connection.id, config.connection.maxConcurrency)
      const taskId = input.id?.trim() || randomUUID()
      const projectRoot = activeRoot
      bindings.set(taskId, { config, ...(projectRoot ? { projectRoot } : {}) })
      try {
        const record = queue.enqueue({
          id: taskId,
          title: input.title,
          connectionId: config.connection.id,
          request: taskRequest(input, config.model.modelId),
          maxRetries: input.maxRetries ?? DEFAULT_IMAGE_RETRIES,
        })
        await taskWrites
        return record
      } catch (error) {
        bindings.delete(taskId)
        throw error
      }
    },
    list: async (input = {}) => {
      await hydrate()
      if (input.archived === true) {
        const root = activeRoot
        return root && taskStore ? taskStore(root).listImageTasks({ archived: true }) : []
      }
      const current = queue.list()
      const root = activeRoot
      if (!root) return current
      if (!taskStore) return current
      const persisted = await taskStore(root).listImageTasks()
      const ids = new Set(current.map((task) => task.id))
      return [...current.filter((task) => bindings.get(task.id)?.projectRoot === root), ...persisted.filter((task) => !ids.has(task.id))]
    },
    get: async (taskId) => {
      await hydrate()
      const id = requireId(taskId, '图片任务标识缺失')
      const current = queue.get(id)
      const root = activeRoot
      if (current && (!root || bindings.get(id)?.projectRoot === root)) { await taskWrites; return current }
      if (!root) return null
      return taskStore ? (await taskStore(root).listImageTasks()).find((task) => task.id === id) ?? null : null
    },
    cancel: async (taskId) => {
      await hydrate()
      const id = requireId(taskId, '图片任务标识缺失')
      if (activeRoot && bindings.get(id)?.projectRoot !== activeRoot) return false
      return queue.cancel(id)
    },
    retry: async (taskId) => {
      await hydrate()
      const id = requireId(taskId, '图片任务标识缺失')
      if (activeRoot && bindings.get(id)?.projectRoot !== activeRoot) return false
      return queue.retry(id)
    },
    archive: async (taskId) => {
      await hydrate()
      const id = requireId(taskId, '图片任务标识缺失')
      const root = activeRoot
      if (!root || !taskStore) return false
      await taskWrites
      const archived = await taskStore(root).archive(id)
      if (archived) {
        queue.remove(id)
        bindings.delete(id)
      }
      return archived
    },
    restore: async (taskId) => {
      await hydrate()
      const id = requireId(taskId, '图片任务标识缺失')
      const root = activeRoot
      return Boolean(root && taskStore && await taskStore(root).restore(id))
    },
    remove: async (taskId: string, localPath?: string) => {
      await hydrate()
      const id = requireId(taskId, '图片任务标识缺失')
      const root = activeRoot
      if (!root) return false
      await taskWrites

      const filesToDelete = new Set<string>()
      const shouldDeleteFiles = Boolean(localPath && typeof localPath === 'string' && localPath.trim())
      if (shouldDeleteFiles) {
        filesToDelete.add(localPath!.trim())
        if (taskStore) {
          try {
            const task = await taskStore(root).get(id)
            const imageRecord = (task?.payload?.imageTask ?? task?.payload) as ImageTaskRecord | undefined
            if (imageRecord?.result?.images) {
              for (const img of imageRecord.result.images) {
                if (img.localPath) filesToDelete.add(img.localPath)
              }
            }
          } catch {
            /* ignore task lookup error */
          }
        }

        const queuedTask = queue.get(id)
        if (queuedTask?.result?.images) {
          for (const img of queuedTask.result.images) {
            if (img.localPath) filesToDelete.add(img.localPath)
          }
        }

        const outputsDir = resolve(root, 'outputs')
        for (const file of filesToDelete) {
          try {
            const lexical = isAbsolute(file) ? resolve(file) : resolve(root, file)
            const canonical = await nodeFs.realpath(lexical).catch(() => lexical)
            if (isWithin(root, canonical) || isWithin(outputsDir, canonical)) {
              await nodeFs.unlink(canonical)
            }
          } catch {
            /* best effort deletion */
          }
        }
      }

      if (assetStore) {
        try {
          await assetStore(root).remove({ projectRoot: root, id })
        } catch {
          /* ignore if not in assetStore */
        }
      }

      let removed = false
      if (taskStore) {
        removed = await taskStore(root).remove(id)
      }
      queue.remove(id)
      bindings.delete(id)
      return removed || filesToDelete.size > 0
    },
    pause: async (connectionId) => {
      await hydrate()
      const id = connectionId ? requireId(connectionId, '连接标识缺失') : undefined
      queue.pause(id)
      const root = activeRoot
      if (!id && root && taskStore) await taskStore(root).pause()
    },
    resume: async (connectionId) => {
      await hydrate()
      const id = connectionId ? requireId(connectionId, '连接标识缺失') : undefined
      queue.resume(id)
      const root = activeRoot
      if (!id && root && taskStore) await taskStore(root).resume()
    },
    setConnectionConcurrency: async ({ connectionId, maxConcurrency }) => queue.setConnectionConcurrency(requireId(connectionId, '连接标识缺失'), maxConcurrency),
    onTaskEvent: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    dispose: () => { queue.dispose(); listeners.clear(); bindings.clear() },
  }
}
