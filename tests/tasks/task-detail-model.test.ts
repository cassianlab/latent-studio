import { describe, expect, it } from 'vitest'
import { resolveTaskImagePreviews } from '../../src/renderer/tasks/task-detail-model'
import type { ImageResult } from '../../src/shared/contracts/images'

describe('task detail image previews', () => {
  it('keeps every generated image and its original aspect ratio metadata', () => {
    const images: ImageResult[] = [
      { localPath: '/tmp/wide image.png', width: 1536, height: 1024, mimeType: 'image/png' },
      { b64Json: 'AAAA', width: 1024, height: 1536, mimeType: 'image/webp' },
      { url: 'https://example.com/square.png', width: 1024, height: 1024 },
    ]

    expect(resolveTaskImagePreviews(images)).toEqual([
      { src: 'file:///tmp/wide%20image.png', width: 1536, height: 1024, aspectRatio: '1536 / 1024' },
      { src: 'data:image/webp;base64,AAAA', width: 1024, height: 1536, aspectRatio: '1024 / 1536' },
      { src: 'https://example.com/square.png', width: 1024, height: 1024, aspectRatio: '1024 / 1024' },
    ])
  })

  it('drops empty provider results instead of rendering broken thumbnails', () => {
    expect(resolveTaskImagePreviews([{}, { url: 'https://example.com/result.png' }])).toEqual([
      { src: 'https://example.com/result.png' },
    ])
  })
})
