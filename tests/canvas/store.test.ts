import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CanvasStore } from '../../src/main/canvas/store'
import type { CanvasState } from '../../src/shared/contracts/canvas'

const state: CanvasState = {
  version: 1,
  items: [{ id: 'scene', type: 'image', title: '雨夜便利店', x: 10, y: 20, width: 300, height: 180 }],
  links: [],
  viewport: { scale: 1.2, position: { x: 24, y: -8 } },
  selection: { selectedId: 'scene', selectedIds: ['scene'], selectedLinkId: null },
}

async function projectRoot() {
  return mkdtemp(join(tmpdir(), 'latent-canvas-'))
}

describe('CanvasStore', () => {
  it('saves project canvas state atomically and restores it after reopening', async () => {
    const root = await projectRoot()
    const first = new CanvasStore(root)
    await expect(first.load()).resolves.toBeNull()
    await expect(first.save(state)).resolves.toEqual(state)
    const reopened = new CanvasStore(root)
    await expect(reopened.load()).resolves.toEqual(state)
    await expect(readFile(join(root, '.latent-studio', 'canvas.json'), 'utf8')).resolves.toContain('"version": 1')
  })

  it('rejects malformed or cross-project canvas state', async () => {
    const root = await projectRoot()
    const store = new CanvasStore(root)
    await expect(store.save({ ...state, version: 2 as 1 })).rejects.toThrow('画布数据无效')
    await expect(store.save({ ...state, items: [{ ...state.items[0], id: '../outside' }] })).rejects.toThrow('画布数据无效')
  })
})
