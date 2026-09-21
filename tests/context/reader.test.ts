import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectContextError, readAttachmentDocument, readProjectDocument } from '../../src/main/context'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'latent-studio-context-'))
  roots.push(root)
  return root
}

describe('project context reader', () => {
  it('reads an explicitly selected attachment outside a project without exposing its absolute path', async () => {
    const root = await makeRoot()
    const filePath = join(root, 'brief.md')
    await writeFile(filePath, '# 参考设定', 'utf8')

    await expect(readAttachmentDocument({ filePath })).resolves.toEqual({
      summary: {
        relativePath: 'brief.md',
        fileName: 'brief.md',
        kind: 'markdown',
        mimeType: 'text/markdown',
        byteLength: Buffer.byteLength('# 参考设定'),
      },
      text: '# 参考设定',
    })
  })

  it('accepts an explicitly selected attachment beyond the model excerpt budget and marks the excerpt', async () => {
    const root = await makeRoot()
    const filePath = join(root, 'large-note.txt')
    const text = 'a'.repeat(5 * 1024 * 1024)
    await writeFile(filePath, text, 'utf8')

    const document = await readAttachmentDocument({ filePath })
    expect(document.summary.byteLength).toBe(text.length)
    expect(document.text).toContain('附件较大，已仅提取前 4 MiB')
    expect(Buffer.byteLength(document.text, 'utf8')).toBeLessThanOrEqual(4 * 1024 * 1024)
  })

  it('reads Markdown and returns a renderer-safe summary with a project-relative path', async () => {
    const root = await makeRoot()
    const filePath = join(root, 'documents', 'scene.md')
    await mkdir(join(root, 'documents'), { recursive: true })
    await writeFile(filePath, '\ufeff# 雨夜\n\n角色：林默\n', 'utf8')

    await expect(readProjectDocument({ projectRoot: root, filePath })).resolves.toEqual({
      summary: {
        relativePath: 'documents/scene.md',
        fileName: 'scene.md',
        kind: 'markdown',
        mimeType: 'text/markdown',
        byteLength: Buffer.byteLength('\ufeff# 雨夜\n\n角色：林默\n'),
      },
      text: '# 雨夜\n\n角色：林默\n',
    })
  })

  it('reads plain text and accepts a project-relative selection', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'notes.txt'), 'plain text', 'utf8')

    const document = await readProjectDocument({ projectRoot: root, filePath: 'notes.txt' })
    expect(document.summary.kind).toBe('plain-text')
    expect(document.summary.mimeType).toBe('text/plain')
    expect(document.text).toBe('plain text')
  })

  it('rejects an absolute path outside the project', async () => {
    const root = await makeRoot()
    await expect(readProjectDocument({ projectRoot: root, filePath: join(root, '..', 'outside.md') })).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('rejects a traversal path outside the project', async () => {
    const root = await makeRoot()
    await expect(readProjectDocument({ projectRoot: root, filePath: '../outside.md' })).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('rejects a symlink that resolves outside the project', async () => {
    const root = await makeRoot()
    const outside = await mkdtemp(join(tmpdir(), 'latent-studio-context-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.md'), 'private', 'utf8')
    await symlink(join(outside, 'secret.md'), join(root, 'linked.md'))

    await expect(readProjectDocument({ projectRoot: root, filePath: join(root, 'linked.md') })).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('rejects unsupported extensions before reading file contents', async () => {
    const root = await makeRoot()
    const filePath = join(root, 'image.png')
    await writeFile(filePath, 'not an image', 'utf8')

    await expect(readProjectDocument({ projectRoot: root, filePath })).rejects.toMatchObject({ code: 'unsupported-type' })
  })

  it('rejects directories and missing files with typed errors', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'documents.md'), { recursive: true })
    await expect(readProjectDocument({ projectRoot: root, filePath: join(root, 'documents.md') })).rejects.toMatchObject({ code: 'not-a-file' })
    await expect(readProjectDocument({ projectRoot: root, filePath: join(root, 'missing.md') })).rejects.toMatchObject({ code: 'missing-file' })
  })

  it('enforces the configured size limit and hard upper bound', async () => {
    const root = await makeRoot()
    const filePath = join(root, 'large.md')
    await writeFile(filePath, '12345', 'utf8')

    await expect(readProjectDocument({ projectRoot: root, filePath, maxBytes: 4 })).rejects.toMatchObject({ code: 'file-too-large' })
    await expect(readProjectDocument({ projectRoot: root, filePath, maxBytes: 4 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: 'invalid-limit' })
  })

  it('rejects invalid UTF-8 instead of replacing bytes silently', async () => {
    const root = await makeRoot()
    const filePath = join(root, 'invalid.txt')
    await writeFile(filePath, Buffer.from([0xc3, 0x28]))

    await expect(readProjectDocument({ projectRoot: root, filePath })).rejects.toMatchObject({ code: 'invalid-utf8' })
  })

  it('rejects a non-absolute project root and preserves the typed error', async () => {
    await expect(readProjectDocument({ projectRoot: 'project', filePath: 'notes.md' })).rejects.toBeInstanceOf(ProjectContextError)
    await expect(readProjectDocument({ projectRoot: 'project', filePath: 'notes.md' })).rejects.toMatchObject({ code: 'invalid-project-root' })
  })
})
