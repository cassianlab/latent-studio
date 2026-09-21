export const PROJECT_FORMAT_VERSION = 1

export interface ProjectManifest {
  id: string
  name: string
  description?: string
  formatVersion: number
  createdAt: string
  updatedAt: string
}

export interface RecentProject {
  id: string
  path: string
  name: string
  openedAt: string
}

/** Renderer-safe project data returned by the project IPC boundary. */
export interface ProjectSummary {
  id: string
  name: string
  description?: string
  path: string
  displayPath: string
  openedAt: string
  /** Recent-project entries set this after checking the path on disk. */
  available?: boolean
}

export interface CreateProjectInput {
  name: string
  description?: string
}

export interface RelocateProjectInput {
  id: string
}

export interface ProjectsApi {
  listRecent(): Promise<ProjectSummary[]>
  create(input: CreateProjectInput): Promise<ProjectSummary | null>
  open(input?: { projectRoot: string }): Promise<ProjectSummary | null>
  relocate(input: RelocateProjectInput): Promise<ProjectSummary | null>
}

export interface RecentProjectsStore {
  list(): Promise<RecentProject[]>
  add(project: RecentProject): Promise<void>
  remove(path: string): Promise<void>
}
