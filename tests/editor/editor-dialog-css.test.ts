import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const editorCssPath = new URL('../../src/renderer/editor/editor.css', import.meta.url)

describe('image editor dialog layering', () => {
  it('keeps the editor content above its blurred overlay', async () => {
    const css = await readFile(editorCssPath, 'utf8')
    const rules = (selector: string) =>
      [...css.matchAll(new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'g'))].map((match) => match[1])

    expect(rules('\\.editor-overlay')).toContainEqual(expect.stringContaining('z-index: 1200 !important'))
    expect(rules('\\.editor-dialog')).toEqual(
      expect.arrayContaining([
        expect.stringContaining('z-index: 1201 !important'),
        expect.stringContaining('filter: none !important'),
        expect.stringContaining('backdrop-filter: none !important'),
      ]),
    )
  })

  it('shows transparent pixels on a checkerboard in every editor preview mode', async () => {
    const css = await readFile(editorCssPath, 'utf8')

    expect(css).toMatch(/\.canvas-stage-wrapper,\s*\.curtain-container,\s*\.curtain-layer,\s*\.side-card-body\s*\{[^}]*background-color:\s*#f3f0ea[^}]*background-image:\s*linear-gradient/s)
  })
})
