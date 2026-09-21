import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { APP_VERSION } from '../../src/shared/app-version'

describe('release metadata', () => {
  it('keeps the renderer version aligned with package.json', () => {
    const packageJson = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
    expect(APP_VERSION).toBe(packageJson.version)
  })

  it('allows HTTPS thumbnails from every supported remote catalog', () => {
    const html = readFileSync(resolve('index.html'), 'utf8')
    const policy = html.match(/Content-Security-Policy\" content=\"([^\"]+)/)?.[1] ?? ''
    const imageSources = policy.match(/img-src ([^;]+)/)?.[1] ?? ''
    expect(imageSources.split(/\s+/)).toContain('https:')
  })
})
