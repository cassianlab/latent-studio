import type { ImageResult } from '../../shared/contracts/images'

export interface TaskImagePreview {
  src: string
  width?: number
  height?: number
  aspectRatio?: string
}

function imageSource(result: ImageResult): string | undefined {
  if (result.localPath) return encodeURI(`file://${result.localPath}`)
  if (result.b64Json) return `data:${result.mimeType || 'image/png'};base64,${result.b64Json}`
  return result.url
}

export function resolveTaskImagePreviews(images: readonly ImageResult[]): TaskImagePreview[] {
  return images.flatMap((result) => {
    const src = imageSource(result)
    if (!src) return []
    const hasDimensions = Boolean(result.width && result.height)
    return [{
      src,
      ...(hasDimensions ? {
        width: result.width,
        height: result.height,
        aspectRatio: `${result.width} / ${result.height}`,
      } : {}),
    }]
  })
}
