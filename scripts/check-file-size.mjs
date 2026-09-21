import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const extensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.css'])
const ignored = new Set(['node_modules', 'dist', 'out', '.git', '.playwright-cli', 'output'])
const violations = []

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await walk(path)
      continue
    }
    if (!extensions.has(entry.name.slice(entry.name.lastIndexOf('.')))) continue
    const lines = (await readFile(path, 'utf8')).split(/\r?\n/).length
    if (lines > 1000) violations.push(`${relative(root, path)}: ${lines} lines`)
  }
}

await walk(root)
if (violations.length) {
  console.error(violations.join('\n'))
  process.exitCode = 1
} else {
  console.log('file-size check passed')
}
