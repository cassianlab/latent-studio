import { afterEach, describe, expect, it } from 'vitest'
import { dispatchCanvasContent, normalizeCanvasContent, subscribeCanvasContent } from '../../src/components/canvas/canvas-content-bridge'

const originalWindow = globalThis.window

afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow })
  else Reflect.deleteProperty(globalThis, 'window')
})

describe('canvas content bridge', () => {
  it('keeps a real image source and rejects blank content', () => {
    expect(normalizeCanvasContent({ title: '结果图', source: ' data:image/png;base64,abc ', mimeType: 'image/png' })).toEqual({ type: 'image', title: '结果图', source: 'data:image/png;base64,abc', mimeType: 'image/png' })
    expect(normalizeCanvasContent({ title: '空结果', source: '  ' })).toBeNull()
  })

  it('delivers content published before the canvas page mounts', () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() })
    expect(dispatchCanvasContent({ id: 'asset-real', title: '项目素材', source: 'data:image/png;base64,abc' })).toBe(true)
    const received: string[] = []
    const unsubscribe = subscribeCanvasContent((content) => received.push(content.title))
    expect(received).toEqual(['项目素材'])
    unsubscribe()
  })
})
