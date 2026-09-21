import { useCallback, useEffect, useState } from 'react'
import type { ProjectSummary } from '../../shared/contracts/projects'
import { getProjectApi, projectError, type ProjectApi, type ProjectOperationError } from './project-api'

export type StartProjectsStatus = 'loading' | 'ready' | 'error'
export type StartProjectAction = 'create' | 'open' | 'relocate' | null

export interface StartProjectsState {
  projects: ProjectSummary[]
  status: StartProjectsStatus
  error: ProjectOperationError | null
  action: StartProjectAction
  movedProject: ProjectSummary | null
  reload: () => Promise<void>
  create: (input: { name: string; description?: string }) => Promise<ProjectSummary | null>
  open: (project?: ProjectSummary) => Promise<ProjectSummary | null>
  relocate: (project: ProjectSummary) => Promise<ProjectSummary | null>
  clearError: () => void
}

export function useStartProjects(api: ProjectApi = getProjectApi()): StartProjectsState {
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [status, setStatus] = useState<StartProjectsStatus>('loading')
  const [error, setError] = useState<ProjectOperationError | null>(null)
  const [action, setAction] = useState<StartProjectAction>(null)
  const [movedProject, setMovedProject] = useState<ProjectSummary | null>(null)

  const reload = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      setProjects(await api.listRecent())
      setStatus('ready')
    } catch (cause) {
      const nextError = projectError(cause)
      setStatus('error')
      setError(nextError)
      setMovedProject(nextError.code === 'project-moved' ? nextError.project ?? null : null)
    }
  }, [api])

  useEffect(() => { void reload() }, [reload])

  const run = useCallback(async (kind: Exclude<StartProjectAction, null>, operation: () => Promise<ProjectSummary | null>, errorProject?: ProjectSummary) => {
    setAction(kind)
    setError(null)
    setMovedProject(null)
    try {
      const result = await operation()
      if (result) {
        setProjects(current => [result, ...current.filter(project => project.id !== result.id)])
      }
      return result
    } catch (cause) {
      const nextError = projectError(cause, errorProject)
      setError(nextError)
      if (nextError.code === 'project-moved') setMovedProject(nextError.project ?? null)
      return null
    } finally {
      setAction(null)
    }
  }, [])

  const create = useCallback((input: { name: string; description?: string }) => run('create', () => api.create(input)), [api, run])
  const open = useCallback((project?: ProjectSummary) => run('open', () => api.open(project ? { projectRoot: project.path } : undefined), project), [api, run])
  const relocate = useCallback((project: ProjectSummary) => run('relocate', () => api.relocate({ id: project.id })), [api, run])
  const clearError = useCallback(() => { setError(null); setMovedProject(null) }, [])

  return { projects, status, error, action, movedProject, reload, create, open, relocate, clearError }
}
