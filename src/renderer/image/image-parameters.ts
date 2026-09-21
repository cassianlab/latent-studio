import type { ComposerSubmitOptions } from '../../components/ai-input-bar/WorkbenchComposer'
import type { ImageBackground, ImageOutputFormat, ImageQuality } from '../../shared/contracts/images'
import type { ProjectContextDocument } from '../../shared/contracts/context'
import { appendAttachmentContext } from '../../shared/context-attachments'

export type ImageParameters = NonNullable<ComposerSubmitOptions['parameters']>

const EXPLICIT_RATIOS = ['21:9', '16:9', '9:16', '5:4', '4:5', '4:3', '3:4', '3:2', '2:3', '1:1'] as const

export function resolveAgentImageParameters(
  prompt: string,
  defaults?: ComposerSubmitOptions['parameters'],
): ImageParameters {
  const next: ImageParameters = {
    ratio: defaults?.ratio ?? '1:1 方形',
    resolution: defaults?.resolution ?? '2K',
    quality: defaults?.quality ?? '自动',
    ...(defaults?.format ? { format: defaults.format } : {}),
    ...(defaults?.background ? { background: defaults.background } : {}),
  }
  const compact = prompt.replace(/\s+/g, ' ')
  const explicitRatio = EXPLICIT_RATIOS.find((ratio) => new RegExp(`(^|[^0-9])${ratio.replace(':', '\\s*[:：]\\s*')}([^0-9]|$)`, 'i').test(compact))
  if (explicitRatio) next.ratio = explicitRatio
  else if (/(竖版|竖图|纵向|portrait)/i.test(compact)) next.ratio = '9:16 竖版'
  else if (/(横版|横图|横向|landscape)/i.test(compact)) next.ratio = '16:9 横版'
  else if (/(方形|正方形|square)/i.test(compact)) next.ratio = '1:1 方形'

  const resolution = compact.match(/(?:^|[^0-9])([124])\s*[kK](?:[^0-9]|$)/)?.[1]
  if (resolution) next.resolution = `${resolution}K`
  if (/(最高质量|最高画质|极致质量)/i.test(compact)) next.quality = '最高'
  else if (/(超高质量|超高画质)/i.test(compact)) next.quality = '超高'
  else if (/(高清|高质量|高画质|high quality|\bhd\b)/i.test(compact)) next.quality = '高'

  const format = compact.match(/\b(png|jpe?g|webp)\b/i)?.[1]
  if (format) next.format = /^jpe?g$/i.test(format) ? 'JPG' : format.toUpperCase()
  if (/(透明背景|transparent background)/i.test(compact)) next.background = '透明'
  else if (/(不透明背景|opaque background)/i.test(compact)) next.background = '不透明'
  return next
}

export function resolveImageQuality(
  parameters?: ComposerSubmitOptions['parameters']
): ImageQuality {
  if (!parameters?.quality) return 'auto'
  const q = parameters.quality.toLowerCase()
  if (q === '最高' || q === 'max' || q === 'ultra') return 'max'
  if (q === '超高' || q === 'xhigh') return 'xhigh'
  if (q === '高' || q === 'high' || q === 'hd') return 'high'
  if (q === '中' || q === 'medium' || q === 'standard') return 'medium'
  if (q === '低' || q === 'low') return 'low'
  return 'auto'
}

export function resolveImageOutputFormat(parameters?: ComposerSubmitOptions['parameters']): ImageOutputFormat {
  const format = parameters?.format?.trim().toLocaleLowerCase()
  if (/^(透明|transparent)$/i.test(parameters?.background?.trim() ?? '') && format !== 'webp') return 'png'
  if (format === 'jpg' || format === 'jpeg') return 'jpeg'
  if (format === 'webp') return 'webp'
  return 'png'
}

export function isGptImage25Model(modelIdOrName?: string | null): boolean {
  if (!modelIdOrName) return false
  return /gpt[-_]?image[-_]?2[._-]?5/i.test(modelIdOrName)
}

export function resolveImageBackground(
  modelIdOrName: string | null | undefined,
  parameters?: ComposerSubmitOptions['parameters'],
): ImageBackground | undefined {
  if (!isGptImage25Model(modelIdOrName)) return undefined
  const background = parameters?.background?.trim().toLocaleLowerCase()
  if (background === '透明' || background === 'transparent') return 'transparent'
  if (background === '不透明' || background === 'opaque') return 'opaque'
  return 'auto'
}

const GPT_IMAGE_MIN_PIXELS = 655_360
const GPT_IMAGE_MAX_PIXELS = 8_294_400
const GPT_IMAGE_MAX_EDGE = 3_840

function gptImageSize(ratio: string, resolution: string): string {
  const match = ratio.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/)
  const ratioWidth = Math.max(1, Number(match?.[1] ?? 1))
  const ratioHeight = Math.max(1, Number(match?.[2] ?? 1))
  const targetEdge = resolution === '4K' ? GPT_IMAGE_MAX_EDGE : resolution === '1K' ? 1_024 : 2_048
  const ratioEdge = Math.max(ratioWidth, ratioHeight)
  let scale = targetEdge / ratioEdge
  const dimensions = () => ({
    width: Math.max(16, Math.round((ratioWidth * scale) / 16) * 16),
    height: Math.max(16, Math.round((ratioHeight * scale) / 16) * 16),
  })

  let size = dimensions()
  let pixels = size.width * size.height
  if (pixels > GPT_IMAGE_MAX_PIXELS) {
    scale *= Math.sqrt(GPT_IMAGE_MAX_PIXELS / pixels)
    size = dimensions()
    pixels = size.width * size.height
  }
  while (pixels < GPT_IMAGE_MIN_PIXELS && size.width < GPT_IMAGE_MAX_EDGE && size.height < GPT_IMAGE_MAX_EDGE) {
    scale *= 1.01
    size = dimensions()
    pixels = size.width * size.height
  }
  while ((pixels > GPT_IMAGE_MAX_PIXELS || size.width > GPT_IMAGE_MAX_EDGE || size.height > GPT_IMAGE_MAX_EDGE) && scale > 16 / ratioEdge) {
    scale *= 0.99
    size = dimensions()
    pixels = size.width * size.height
  }
  return `${size.width}x${size.height}`
}

export interface ResolveImageSpecInput {
  providerType?: string
  modelId: string
  ratio?: string
  resolution?: string
  quality?: string
  background?: string
}

export interface ResolvedImageSpec {
  size?: string
  outputSize?: string
  quality: ImageQuality
  background?: ImageBackground
  degraded: boolean
  degradeReason?: string
  warnings?: string[]
}

export function resolveImageOutputSize(parameters?: ComposerSubmitOptions['parameters']): string | null {
  if (/^(自动|auto)$/i.test(parameters?.ratio?.trim() ?? '')) return null
  const ratio = parameters?.ratio?.match(/^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/)
  const widthRatio = ratio ? Number(ratio[1]) : 1
  const heightRatio = ratio ? Number(ratio[2]) : 1
  if (!widthRatio || !heightRatio || widthRatio > 100 || heightRatio > 100) return '2048x2048'
  return gptImageSize(`${widthRatio}:${heightRatio}`, parameters?.resolution?.toUpperCase() ?? '2K')
}

export function resolveImageSpec(input: ResolveImageSpecInput): ResolvedImageSpec {
  const modelId = input.modelId || ''
  const ratio = (input.ratio || '1:1').toLowerCase()
  const resolution = (input.resolution || '2K').toUpperCase()
  const size = /^(自动|auto)$/i.test(ratio.trim()) ? undefined : gptImageSize(ratio, resolution)
  const outputSize = size
  const requestedQuality = resolveImageQuality(input.quality ? { quality: input.quality, ratio: input.ratio ?? '1:1', resolution: input.resolution ?? '2K' } : undefined)
  const quality = isGptImage25Model(modelId) ? requestedQuality : requestedQuality === 'xhigh' || requestedQuality === 'max' ? 'high' : requestedQuality
  const background = resolveImageBackground(modelId, { ratio: input.ratio ?? '1:1', resolution: input.resolution ?? '2K', quality: input.quality ?? '自动', background: input.background })
  const degraded = Boolean(size && outputSize && resolution === '4K' && size !== outputSize)
  const degradeReason = degraded
    ? `GPT Image 使用官方尺寸上限 ${size} 生成，本地按 ${outputSize} 导出；本地导出可能包含重采样`
    : undefined
  return {
    size,
    outputSize,
    quality,
    ...(background ? { background } : {}),
    degraded,
    ...(degradeReason ? { degradeReason } : {}),
  }
}

export function enrichPromptWithParameters(
  prompt: string,
  _parameters?: ComposerSubmitOptions['parameters']
): string {
  return prompt.trim()
}

export function buildImagePlanningPrompt(prompt: string, documents: readonly ProjectContextDocument[]): string {
  return appendAttachmentContext(prompt, documents)
}

export function buildImageProviderPrompt(
  prompt: string,
  parameters?: ComposerSubmitOptions['parameters'],
  memoryContext?: string,
): string {
  const providerPrompt = enrichPromptWithParameters(prompt, parameters)
  return memoryContext ? `${providerPrompt}\n\n${memoryContext}` : providerPrompt
}
