import { randomUUID } from 'node:crypto'
import { promises as nodeFs } from 'node:fs'
import { basename, isAbsolute, parse, relative, resolve, sep } from 'node:path'
import type { ProjectManifest } from '../../shared/contracts/projects'
import { PROJECT_FORMAT_VERSION } from '../../shared/contracts/projects'

export interface FileSystemPort {
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  readFile(path: string, encoding: 'utf8'): Promise<string>
  writeFile(path: string, data: string, encoding: 'utf8'): Promise<void>
  rename(oldPath: string, newPath: string): Promise<void>
  unlink(path: string): Promise<void>
}

export const fileSystem: FileSystemPort = nodeFs

export class ProjectStorageError extends Error {
  constructor(public readonly code: 'invalid-path' | 'missing-manifest' | 'corrupt-manifest' | 'already-exists', message: string) {
    super(message)
    this.name = 'ProjectStorageError'
  }
}

export function validateProjectRoot(selectedDirectory: string, projectRoot: string): string {
  const selected = resolve(selectedDirectory)
  const project = resolve(projectRoot)
  if (!isAbsolute(selectedDirectory) || !isAbsolute(projectRoot) || parse(project).root === project) {
    throw new ProjectStorageError('invalid-path', 'Project root must be an absolute, non-root path')
  }
  const childPath = relative(selected, project)
  if (childPath === '..' || childPath.startsWith(`..${sep}`) || isAbsolute(childPath)) {
    throw new ProjectStorageError('invalid-path', 'Project root must be inside the selected directory')
  }
  return project
}

export function createManifest(name: string, description?: string): ProjectManifest {
  const now = new Date().toISOString()
  return {
    id: randomUUID(),
    name: name.trim() || 'Untitled Project',
    ...(description?.trim() ? { description: description.trim() } : {}),
    formatVersion: PROJECT_FORMAT_VERSION,
    createdAt: now,
    updatedAt: now,
  }
}

function parseManifest(text: string): ProjectManifest {
  try {
    const value = JSON.parse(text) as Partial<ProjectManifest>
    if (
      typeof value.id !== 'string' ||
      typeof value.name !== 'string' ||
      value.formatVersion !== PROJECT_FORMAT_VERSION ||
      typeof value.createdAt !== 'string' ||
      typeof value.updatedAt !== 'string'
    ) throw new Error('missing fields')
    return value as ProjectManifest
  } catch {
    throw new ProjectStorageError('corrupt-manifest', 'project.json is invalid or corrupted')
  }
}

export async function readManifest(projectRoot: string, fs: FileSystemPort = fileSystem): Promise<ProjectManifest> {
  const manifestPath = resolve(projectRoot, 'project.json')
  try {
    return parseManifest(await fs.readFile(manifestPath, 'utf8'))
  } catch (error) {
    if (error instanceof ProjectStorageError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProjectStorageError('missing-manifest', `Missing project manifest: ${manifestPath}`)
    }
    throw error
  }
}

export async function writeManifestAtomic(projectRoot: string, manifest: ProjectManifest, fs: FileSystemPort = fileSystem): Promise<void> {
  const manifestPath = resolve(projectRoot, 'project.json')
  const temporaryPath = `${manifestPath}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, manifestPath)
  } catch (error) {
    try {
      await fs.unlink(temporaryPath)
    } catch {
      // Cleanup is best effort; preserve the original write error.
    }
    throw error
  }
}

export async function ensureProjectDirectories(projectRoot: string, fs: FileSystemPort = fileSystem): Promise<void> {
  await fs.mkdir(projectRoot, { recursive: true })
  await Promise.all(['documents', 'assets', 'outputs', '.latent-studio'].map((directory) => fs.mkdir(resolve(projectRoot, directory), { recursive: true })))
}

export function projectNameFromPath(projectRoot: string): string { return basename(resolve(projectRoot)) }
