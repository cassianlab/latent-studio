import { describe, expect, it, vi } from 'vitest'
import { releasePromptLibraryResources } from '../../src/main/library/cache'

describe('prompt library resource cleanup', () => {
  it('clears the Electron HTTP cache when the prompt library is released', async () => {
    const clearCache = vi.fn(async () => {})

    await releasePromptLibraryResources({ clearCache })

    expect(clearCache).toHaveBeenCalledOnce()
  })

  it('is safe when no browser session is available', async () => {
    await expect(releasePromptLibraryResources()).resolves.toBeUndefined()
  })
})
