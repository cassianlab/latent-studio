import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendSkillRunLog } from '../../src/main/agent/run-log'

describe('skill run log', () => {
  it('records bounded output and redacts credential-shaped values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-skill-log-'))
    await appendSkillRunLog(root, { path: '/tmp/skill.js', entrypoint: 'skill.js', runtime: 'node', installation: { id: 'skill-1', name: 'test', displayName: '测试', rootPath: '/tmp', scope: 'global', source: 'link', enabled: true, trusted: true, trustMode: 'controlled', contentHash: 'hash-1', updatedAt: '' } }, { skillId: 'skill-1', entrypoint: 'skill.js', runtime: 'node', exitCode: 0, stdout: 'apiKey=secret-value', stderr: '', truncated: false, timedOut: false, durationMs: 3 })
    const line = (await readFile(join(root, '.latent-studio', 'skill-runs.jsonl'), 'utf8')).trim()
    expect(JSON.parse(line)).toMatchObject({ skillId: 'skill-1', entrypoint: 'skill.js', contentHash: 'hash-1', stdout: 'apiKey=[已隐藏]' })
  })
})
