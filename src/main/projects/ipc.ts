import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { access } from 'node:fs/promises'
import type { CreateProjectInput, ProjectSummary, RelocateProjectInput, RecentProjectsStore } from '../../shared/contracts/projects'
import { FileRecentProjectsStore } from './recent'
import { createProject, openProject, type ProjectHandle } from './storage'

const channels = {
  listRecent: 'projects:list-recent',
  create: 'projects:create',
  open: 'projects:open',
  relocate: 'projects:relocate',
} as const

function toSummary(handle: ProjectHandle): ProjectSummary {
  return {
    id: handle.manifest.id,
    name: handle.manifest.name,
    ...(handle.manifest.description ? { description: handle.manifest.description } : {}),
    path: handle.rootPath,
    displayPath: handle.rootPath,
    openedAt: new Date().toISOString(),
  }
}

function requireName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > 120) {
    throw new Error('项目名称需要为 1-120 个字符')
  }
  return value.trim()
}

function asInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

async function chooseDirectory(window: BrowserWindow, title: string): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0] ?? null
}

export interface ProjectIpcOptions {
  window: BrowserWindow
  recent?: RecentProjectsStore
  onProjectOpened?: (handle: ProjectHandle) => void | Promise<void>
}

export function registerProjectIpc({ window, recent, onProjectOpened }: ProjectIpcOptions): () => void {
  const recentStore = recent ?? new FileRecentProjectsStore(join(app.getPath('userData'), 'recent-projects.json'))
  const handles = new Map<string, ProjectHandle>()

  const remember = async (handle: ProjectHandle): Promise<ProjectSummary> => {
    const result = toSummary(handle)
    handles.set(result.path, handle)
    await onProjectOpened?.(handle)
    await recentStore.add({ id: result.id, name: result.name, path: result.path, openedAt: result.openedAt })
    return result
  }

  ipcMain.handle(channels.listRecent, async () => Promise.all((await recentStore.list()).map(async (entry) => {
    let available = true
    try { await access(entry.path) } catch { available = false }
    return { id: entry.id, name: entry.name, path: entry.path, displayPath: entry.path, openedAt: entry.openedAt, available }
  })))

  ipcMain.handle(channels.create, async (_event, raw: CreateProjectInput) => {
    const input = asInput(raw)
    const selectedDirectory = await chooseDirectory(window, '选择项目文件夹')
    if (!selectedDirectory) return null
    const handle = await createProject({
      selectedDirectory,
      projectRoot: selectedDirectory,
      name: requireName(input.name),
      description: typeof input.description === 'string' ? input.description : undefined,
    })
    return remember(handle)
  })

  ipcMain.handle(channels.open, async (_event, raw?: { projectRoot?: unknown }) => {
    const input = asInput(raw)
    const requestedPath = typeof input.projectRoot === 'string' ? input.projectRoot : null
    const knownRecent = requestedPath ? (await recentStore.list()).some((entry) => entry.path === requestedPath) : false
    const projectRoot = knownRecent ? requestedPath : await chooseDirectory(window, '打开 Latent Studio 项目')
    if (!projectRoot) return null
    try {
      return remember(await openProject({ selectedDirectory: projectRoot, projectRoot }))
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'missing-manifest') {
        throw Object.assign(new Error('项目文件夹已移动或无法访问'), { code: 'project-moved' })
      }
      throw error
    }
  })

  ipcMain.handle(channels.relocate, async (_event, raw: RelocateProjectInput) => {
    const input = asInput(raw)
    if (typeof input.id !== 'string' || input.id.length === 0) throw new Error('项目标识缺失')
    const selectedDirectory = await chooseDirectory(window, '重新定位项目文件夹')
    if (!selectedDirectory) return null
    const handle = await openProject({ selectedDirectory, projectRoot: selectedDirectory })
    if (handle.manifest.id !== input.id) throw new Error('选择的文件夹不是原项目')
    return remember(handle)
  })

  return () => {
    for (const handle of handles.values()) handle.database.close?.()
    for (const channel of Object.values(channels)) ipcMain.removeHandler(channel)
  }
}
