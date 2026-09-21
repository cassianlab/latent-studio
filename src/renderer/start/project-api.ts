import type { ProjectSummary } from '../../shared/contracts/projects'

export type ProjectErrorCode =
  | 'canceled'
  | 'project-moved'
  | 'missing-manifest'
  | 'corrupt-manifest'
  | 'permission-denied'
  | 'already-exists'
  | 'unknown'

export interface ProjectOperationError {
  code: ProjectErrorCode
  message: string
  project?: ProjectSummary
}

export interface ProjectApi {
  listRecent(): Promise<ProjectSummary[]>
  create(input: { name: string; description?: string }): Promise<ProjectSummary | null>
  open(input?: { projectRoot: string }): Promise<ProjectSummary | null>
  relocate(input: { id: string }): Promise<ProjectSummary | null>
}

type HostProjectApi = Partial<ProjectApi>

const mockProjects: ProjectSummary[] = [
  {
    id: 'mock-ember',
    name: '余烬计划',
    description: '雨夜重逢视觉探索',
    path: '/mock/latent-studio/余烬计划',
    displayPath: '~/Projects/余烬计划',
    openedAt: new Date().toISOString(),
  },
  {
    id: 'mock-north-shore',
    name: '北岸手记',
    description: '角色与场景资料整理',
    path: '/mock/latent-studio/北岸手记',
    displayPath: '~/Projects/北岸手记',
    openedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
]

function cloneProjects(projects: ProjectSummary[]): ProjectSummary[] {
  return projects.map(project => ({ ...project }))
}

function makeMockApi(): ProjectApi {
  let projects = cloneProjects(mockProjects)
  return {
    async listRecent() { return cloneProjects(projects) },
    async create(input) {
      const name = input.name.trim() || '未命名项目'
      const project: ProjectSummary = {
        id: `mock-${Date.now()}`,
        name,
        ...(input.description?.trim() ? { description: input.description.trim() } : {}),
        path: `/mock/latent-studio/${name}`,
        displayPath: `~/Projects/${name}`,
        openedAt: new Date().toISOString(),
      }
      projects = [project, ...projects.filter(item => item.id !== project.id)]
      return { ...project }
    },
    async open(input) {
      const project = input?.projectRoot ? projects.find(item => item.path === input.projectRoot) : projects[0]
      return project ? { ...project, openedAt: new Date().toISOString() } : null
    },
    async relocate({ id }) {
      const project = projects.find(item => item.id === id)
      return project ? { ...project, openedAt: new Date().toISOString() } : null
    },
  }
}

function readHostProjectApi(): ProjectApi | null {
  if (typeof window === 'undefined') return null
  const host = (window as Window & { latentStudio?: { projects?: HostProjectApi } }).latentStudio?.projects
  if (!host || typeof host.listRecent !== 'function' || typeof host.create !== 'function' || typeof host.open !== 'function' || typeof host.relocate !== 'function') return null
  return host as ProjectApi
}

let mockApi: ProjectApi | undefined

/** Selects the real preload API when available, while keeping browser previews usable. */
export function getProjectApi(): ProjectApi {
  return readHostProjectApi() ?? (mockApi ??= makeMockApi())
}

export function projectError(error: unknown, project?: ProjectSummary): ProjectOperationError {
  if (error && typeof error === 'object' && 'code' in error) {
    const candidate = error as { code?: unknown; message?: unknown }
    const knownCodes: ProjectErrorCode[] = ['canceled', 'project-moved', 'missing-manifest', 'corrupt-manifest', 'permission-denied', 'already-exists']
    const code = typeof candidate.code === 'string' && knownCodes.includes(candidate.code as ProjectErrorCode) ? candidate.code as ProjectErrorCode : 'unknown'
    return { code, message: typeof candidate.message === 'string' ? candidate.message : '项目操作失败', project }
  }
  const message = error instanceof Error ? error.message : '项目操作失败'
  if (message.includes('移动') || message.includes('无法访问')) return { code: 'project-moved', message, project }
  return { code: 'unknown', message, project }
}
