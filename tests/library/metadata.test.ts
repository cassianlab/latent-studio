import { promises as fs } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectMetadataService } from '../../src/main/library'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'latent-metadata-'))
  roots.push(root)
  await fs.mkdir(join(root, 'documents', 'scenes'), { recursive: true })
  await fs.mkdir(join(root, 'assets'), { recursive: true })
  await fs.mkdir(join(root, '.latent-studio'), { recursive: true })
  await fs.writeFile(join(root, 'documents', 'brief.md'), '# Brief', 'utf8')
  await fs.writeFile(join(root, 'documents', 'scenes', 'one.txt'), 'scene 1', 'utf8')
  await fs.writeFile(join(root, 'assets', 'ref.png'), Buffer.from([1, 2, 3]))
  return root
}

describe('project metadata service', () => {
  it('lists project-relative metadata and classifies documents/assets', async () => {
    const root = await makeProject()
    const service = new ProjectMetadataService()
    await expect(service.list({ projectRoot: root, directory: 'documents', recursive: true })).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ relativePath: 'documents/brief.md', kind: 'document', extension: '.md', mimeType: 'text/markdown', byteLength: 7, isDirectory: false }),
      expect.objectContaining({ relativePath: 'documents/scenes', kind: 'document', isDirectory: true }),
      expect.objectContaining({ relativePath: 'documents/scenes/one.txt', kind: 'document', mimeType: 'text/plain' }),
    ]))
    await expect(service.inspect({ projectRoot: root, filePath: join(root, 'assets/ref.png') })).resolves.toMatchObject({ relativePath: 'assets/ref.png', kind: 'asset', mimeType: 'image/png', byteLength: 3 })
  })

  it('does not enumerate hidden metadata unless explicitly requested', async () => {
    const root = await makeProject()
    const service = new ProjectMetadataService()
    const hidden = await service.list({ projectRoot: root, recursive: false })
    expect(hidden.some((item) => item.relativePath.startsWith('.latent-studio'))).toBe(false)
    const included = await service.list({ projectRoot: root, recursive: false, includeHidden: true })
    expect(included.some((item) => item.relativePath === '.latent-studio')).toBe(true)
  })

  it('rejects traversal and symlink escapes', async () => {
    const root = await makeProject()
    const outside = await mkdtemp(join(tmpdir(), 'latent-outside-'))
    roots.push(outside)
    await fs.writeFile(join(outside, 'secret.txt'), 'secret', 'utf8')
    await fs.symlink(outside, join(root, 'assets', 'linked'))
    const service = new ProjectMetadataService()
    await expect(service.inspect({ projectRoot: root, filePath: '../secret.txt' })).rejects.toMatchObject({ code: 'outside-project' })
    await expect(service.inspect({ projectRoot: root, filePath: 'assets/linked/secret.txt' })).rejects.toMatchObject({ code: 'outside-project' })
    await expect(service.list({ projectRoot: root, directory: 'assets/linked' })).rejects.toMatchObject({ code: 'outside-project' })
  })

  it('bounds directory enumeration', async () => {
    const root = await makeProject()
    const service = new ProjectMetadataService()
    await expect(service.list({ projectRoot: root, maxEntries: 0 })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.list({ projectRoot: root, maxEntries: 1 })).resolves.toHaveLength(1)
  })

  it('saves project documents with safe names and avoids overwriting', async () => {
    const root = await makeProject()
    const service = new ProjectMetadataService()
    const first = await service.saveDocument({ projectRoot: root, title: '场景/一', content: '# 第一版' })
    const second = await service.saveDocument({ projectRoot: root, title: '场景/一', content: '# 第二版' })
    const textDoc = await service.saveDocument({ projectRoot: root, title: '提示词记录', extension: '.txt', content: '一段纯文本' })
    const jsonDoc = await service.saveDocument({ projectRoot: root, title: '镜头参数', extension: 'json', content: '{"lens": "35mm"}' })
    expect(first.relativePath).toMatch(/^documents\/场景-一\.md$/)
    expect(second.relativePath).toMatch(/^documents\/场景-一-\d+-[a-f0-9]+\.md$/)
    expect(textDoc.relativePath).toMatch(/^documents\/提示词记录\.txt$/)
    expect(jsonDoc.relativePath).toMatch(/^documents\/镜头参数\.json$/)
    await expect(fs.readFile(join(root, first.relativePath), 'utf8')).resolves.toBe('# 第一版\n')
    await expect(fs.readFile(join(root, second.relativePath), 'utf8')).resolves.toBe('# 第二版\n')
    await expect(fs.readFile(join(root, textDoc.relativePath), 'utf8')).resolves.toBe('一段纯文本\n')
    await expect(fs.readFile(join(root, jsonDoc.relativePath), 'utf8')).resolves.toBe('{"lens": "35mm"}\n')
  })

  it('updates an existing text document only inside documents', async () => {
    const root = await makeProject()
    const service = new ProjectMetadataService()
    await expect(service.updateDocument({ projectRoot: root, filePath: 'documents/brief.md', title: '新简介', content: '# Updated' })).resolves.toMatchObject({ relativePath: 'documents/新简介.md', name: '新简介.md' })
    await expect(fs.readFile(join(root, 'documents/新简介.md'), 'utf8')).resolves.toBe('# Updated\n')
    await expect(fs.access(join(root, 'documents/brief.md'))).rejects.toThrow()
    await expect(service.updateDocument({ projectRoot: root, filePath: 'assets/ref.png', title: 'Ref', content: 'x' })).rejects.toMatchObject({ code: 'invalid-path' })
  })

  it('does not overwrite another document when a rename target already exists', async () => {
    const root = await makeProject()
    await fs.writeFile(join(root, 'documents', '已有.md'), '# Existing', 'utf8')
    const service = new ProjectMetadataService()

    await expect(service.updateDocument({ projectRoot: root, filePath: 'documents/brief.md', title: '已有', content: '# Replacement' })).rejects.toMatchObject({ code: 'invalid-input', message: '同名文档已存在' })
    await expect(fs.readFile(join(root, 'documents', '已有.md'), 'utf8')).resolves.toBe('# Existing')
    await expect(fs.readFile(join(root, 'documents', 'brief.md'), 'utf8')).resolves.toBe('# Brief')
  })

  it('deletes an existing document only inside documents directory', async () => {
    const root = await makeProject()
    const service = new ProjectMetadataService()
    await expect(fs.access(join(root, 'documents/brief.md'))).resolves.toBeUndefined()
    await service.deleteDocument({ projectRoot: root, filePath: 'documents/brief.md' })
    await expect(fs.access(join(root, 'documents/brief.md'))).rejects.toThrow()

    // Cannot delete files outside documents/
    await expect(service.deleteDocument({ projectRoot: root, filePath: 'assets/ref.png' })).rejects.toMatchObject({ code: 'invalid-path' })
    // Cannot delete non-existent files
    await expect(service.deleteDocument({ projectRoot: root, filePath: 'documents/non-existent.md' })).rejects.toMatchObject({ code: 'missing-path' })
  })
})
