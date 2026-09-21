import { promises as fs } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ProjectAssetService } from '../../src/main/library'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeProject(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'latent-assets-project-'))
  roots.push(root)
  await fs.mkdir(join(root, 'assets'), { recursive: true })
  await fs.mkdir(join(root, '.latent-studio'), { recursive: true })
  return root
}

describe('project asset service', () => {
  it('saves a validated sketch PNG as a reusable project reference', async () => {
    const root = await makeProject()
    const service = new ProjectAssetService()
    const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

    const saved = await service.saveReferenceImage({ projectRoot: root, name: '构图草图', dataUrl })

    expect(saved).toMatchObject({ category: 'reference', mimeType: 'image/png', previewable: true, origin: 'imported' })
    expect(saved.name).toMatch(/^构图草图.*\.png$/)
    expect(await service.preview({ projectRoot: root, id: saved.id })).toBe(dataUrl)
  })

  it('rejects malformed sketch data instead of writing it to the project', async () => {
    const root = await makeProject()
    const service = new ProjectAssetService()
    await expect(service.saveReferenceImage({ projectRoot: root, name: '坏草图', dataUrl: 'data:image/png;base64,bm90LXBuZw==' })).rejects.toMatchObject({ code: 'invalid-input' })
    await expect(service.list({ projectRoot: root })).resolves.toEqual([])
  })

  it('imports files atomically, records metadata and serves previews', async () => {
    const root = await makeProject()
    const source = await mkdtemp(join(tmpdir(), 'latent-assets-source-'))
    roots.push(source)
    const sourcePath = join(source, 'reference.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
    await writeFile(sourcePath, bytes)
    const service = new ProjectAssetService()

    const [asset] = await service.import({ projectRoot: root, sourcePaths: [sourcePath] })
    expect(asset).toMatchObject({ name: 'reference.png', relativePath: sourcePath, sourceName: 'reference.png', category: 'reference', mimeType: 'image/png', byteLength: bytes.length, previewable: true })
    expect(await service.list({ projectRoot: root })).toEqual([asset])
    expect(await service.preview({ projectRoot: root, id: asset.id })).toBe(`data:image/png;base64,${bytes.toString('base64')}`)
    expect(JSON.parse(await fs.readFile(join(root, '.latent-studio/assets.json'), 'utf8')).items).toHaveLength(1)
  })

  it('migrates legacy assets, filters by category and persists category updates', async () => {
    const root = await makeProject()
    const now = new Date().toISOString()
    await writeFile(join(root, '.latent-studio/assets.json'), JSON.stringify({ format: 1, items: [
      { id: 'legacy-image', name: 'actor.png', relativePath: 'assets/actor.png', sourceName: 'actor.png', mimeType: 'image/png', byteLength: 1, importedAt: now, modifiedAt: now, previewable: true },
      { id: 'legacy-doc', name: 'brief.md', relativePath: 'assets/brief.md', sourceName: 'brief.md', mimeType: 'text/markdown', byteLength: 1, importedAt: now, modifiedAt: now, previewable: false },
    ] }))
    const service = new ProjectAssetService()
    await expect(service.list({ projectRoot: root, category: 'reference' })).resolves.toMatchObject([{ id: 'legacy-image', category: 'reference' }])
    const updated = await service.update({ projectRoot: root, id: 'legacy-image', category: 'character' })
    expect(updated.category).toBe('character')
    await expect(service.list({ projectRoot: root, category: 'character' })).resolves.toMatchObject([{ id: 'legacy-image', category: 'character' }])
    await expect(service.list({ projectRoot: root, category: 'reference' })).resolves.toEqual([])
    await expect(service.update({ projectRoot: root, id: 'legacy-image', category: 'invalid' as never })).rejects.toMatchObject({ code: 'invalid-input' })
  })

  it('avoids overwriting duplicate names and removes only recorded assets', async () => {
    const root = await makeProject()
    const sourceA = join(root, 'one.png')
    await writeFile(sourceA, Buffer.from([1]))
    const service = new ProjectAssetService()
    const [first] = await service.import({ projectRoot: root, sourcePaths: [sourceA] })
    const [second] = await service.import({ projectRoot: root, sourcePaths: [sourceA] })
    expect(second.name).toBe('one (1).png')
    await service.remove({ projectRoot: root, id: first.id })
    expect(await fs.readFile(join(root, 'one.png'))).toEqual(Buffer.from([1]))
    await expect(service.list({ projectRoot: root })).resolves.toEqual([second])
  })

  it('rejects missing files, directories and asset symlink escapes', async () => {
    const root = await makeProject()
    const outside = await mkdtemp(join(tmpdir(), 'latent-assets-outside-'))
    roots.push(outside)
    const service = new ProjectAssetService()
    await expect(service.import({ projectRoot: root, sourcePaths: [join(root, 'missing.png')] })).rejects.toMatchObject({ code: 'missing-path' })
    await expect(service.import({ projectRoot: root, sourcePaths: [join(root, 'assets')] })).rejects.toMatchObject({ code: 'not-a-file' })
    await fs.symlink(outside, join(root, 'assets', 'linked'))
    await writeFile(join(outside, 'secret.png'), Buffer.from([3]))
    await writeFile(join(root, '.latent-studio/assets.json'), JSON.stringify({ format: 1, items: [{ id: 'escape', name: 'secret.png', relativePath: 'assets/linked/secret.png', sourceName: 'secret.png', byteLength: 1, importedAt: new Date().toISOString(), modifiedAt: new Date().toISOString(), previewable: true }] }))
    await expect(service.preview({ projectRoot: root, id: 'escape' })).rejects.toMatchObject({ code: 'outside-project' })
  })

  it('imports assets with an explicit category such as output', async () => {
    const root = await makeProject()
    const source = join(root, 'generated.png')
    await writeFile(source, Buffer.from([1, 2, 3]))
    const service = new ProjectAssetService()
    const [asset] = await service.import({ projectRoot: root, sourcePaths: [source], category: 'output' })
    expect(asset.category).toBe('output')
    expect(await service.list({ projectRoot: root, category: 'output' })).toMatchObject([{ id: asset.id, category: 'output' }])
  })

  it('records generated assets and allows deleting them from outputs directory', async () => {
    const root = await makeProject()
    await fs.mkdir(join(root, 'outputs'), { recursive: true })
    const outputPath = join(root, 'outputs', 'task-100-output.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 4, 5, 6])
    await writeFile(outputPath, bytes)

    const service = new ProjectAssetService()
    const asset = await service.recordGenerated({
      projectRoot: root,
      localPath: outputPath,
      taskId: 'task-100',
      title: 'AI 生成图 #100',
    })

    expect(asset).toMatchObject({
      id: 'task-100',
      name: 'AI 生成图 #100',
      relativePath: 'outputs/task-100-output.png',
      category: 'output',
      origin: 'generated',
      previewable: true,
    })

    const list = await service.list({ projectRoot: root, category: 'output' })
    expect(list).toHaveLength(1)
    expect(list[0].origin).toBe('generated')

    // Calling again returns existing without duplication
    const secondCall = await service.recordGenerated({
      projectRoot: root,
      localPath: outputPath,
      taskId: 'task-100',
      title: 'AI 生成图 #100',
    })
    expect(secondCall.id).toBe(asset.id)
    expect(await service.list({ projectRoot: root, category: 'output' })).toHaveLength(1)

    // Remove should delete physical file in outputs/
    await service.remove({ projectRoot: root, id: asset.id })
    expect(await service.list({ projectRoot: root })).toEqual([])
    await expect(fs.access(outputPath)).rejects.toThrow()
  })

  it('serves previews for large generated images within the asset limit', async () => {
    const root = await makeProject()
    await fs.mkdir(join(root, 'outputs'), { recursive: true })
    const outputPath = join(root, 'outputs', 'large-output.png')
    const bytes = Buffer.alloc(11 * 1024 * 1024, 7)
    bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    await writeFile(outputPath, bytes)

    const service = new ProjectAssetService()
    const asset = await service.recordGenerated({ projectRoot: root, localPath: outputPath, taskId: 'task-large', mimeType: 'image/png' })

    await expect(service.preview({ projectRoot: root, id: asset.id })).resolves.toBe(`data:image/png;base64,${bytes.toString('base64')}`)
  })

  it('keeps multiple generated images from the same task as separate assets', async () => {
    const root = await makeProject()
    await fs.mkdir(join(root, 'outputs'), { recursive: true })
    const firstPath = join(root, 'outputs', 'batch-1.png')
    const secondPath = join(root, 'outputs', 'batch-2.png')
    await writeFile(firstPath, Buffer.from([1, 2, 3]))
    await writeFile(secondPath, Buffer.from([4, 5, 6]))

    const service = new ProjectAssetService()
    const first = await service.recordGenerated({ projectRoot: root, localPath: firstPath, taskId: 'task-batch' })
    const second = await service.recordGenerated({ projectRoot: root, localPath: secondPath, taskId: 'task-batch' })

    expect(second.id).not.toBe(first.id)
    await expect(service.list({ projectRoot: root, category: 'output' })).resolves.toHaveLength(2)
    await expect(service.preview({ projectRoot: root, id: second.id })).resolves.toBe(`data:image/png;base64,${Buffer.from([4, 5, 6]).toString('base64')}`)
  })

  it('does not copy external assets into project and deletion does not delete original file', async () => {
    const root = await makeProject()
    const externalDir = await mkdtemp(join(tmpdir(), 'latent-assets-ext-'))
    roots.push(externalDir)
    const externalPath = join(externalDir, 'photo.png')
    await writeFile(externalPath, Buffer.from([1, 2, 3, 4]))

    const service = new ProjectAssetService()
    const [asset] = await service.import({ projectRoot: root, sourcePaths: [externalPath] })

    expect(asset.relativePath).toBe(externalPath)
    expect(asset.origin).toBe('imported')

    // Verify it was NOT copied into project assets/
    await expect(fs.access(join(root, 'assets', 'photo.png'))).rejects.toThrow()

    // Delete asset from library
    await service.remove({ projectRoot: root, id: asset.id })

    // Assets index is empty
    expect(await service.list({ projectRoot: root })).toEqual([])

    // Original external file remains safe and untouched!
    await expect(fs.access(externalPath)).resolves.toBeUndefined()
    expect(await fs.readFile(externalPath)).toEqual(Buffer.from([1, 2, 3, 4]))
  })
})
