import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readAgentReferenceImages } from '../../src/main/agent/reference-image-reader'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Agent reference image reader', () => {
  it('reads a valid project image into a renderer-free multimodal part', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-agent-reference-'))
    roots.push(root)
    await mkdir(join(root, 'assets'))
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await writeFile(join(root, 'assets', 'reference.png'), bytes)

    await expect(readAgentReferenceImages([{ type: 'file', path: 'assets/reference.png', mimeType: 'image/png' }], () => root)).resolves.toEqual([
      { type: 'image', data: bytes.toString('base64'), mimeType: 'image/png' },
    ])
  })

  it('rejects renamed files and paths outside the active project', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-agent-reference-'))
    const outside = await mkdtemp(join(tmpdir(), 'latent-agent-reference-outside-'))
    roots.push(root, outside)
    await writeFile(join(root, 'fake.png'), 'not an image')
    await writeFile(join(outside, 'secret.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

    await expect(readAgentReferenceImages([{ type: 'file', path: 'fake.png' }], () => root)).rejects.toThrow('有效图片')
    await expect(readAgentReferenceImages([{ type: 'file', path: join(outside, 'secret.png') }], () => root)).rejects.toThrow('当前项目')
  })
})
