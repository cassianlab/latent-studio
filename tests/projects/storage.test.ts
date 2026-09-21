import { promises as fs } from 'node:fs'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createProject, openProject } from '../../src/main/projects/storage'
import { ProjectStorageError, readManifest, validateProjectRoot, type FileSystemPort } from '../../src/main/projects/manifest'
import type { ProjectDatabase } from '../../src/main/projects/database'
import { FileRecentProjectsStore, MAX_RECENT_PROJECTS } from '../../src/main/projects/recent'

const roots: string[] = []
const databaseFactory = async (): Promise<ProjectDatabase> => ({ exec: () => undefined })

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'latent-studio-'))
  roots.push(root)
  return root
}

describe('project storage', () => {
  it('creates the project structure and reopens its manifest', async () => {
    const selected = await makeRoot()
    const projectRoot = join(selected, 'film')
    const created = await createProject({ selectedDirectory: selected, projectRoot, name: 'Film', databaseFactory })

    expect(created.manifest.name).toBe('Film')
    await expect(readFile(join(projectRoot, 'project.json'), 'utf8')).resolves.toContain('"formatVersion": 1')
    await expect(readdir(join(projectRoot, 'documents'))).resolves.toEqual([])
    const reopened = await openProject({ selectedDirectory: selected, projectRoot, databaseFactory })
    expect(reopened.manifest.id).toBe(created.manifest.id)
  })

  it.each([
    ['outside selected directory', (selected: string) => join(selected, '..', 'outside')],
    ['traversal path', (selected: string) => join(selected, 'nested', '..', '..', 'outside')],
    ['filesystem root', () => '/'],
  ])('rejects %s', async (_label, projectPath) => {
    const selected = await makeRoot()
    expect(() => validateProjectRoot(selected, projectPath(selected))).toThrow(ProjectStorageError)
  })

  it('allows the user-selected folder to be the project root', async () => {
    const selected = await makeRoot()
    expect(validateProjectRoot(selected, selected)).toBe(selected)
  })

  it('detects missing and corrupted manifests', async () => {
    const selected = await makeRoot()
    const projectRoot = join(selected, 'broken')
    await fs.mkdir(projectRoot, { recursive: true })
    await expect(readManifest(projectRoot)).rejects.toMatchObject({ code: 'missing-manifest' })
    await fs.writeFile(join(projectRoot, 'project.json'), '{bad', 'utf8')
    await expect(readManifest(projectRoot)).rejects.toMatchObject({ code: 'corrupt-manifest' })
  })

  it('cleans a temporary manifest when rename fails', async () => {
    const selected = await makeRoot()
    const projectRoot = join(selected, 'atomic')
    let temporaryPath = ''
    const failingFs: FileSystemPort = {
      mkdir: fs.mkdir,
      readFile: fs.readFile,
      writeFile: async (path, data, encoding) => {
        temporaryPath = path
        await fs.writeFile(path, data, encoding)
      },
      rename: async () => { throw new Error('rename failed') },
      unlink: fs.unlink,
    }
    await expect(createProject({ selectedDirectory: selected, projectRoot, name: 'Atomic', databaseFactory, fileSystem: failingFs })).rejects.toThrow('rename failed')
    expect(temporaryPath).toBeTruthy()
    await expect(fs.access(temporaryPath)).rejects.toThrow()
    await expect(fs.access(join(projectRoot, 'project.json'))).rejects.toThrow()
  })

  it('filters malformed recent entries and keeps the newest entries bounded', async () => {
    const selected = await makeRoot()
    const recentPath = join(selected, 'recent.json')
    const entries = Array.from({ length: MAX_RECENT_PROJECTS + 3 }, (_, index) => ({
      id: `p-${index}`,
      name: `Project ${index}`,
      path: join(selected, `project-${index}`),
      openedAt: new Date(index).toISOString(),
    }))
    await fs.writeFile(recentPath, JSON.stringify([...entries, { id: 'bad' }, null]), 'utf8')
    const store = new FileRecentProjectsStore(recentPath)
    await expect(store.list()).resolves.toHaveLength(MAX_RECENT_PROJECTS)
    await expect(store.list()).resolves.toEqual(entries.slice(0, MAX_RECENT_PROJECTS))
  })
})
