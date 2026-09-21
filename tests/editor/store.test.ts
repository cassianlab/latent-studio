import { mkdir, readFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ImageEditorStore } from '../../src/main/editor/store'

describe('image editor version store', () => {
  it('persists marked image bytes and parent metadata atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-editor-'))
    await mkdir(root, { recursive: true })
    const store = new ImageEditorStore(root)
    const dataUrl = `data:image/png;base64,${Buffer.from('marked-image').toString('base64')}`
    const version = await store.saveVersion({ title: '雨夜修改', parentVersionId: 'v1', markedDataUrl: dataUrl, suggestion: '移除路人' })
    expect(version.parentVersionId).toBe('v1')
    expect(version.markedImagePath).toMatch(/^outputs\/editor\/.+\.png$/)
    expect(await readFile(join(root, version.markedImagePath), 'utf8')).toBe('marked-image')
    expect((await store.listVersions()).map((item) => item.id)).toEqual([version.id])
    await expect(store.getVersionPreview(version.id)).resolves.toMatch(/^data:image\/png;base64,/)
    await expect(store.getVersionPreview('missing')).resolves.toBeNull()
  })

  it('rejects non-image data URLs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-editor-invalid-'))
    const store = new ImageEditorStore(root)
    await expect(store.saveVersion({ title: '无效', markedDataUrl: 'data:text/plain;base64,eA==', suggestion: '修改' })).rejects.toThrow('必须是 PNG、JPEG 或 WebP')
  })
})
