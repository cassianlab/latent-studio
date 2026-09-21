import { afterEach, describe, expect, it } from 'vitest'
import { getLibraryApi } from '../../src/renderer/library/library-api'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow) globalThis.window = originalWindow
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('renderer library api', () => {
  it('keeps preview prompt scope and search consistent with the host contract', async () => {
    Reflect.deleteProperty(globalThis, 'window')
    const api = getLibraryApi()
    const item = await api.savePrompt({ name: '标准商品图模板', content: '统一背景和品牌色', scope: 'project', kind: 'template', tags: ['商品图'] })
    try {
      expect(await api.listPrompts({ scope: 'global' })).not.toContainEqual(item)
      expect(await api.listPrompts({ scope: 'project', search: '商品图' })).toContainEqual(item)
      expect(await api.listPrompts({ scope: 'project', search: '无匹配关键词' })).not.toContainEqual(item)
    } finally {
      await api.removePrompt({ id: item.id, scope: item.scope })
    }
  })

  it('imports assets with filePaths and category in mock mode', async () => {
    Reflect.deleteProperty(globalThis, 'window')
    const api = getLibraryApi()
    const imported = await api.importAssets({ filePaths: ['/tmp/outputs/shot-1.png'], category: 'output' })

    expect(imported).toHaveLength(1)
    expect(imported[0]).toMatchObject({
      name: 'shot-1.png',
      category: 'output',
      mimeType: 'image/png',
      previewable: true,
    })

    const list = await api.listAssets({ category: 'output' })
    expect(list.some((item) => item.name === 'shot-1.png')).toBe(true)
  })

  it('saves a browser-preview sketch as a reference asset with its preview', async () => {
    Reflect.deleteProperty(globalThis, 'window')
    const api = getLibraryApi()
    const dataUrl = 'data:image/png;base64,iVBORw0KGgo='
    const saved = await api.saveReferenceImage({ name: '构图草图', dataUrl })
    expect(saved).toMatchObject({ category: 'reference', mimeType: 'image/png', name: '构图草图.png' })
    await expect(api.getAssetPreview({ id: saved.id })).resolves.toBe(dataUrl)
  })

  it('preserves memory categories in browser preview mode', async () => {
    Reflect.deleteProperty(globalThis, 'window')
    const api = getLibraryApi()
    const saved = await api.saveMemory({
      title: '预览模式记忆分类',
      content: '默认使用复古风格。',
      scope: 'global',
      category: 'visual-style',
    })

    try {
      expect(saved.category).toBe('visual-style')
      await expect(api.updateMemory({
        id: saved.id,
        scope: saved.scope,
        category: 'color-palette',
      })).resolves.toMatchObject({ category: 'color-palette' })
    } finally {
      await api.removeMemory({ id: saved.id, scope: saved.scope })
    }
  })

  it('delegates to host preload api when window.latentStudio is available', async () => {
    const mockHost = {
      importAssets: async () => [{ id: 'mock-1', name: 'img.png', relativePath: 'assets/img.png', sourceName: 'img.png', category: 'output' as const, byteLength: 10, modifiedAt: '', importedAt: '', previewable: true }],
    }
    globalThis.window = { latentStudio: { library: mockHost } } as typeof window
    expect(getLibraryApi()).toBe(mockHost as never)
  })
})
