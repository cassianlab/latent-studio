import type { MemoryEntry } from '../contracts/library'
import { isExclusiveMemoryCategory, resolveMemoryCategory } from './categories'

export interface MemoryAuditRef {
  id: string
  version: number
  scope: 'project' | 'global'
}

export interface OverriddenGlobalMemory {
  globalMemory: MemoryEntry
  overriddenBy: MemoryEntry
}

export interface OverriddenMemory {
  memory: MemoryEntry
  overriddenBy: MemoryEntry
  reason: 'project-priority' | 'newer-in-scope'
}

export interface CompileMemoriesInput {
  projectMemories?: MemoryEntry[]
  globalMemories?: MemoryEntry[]
  maxEntries?: number
  maxChars?: number
}

export interface CompiledMemoryResult {
  items: MemoryEntry[]
  auditRefs: MemoryAuditRef[]
  overriddenGlobals: OverriddenGlobalMemory[]
  overriddenMemories: OverriddenMemory[]
  totalChars: number
  droppedCount: number
}

export function compileMemories(input: CompileMemoriesInput): CompiledMemoryResult {
  const maxEntries = input.maxEntries ?? 25
  const maxChars = input.maxChars ?? 4000

  const activeProject = (input.projectMemories ?? []).filter((m) => m.active !== false)
  const activeGlobal = (input.globalMemories ?? []).filter((m) => m.active !== false)
  const conflictKey = (memory: MemoryEntry): string => {
    const category = resolveMemoryCategory(memory)
    return isExclusiveMemoryCategory(category)
      ? `category:${category}`
      : `title:${memory.title.trim().toLocaleLowerCase()}`
  }
  const newerThan = (candidate: MemoryEntry, current: MemoryEntry): boolean => {
    const candidateTime = Date.parse(candidate.updatedAt)
    const currentTime = Date.parse(current.updatedAt)
    if (Number.isFinite(candidateTime) && Number.isFinite(currentTime) && candidateTime !== currentTime) return candidateTime > currentTime
    return candidate.version > current.version
  }
  const groups = new Map<string, MemoryEntry[]>()
  for (const memory of [...activeProject, ...activeGlobal]) {
    const key = conflictKey(memory)
    groups.set(key, [...(groups.get(key) ?? []), memory])
  }
  const winnerIds = new Set<string>()
  const overriddenGlobals: OverriddenGlobalMemory[] = []
  const overriddenMemories: OverriddenMemory[] = []
  for (const group of groups.values()) {
    const projectGroup = group.filter((memory) => memory.scope === 'project')
    const eligible = projectGroup.length ? projectGroup : group
    const winner = eligible.reduce((current, candidate) => newerThan(candidate, current) ? candidate : current)
    winnerIds.add(winner.id)
    for (const memory of group) {
      if (memory.id === winner.id) continue
      const projectPriority = winner.scope === 'project' && memory.scope === 'global'
      overriddenMemories.push({ memory, overriddenBy: winner, reason: projectPriority ? 'project-priority' : 'newer-in-scope' })
      if (projectPriority) overriddenGlobals.push({ globalMemory: memory, overriddenBy: winner })
    }
  }

  // Candidates: project memories first (higher precedence), followed by global memories
  const candidates = [...activeProject, ...activeGlobal].filter((memory) => winnerIds.has(memory.id))

  const items: MemoryEntry[] = []
  const auditRefs: MemoryAuditRef[] = []
  let totalChars = 0
  let droppedCount = 0

  for (const candidate of candidates) {
    if (items.length >= maxEntries) {
      droppedCount++
      continue
    }

    const itemCharLength = candidate.title.length + candidate.content.length + 20
    if (totalChars + itemCharLength > maxChars) {
      // Budget exceeded: drop lower priority whole item, do not cut mid-sentence
      droppedCount++
      continue
    }

    items.push(candidate)
    auditRefs.push({
      id: candidate.id,
      version: candidate.version,
      scope: candidate.scope,
    })
    totalChars += itemCharLength
  }

  return {
    items,
    auditRefs,
    overriddenGlobals,
    overriddenMemories,
    totalChars,
    droppedCount,
  }
}

export function formatCompiledMemoriesForPrompt(result: CompiledMemoryResult): string {
  if (!result.items.length) return ''
  const sections = result.items.map((entry, index) => {
    const scopeLabel = entry.scope === 'project' ? '项目限定约束' : '全局视觉偏好'
    const sourceLabel = entry.source ? ` · 来源: ${entry.source}` : ''
    return `${index + 1}. 【${entry.title}】(${scopeLabel}${sourceLabel})\n${entry.content}`
  })

  return `【已激活的长期记忆与创作规则设定】\n以下内容是默认持久偏好与项目规则。在本轮用户没有提出不同要求时遵循；本轮明确要求与长期记忆冲突时，以本轮要求为准：\n\n${sections.join('\n\n')}`
}

export function formatMemoriesForImagePrompt(result: CompiledMemoryResult): string {
  if (!result.items.length) return ''
  const rules = result.items.map((item) => `${item.title}: ${item.content}`).join('; ')
  return `[Default persistent constraints; if the current prompt explicitly conflicts, follow the current prompt: ${rules}]`
}
