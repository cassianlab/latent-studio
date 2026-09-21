import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const source = join(root, '..', 'skills', 'builtin')
const destination = join(root, '..', 'out', 'skills', 'builtin')

await rm(destination, { recursive: true, force: true })
await mkdir(dirname(destination), { recursive: true })
await cp(source, destination, { recursive: true, force: true })
console.log(`copied builtin skills to ${destination}`)
