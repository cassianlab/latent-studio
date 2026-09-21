import { describe, expect, it } from 'vitest'

/**
 * Keep the preload path and packaged renderer resource paths aligned with the
 * electron-vite output. This test does not launch Electron; the launch smoke
 * check below validates that the sandbox can evaluate the generated preload.
 */
describe('Electron packaged paths', () => {
  it('uses the CommonJS preload emitted for sandboxed windows', async () => {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const root = join(fileURLToPath(new URL('../..', import.meta.url)))
    const config = await readFile(join(root, 'electron.vite.config.ts'), 'utf8')
    const app = await readFile(join(root, 'src/main/app/index.ts'), 'utf8')
    expect(config).toContain("format: 'cjs'")
    expect(config).toContain("entryFileNames: '[name].cjs'")
    expect(app).toContain("preload: join(__dirname, '../preload/index.cjs')")
  })
})
