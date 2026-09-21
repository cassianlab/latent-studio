import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import type { SkillRunResult } from '../../shared/contracts/agent'
import type { ResolvedSkillScript } from '../skills/store'

const MAX_LOG_OUTPUT = 4_000

function redact(value: string): string {
  return value.replace(/((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)([^\s,;]+)/gi, '$1[已隐藏]').slice(0, MAX_LOG_OUTPUT)
}

export interface SkillRunLog {
  recordedAt: string
  skillId: string
  entrypoint: string
  contentHash: string
  runtime: ResolvedSkillScript['runtime']
  exitCode: number | null
  signal?: string
  timedOut: boolean
  truncated: boolean
  durationMs: number
  stdout: string
  stderr: string
}

export async function appendSkillRunLog(root: string, script: ResolvedSkillScript, result: SkillRunResult): Promise<void> {
  const path = join(root, '.latent-studio', 'skill-runs.jsonl')
  const item: SkillRunLog = { recordedAt: new Date().toISOString(), skillId: script.installation.id, entrypoint: script.entrypoint, contentHash: script.installation.contentHash, runtime: script.runtime, exitCode: result.exitCode, ...(result.signal ? { signal: result.signal } : {}), timedOut: result.timedOut, truncated: result.truncated, durationMs: result.durationMs, stdout: redact(result.stdout), stderr: redact(result.stderr) }
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.appendFile(path, `${JSON.stringify(item)}\n`, 'utf8')
}
