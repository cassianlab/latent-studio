import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runSkill } from '../../src/main/agent/skill-runner'

describe('skill runner', () => {
  it('runs a trusted Node script with bounded output and no shell interpolation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-skill-runner-'))
    await mkdir(join(root, 'scripts'))
    const path = join(root, 'scripts', 'echo.js')
    await writeFile(path, 'process.stdout.write(process.argv.slice(2).join("|"))')
    const result = await runSkill({
      run: { path, entrypoint: 'scripts/echo.js', runtime: 'node', installation: { id: 'skill-1', name: 'test', displayName: '测试', rootPath: root, scope: 'global', source: 'link', enabled: true, trusted: true, trustMode: 'controlled', contentHash: 'hash', updatedAt: '' } },
      args: ['a b', '$(touch should-not-run)'],
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('a b|$(touch should-not-run)')
    expect(result.timedOut).toBe(false)
  })

  it('terminates a script that exceeds the timeout', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-skill-runner-timeout-'))
    const path = join(root, 'wait.js')
    await writeFile(path, 'setTimeout(() => process.stdout.write("late"), 1000)')
    const result = await runSkill({
      run: { path, entrypoint: 'wait.js', runtime: 'node', installation: { id: 'skill-2', name: 'test', displayName: '测试', rootPath: root, scope: 'global', source: 'link', enabled: true, trusted: true, trustMode: 'controlled', contentHash: 'hash', updatedAt: '' } },
      timeoutMs: 30,
    })
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).not.toBe(0)
  })

  it('does not pass credential-shaped environment variables to trusted scripts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-skill-runner-env-'))
    const path = join(root, 'env.js')
    await writeFile(path, 'process.stdout.write(process.env.LATENT_STUDIO_TEST_API_KEY || "missing")')
    const previous = process.env.LATENT_STUDIO_TEST_API_KEY
    process.env.LATENT_STUDIO_TEST_API_KEY = 'must-not-leak'
    try {
      const result = await runSkill({
        run: { path, entrypoint: 'env.js', runtime: 'node', installation: { id: 'skill-3', name: 'test', displayName: '测试', rootPath: root, scope: 'global', source: 'link', enabled: true, trusted: true, trustMode: 'full', contentHash: 'hash', updatedAt: '' } },
      })
      expect(result.stdout).toBe('missing')
    } finally {
      if (previous === undefined) delete process.env.LATENT_STUDIO_TEST_API_KEY
      else process.env.LATENT_STUDIO_TEST_API_KEY = previous
    }
  })

  it('terminates a running script when its abort signal fires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-skill-runner-cancel-'))
    const path = join(root, 'wait.js')
    await writeFile(path, 'setTimeout(() => process.stdout.write("late"), 1000)')
    const controller = new AbortController()
    const resultPromise = runSkill({
      run: { path, entrypoint: 'wait.js', runtime: 'node', installation: { id: 'skill-4', name: 'test', displayName: '测试', rootPath: root, scope: 'global', source: 'link', enabled: true, trusted: true, trustMode: 'controlled', contentHash: 'hash', updatedAt: '' } },
      signal: controller.signal,
    })
    await new Promise((resolve) => setTimeout(resolve, 25))
    controller.abort()
    const result = await resultPromise
    expect(result.signal).toBeTruthy()
    expect(result.stdout).toBe('')
  })
})
