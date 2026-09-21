import type { ProjectAsset } from './contracts/library'
import type { ImageReference } from './contracts/images'

export const MAX_REFERENCE_IMAGES = 8
export const MAX_REFERENCE_IMAGE_BYTES = 20 * 1024 * 1024

export type ReferenceAsset = ProjectAsset & {
  /** Renderer-only image data for a reference that must not be written to the project library. */
  transientDataUrl?: string
}

function dataUrlByteLength(dataUrl: string): number {
  const encoded = dataUrl.split(',', 2)[1] ?? ''
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(encoded.length * 3 / 4) - padding)
}

export function createTemporarySketchReference(input: {
  id: string
  name: string
  dataUrl: string
  createdAt: string
}): ReferenceAsset {
  const name = input.name.toLowerCase().endsWith('.png') ? input.name : `${input.name}.png`
  return {
    id: input.id,
    name,
    sourceName: name,
    relativePath: '',
    category: 'reference',
    extension: '.png',
    mimeType: 'image/png',
    byteLength: dataUrlByteLength(input.dataUrl),
    modifiedAt: input.createdAt,
    importedAt: input.createdAt,
    previewable: true,
    transientDataUrl: input.dataUrl,
  }
}

export function referenceAssetToImageReference(asset: ReferenceAsset): ImageReference {
  if (asset.transientDataUrl) {
    return {
      type: 'data',
      data: asset.transientDataUrl,
      filename: asset.name,
      mimeType: asset.mimeType,
    }
  }
  return {
    type: 'file',
    path: asset.relativePath,
    filename: asset.name,
    mimeType: asset.mimeType,
  }
}

const SUPPORTED_REFERENCE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export function isSupportedReferenceMimeType(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && SUPPORTED_REFERENCE_MIME_TYPES.has(mimeType.split(';', 1)[0].trim().toLowerCase())
}

export function detectReferenceImageMimeType(bytes: Uint8Array): 'image/png' | 'image/jpeg' | 'image/webp' | undefined {
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return 'image/png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'image/webp'
  return undefined
}

export function referenceCapabilityError(capabilities: readonly string[], count: number): string | null {
  if (count < 1) return null
  if (count > MAX_REFERENCE_IMAGES) return `单轮最多添加 ${MAX_REFERENCE_IMAGES} 张参考图`
  const supportsSingle = capabilities.includes('reference-image') || capabilities.includes('multi-reference')
  if (!supportsSingle) return '当前图片模型未声明参考图能力，请更换模型或移除参考图'
  if (count > 1 && !capabilities.includes('multi-reference')) return '当前图片模型未声明多参考图能力，请更换模型或只保留一张参考图'
  return null
}
