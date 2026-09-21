import { spawn } from 'node:child_process'
import { dirname } from 'node:path'
import type { SkillRunResult } from '../../shared/contracts/agent'
import type { ResolvedSkillScript } from '../skills/store'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 10 * 60_000
const DEFAULT_OUTPUT_BYTES = 256 * 1024
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_ARGS = 64
const MAX_ARG_LENGTH = 4_096

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new Error(`Skill 参数需要是 1-${maximum} 的整数`)
  return value
}

function safeArgs(args: readonly string[] | undefined): string[] {
  if (args === undefined) return []
  if (!Array.isArray(args) || args.length > MAX_ARGS) throw new Error(`Skill 参数不能超过 ${MAX_ARGS} 个`)
  return args.map((arg) => {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_LENGTH || arg.includes('\0')) throw new Error('Skill 参数无效')
    return arg
  })
}

function commandFor(script: ResolvedSkillScript): { command: string; args: string[] } {
  if (script.runtime === 'node') return { command: process.execPath, args: [script.path] }
  if (script.runtime === 'python') return { command: 'python3', args: [script.path] }
  return { command: '/bin/sh', args: [script.path] }
}

function isSensitiveEnvironmentKey(key: string): boolean {
  return /(API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTH|CREDENTIAL)/i.test(key)
}

function controlledEnvironment(): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'zh_CN.UTF-8', LC_ALL: 'zh_CN.UTF-8' }
}

function fullTrustEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !isSensitiveEnvironmentKey(key)))
}

function appendOutput(target: { value: string; bytes: number }, chunk: Buffer, limit: number): boolean {
  const remaining = limit - target.bytes
  if (remaining <= 0) return true
  const part = chunk.subarray(0, remaining)
  target.value += part.toString('utf8')
  target.bytes += part.byteLength
  return part.byteLength < chunk.byteLength
}

export interface RunSkillOptions {
  run: ResolvedSkillScript
  args?: readonly string[]
  timeoutMs?: number
  maxOutputBytes?: number
  signal?: AbortSignal
}

export function runSkill(options: RunSkillOptions): Promise<SkillRunResult> {
  const timeoutMs = bounded(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS)
  const maxOutputBytes = bounded(options.maxOutputBytes, DEFAULT_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
  const args = safeArgs(options.args)
  const command = commandFor(options.run)
  const startedAt = Date.now()
  if (options.signal?.aborted) return Promise.reject(Object.assign(new Error('Skill 执行已取消'), { code: 'cancelled' }))
  return new Promise((resolve, reject) => {
    const environment = options.run.runtime === 'node' ? { ...controlledEnvironment(), ELECTRON_RUN_AS_NODE: '1' } : controlledEnvironment()
    const fullEnvironment = options.run.runtime === 'node' ? { ...fullTrustEnvironment(), ELECTRON_RUN_AS_NODE: '1' } : fullTrustEnvironment()
    const child = spawn(command.command, [...command.args, ...args], {
      cwd: dirname(options.run.path),
      env: options.run.installation.trustMode === 'full' ? fullEnvironment : environment,
      shell: false,
      detached: process.platform !== 'win32',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout = { value: '', bytes: 0 }
    const stderr = { value: '', bytes: 0 }
    let truncated = false
    let timedOut = false
    let cancelled = false
    let settled = false
    const killChild = (): void => {
      if (process.platform !== 'win32' && child.pid) {
        try { process.kill(-child.pid, 'SIGTERM'); return } catch { /* fall back to the direct child */ }
      }
      child.kill('SIGTERM')
    }
    const abort = (): void => { cancelled = true; killChild() }
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => { timedOut = true; killChild() }, timeoutMs)
    const finish = (result: SkillRunResult): void => { if (settled) return; settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve(result) }
    child.stdout?.on('data', (chunk: Buffer) => { if (appendOutput(stdout, chunk, maxOutputBytes)) { truncated = true; killChild() } })
    child.stderr?.on('data', (chunk: Buffer) => { if (appendOutput(stderr, chunk, maxOutputBytes)) { truncated = true; killChild() } })
    child.once('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(Object.assign(new Error(`Skill 脚本启动失败：${error.message}`), { code: cancelled ? 'cancelled' : 'skill-start-failed' })) } })
    child.once('close', (exitCode, signal) => finish({ skillId: options.run.installation.id, entrypoint: options.run.entrypoint, runtime: options.run.runtime, exitCode, ...(signal ? { signal } : {}), stdout: stdout.value, stderr: stderr.value, truncated, timedOut, durationMs: Date.now() - startedAt }))
  })
}
