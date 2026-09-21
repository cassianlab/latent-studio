import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { InstallSkillInput, LinkSkillInput, SkillApi, UpdateSkillInput } from '../../shared/contracts/skills'
import { SkillStore } from './store'

const channels = { list: 'skills:list', link: 'skills:link', install: 'skills:install', update: 'skills:update', remove: 'skills:remove', rescan: 'skills:rescan' } as const

function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {} }
function requiredId(value: unknown): string { if (typeof value !== 'string' || !value.trim()) throw new Error('Skill 标识不能为空'); return value.trim() }
function selectedPath(value: unknown): string | undefined { return typeof value === 'string' && value.trim() ? value.trim() : undefined }

export interface SkillsIpcOptions { window: BrowserWindow; userDataPath: string; getProjectRoot: () => string | undefined; builtInRoot?: string }

export function registerSkillsIpc({ window, userDataPath, builtInRoot, getProjectRoot }: SkillsIpcOptions): () => void {
  const store = new SkillStore({ userDataPath, getProjectRoot, builtInRoot })
  const choose = async (title: string): Promise<string | null> => {
    const result = await dialog.showOpenDialog(window, { title, properties: ['openDirectory'] })
    return result.canceled ? null : result.filePaths[0] ?? null
  }
  const api: SkillApi = {
    list: () => store.list(),
    link: async (raw) => { const input = record(raw); const sourcePath = selectedPath(input.sourcePath) ?? await choose('选择要链接的 Skill 文件夹'); if (!sourcePath) throw new Error('未选择 Skill 文件夹'); return store.link({ sourcePath, displayName: selectedPath(input.displayName), note: selectedPath(input.note), scope: input.scope === 'project' ? 'project' : 'global' } satisfies LinkSkillInput) },
    install: async (raw) => { const input = record(raw); const sourcePath = selectedPath(input.sourcePath) ?? await choose('选择要安装的 Skill 文件夹'); if (!sourcePath) throw new Error('未选择 Skill 文件夹'); return store.install({ sourcePath, displayName: selectedPath(input.displayName), note: selectedPath(input.note), scope: input.scope === 'project' ? 'project' : 'global' } satisfies InstallSkillInput) },
    update: (raw) => store.update(raw as UpdateSkillInput),
    remove: (raw) => store.remove(requiredId(raw)),
    rescan: (raw) => store.rescan(requiredId(raw)),
  }
  const handlers: Array<[string, (...args: unknown[]) => unknown]> = [
    [channels.list, () => api.list()], [channels.link, (_event, raw) => api.link(raw as never)], [channels.install, (_event, raw) => api.install(raw as never)],
    [channels.update, (_event, raw) => api.update(raw as never)], [channels.remove, (_event, raw) => api.remove(record(raw).id as never)], [channels.rescan, (_event, raw) => api.rescan(record(raw).id as never)],
  ]
  for (const [channel, handler] of handlers) ipcMain.handle(channel, handler)
  return () => { for (const [channel] of handlers) ipcMain.removeHandler(channel) }
}

export { channels as skillIpcChannels }
