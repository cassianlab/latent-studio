import type { InstallSkillInput, LinkSkillInput, SkillApi, SkillInstallation, UpdateSkillInput } from '../../shared/contracts/skills'

const items: SkillInstallation[] = []
const mockApi: SkillApi = {
  list: async () => structuredClone(items),
  link: async (input: LinkSkillInput) => { const item = { id: `mock-${Date.now()}`, name: input.sourcePath.split('/').at(-1) || 'skill', displayName: input.displayName || '本地 Skill', rootPath: input.sourcePath, scope: input.scope || 'global', source: 'link' as const, enabled: true, trusted: false, trustMode: 'controlled' as const, contentHash: 'preview', updatedAt: new Date().toISOString() }; items.push(item); return structuredClone(item) },
  install: async (input: InstallSkillInput) => mockApi.link(input),
  update: async (input: UpdateSkillInput) => { const item = items.find((entry) => entry.id === input.id); if (!item) throw new Error('Skill 不存在'); Object.assign(item, input); return structuredClone(item) },
  remove: async (id) => { const index = items.findIndex((item) => item.id === id); if (index >= 0) items.splice(index, 1) },
  rescan: async (id) => { const item = items.find((entry) => entry.id === id); if (!item) throw new Error('Skill 不存在'); return structuredClone(item) },
}

export function getSkillApi(): SkillApi {
  if (typeof window !== 'undefined' && window.latentStudio?.skills) return window.latentStudio.skills
  return mockApi
}
