import { describe, expect, it } from 'vitest'
import { detectReferenceImageMimeType, MAX_REFERENCE_IMAGES, isSupportedReferenceMimeType, referenceCapabilityError } from '../../src/shared/reference-images'

describe('reference image constraints', () => {
  it('accepts only provider-safe image formats', () => {
    expect(isSupportedReferenceMimeType('image/png')).toBe(true)
    expect(isSupportedReferenceMimeType('image/jpeg')).toBe(true)
    expect(isSupportedReferenceMimeType('image/webp')).toBe(true)
    expect(isSupportedReferenceMimeType('image/gif')).toBe(false)
    expect(isSupportedReferenceMimeType('application/pdf')).toBe(false)
  })

  it('reports model capability and quantity failures', () => {
    expect(MAX_REFERENCE_IMAGES).toBe(8)
    expect(referenceCapabilityError([], 1)).toContain('参考图能力')
    expect(referenceCapabilityError(['reference-image'], 2)).toContain('多参考图能力')
    expect(referenceCapabilityError(['reference-image', 'multi-reference'], 2)).toBeNull()
    expect(referenceCapabilityError(['multi-reference'], 9)).toContain('最多添加 8 张')
  })

  it('detects PNG, JPEG and WebP signatures instead of trusting file extensions', () => {
    expect(detectReferenceImageMimeType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(detectReferenceImageMimeType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(detectReferenceImageMimeType(new TextEncoder().encode('RIFF1234WEBP'))).toBe('image/webp')
    expect(detectReferenceImageMimeType(new TextEncoder().encode('not an image'))).toBeUndefined()
  })
})
