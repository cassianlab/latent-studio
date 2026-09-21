import { resolve } from 'node:path'
import type { ProjectManifest } from '../../shared/contracts/projects'
import { createNodeSqliteDatabase, initializeProjectDatabase, type DatabaseFactory, type ProjectDatabase } from './database'
import { createManifest, ensureProjectDirectories, readManifest, validateProjectRoot, writeManifestAtomic, ProjectStorageError, type FileSystemPort, fileSystem } from './manifest'

export interface ProjectHandle {
  rootPath: string
  manifest: ProjectManifest
  database: ProjectDatabase
}

export interface CreateProjectOptions {
  selectedDirectory: string
  projectRoot: string
  name: string
  description?: string
  databaseFactory?: DatabaseFactory
  fileSystem?: FileSystemPort
}

export interface OpenProjectOptions {
  selectedDirectory: string
  projectRoot: string
  databaseFactory?: DatabaseFactory
  fileSystem?: FileSystemPort
}

export async function createProject(options: CreateProjectOptions): Promise<ProjectHandle> {
  const rootPath = validateProjectRoot(options.selectedDirectory, options.projectRoot)
  const fs = options.fileSystem ?? fileSystem
  const manifestPath = resolve(rootPath, 'project.json')
  try {
    await fs.readFile(manifestPath, 'utf8')
    throw new Error('manifest exists')
  } catch (error) {
    if (error instanceof Error && error.message === 'manifest exists') {
      throw new ProjectStorageError('already-exists', `Project already exists: ${rootPath}`)
    }
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await ensureProjectDirectories(rootPath, fs)
  const manifest = createManifest(options.name, options.description)
  await writeManifestAtomic(rootPath, manifest, fs)
  const database = await (options.databaseFactory ?? createNodeSqliteDatabase)(resolve(rootPath, '.latent-studio/project.db'))
  initializeProjectDatabase(database)
  return { rootPath, manifest, database }
}

export async function openProject(options: OpenProjectOptions): Promise<ProjectHandle> {
  const rootPath = validateProjectRoot(options.selectedDirectory, options.projectRoot)
  const fs = options.fileSystem ?? fileSystem
  const manifest = await readManifest(rootPath, fs)
  const database = await (options.databaseFactory ?? createNodeSqliteDatabase)(resolve(rootPath, '.latent-studio/project.db'))
  initializeProjectDatabase(database)
  return { rootPath, manifest, database }
}
