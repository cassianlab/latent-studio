import { dirname } from 'node:path'
import type { RecentProject, RecentProjectsStore } from '../../shared/contracts/projects'
import type { GlobalDatabase } from '../config'
import { type FileSystemPort, fileSystem } from './manifest'

export const MAX_RECENT_PROJECTS = 20

function isRecentProject(value: unknown): value is RecentProject {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RecentProject>
  return typeof candidate.id === 'string' && candidate.id.length > 0
    && typeof candidate.name === 'string' && candidate.name.length > 0
    && typeof candidate.path === 'string' && candidate.path.length > 0
    && typeof candidate.openedAt === 'string' && candidate.openedAt.length > 0
}

function normalizeRecentProjects(value: unknown): RecentProject[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecentProject).slice(0, MAX_RECENT_PROJECTS)
}

export class InMemoryRecentProjectsStore implements RecentProjectsStore {
  private projects: RecentProject[] = []

  async list(): Promise<RecentProject[]> { return this.projects.map((project) => ({ ...project })) }

  async add(project: RecentProject): Promise<void> {
    this.projects = [project, ...this.projects.filter((item) => item.path !== project.path)].slice(0, MAX_RECENT_PROJECTS)
  }

  async remove(path: string): Promise<void> { this.projects = this.projects.filter((project) => project.path !== path) }
}

interface RecentProjectRow { project_id: string; name: string; path: string; opened_at: string }

/** Authoritative recent-project store for the Electron app. */
export class SqliteRecentProjectsStore implements RecentProjectsStore {
  constructor(private readonly database: GlobalDatabase) {}

  async list(): Promise<RecentProject[]> {
    return this.database.all<RecentProjectRow>('SELECT project_id, name, path, opened_at FROM recent_projects ORDER BY opened_at DESC LIMIT ?', MAX_RECENT_PROJECTS)
      .map((row) => ({ id: row.project_id, name: row.name, path: row.path, openedAt: row.opened_at }))
  }

  async add(project: RecentProject): Promise<void> {
    this.database.run('DELETE FROM recent_projects WHERE path = ? AND project_id <> ?', project.path, project.id)
    this.database.run(`
      INSERT INTO recent_projects (project_id, name, path, opened_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET name = excluded.name, path = excluded.path, opened_at = excluded.opened_at
    `, project.id, project.name, project.path, project.openedAt)
    this.database.run('DELETE FROM recent_projects WHERE project_id NOT IN (SELECT project_id FROM recent_projects ORDER BY opened_at DESC LIMIT ?)', MAX_RECENT_PROJECTS)
  }

  async remove(path: string): Promise<void> { this.database.run('DELETE FROM recent_projects WHERE path = ?', path) }
}

export class FileRecentProjectsStore implements RecentProjectsStore {
  constructor(private readonly path: string, private readonly fs: FileSystemPort = fileSystem) {}

  async list(): Promise<RecentProject[]> {
    try {
      const value = JSON.parse(await this.fs.readFile(this.path, 'utf8'))
      return normalizeRecentProjects(value)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async add(project: RecentProject): Promise<void> {
    const projects = [project, ...(await this.list()).filter((item) => item.path !== project.path)].slice(0, MAX_RECENT_PROJECTS)
    await this.write(projects)
  }

  async remove(path: string): Promise<void> { await this.write((await this.list()).filter((project) => project.path !== path)) }

  private async write(projects: RecentProject[]): Promise<void> {
    await this.fs.mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${process.pid}.${Date.now()}.tmp`
    try {
      await this.fs.writeFile(temporaryPath, `${JSON.stringify(projects, null, 2)}\n`, 'utf8')
      await this.fs.rename(temporaryPath, this.path)
    } finally {
      try { await this.fs.unlink(temporaryPath) } catch { /* already renamed */ }
    }
  }
}
