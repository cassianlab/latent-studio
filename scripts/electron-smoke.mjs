import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const require = createRequire(import.meta.url)
const electron = require('electron')
const entry = join(root, 'out', 'main', 'index.js')
const packagedFiles = [
  entry,
  join(root, 'out', 'preload', 'index.cjs'),
  join(root, 'out', 'renderer', 'index.html'),
  join(root, 'out', 'skills', 'builtin'),
]
const userDataPath = await mkdtemp(join(tmpdir(), 'latent-studio-smoke-'))

try {
  await Promise.all(packagedFiles.map((file) => access(file)))
  const result = await new Promise((resolve, reject) => {
    const child = spawn(electron, ['--no-sandbox', `--user-data-dir=${userDataPath}`, entry], {
      cwd: root,
      env: { ...process.env, LATENT_STUDIO_SMOKE: '1', LATENT_STUDIO_SMOKE_WINDOW: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const collect = (chunk) => { output += chunk.toString() }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error(`Electron smoke test timed out\n${output}`))
    }, 30000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolve({ code, signal, output })
    })
  })

  if (result.code !== 0) {
    throw new Error(`Electron smoke test exited with code ${result.code ?? 'null'} (${result.signal ?? 'no signal'})\n${result.output}`)
  }
  await access(join(userDataPath, 'global.db'))
  console.log('Electron smoke test passed: BrowserWindow, preload, runtime, and clean shutdown verified')
} finally {
  await rm(userDataPath, { recursive: true, force: true })
}
