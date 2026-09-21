import type { SkillInstallation } from '../../shared/contracts/skills'

export function eligibleComposerSkills(skills: readonly SkillInstallation[]): SkillInstallation[] {
  return skills
    .filter((skill) => skill.enabled && skill.trusted && (skill.scope !== 'project' || skill.projectAuthorized === true))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'))
}

export function skillCommandQuery(value: string): string | null {
  const match = value.match(/^\/([^\s/]*)$/)
  return match ? match[1] : null
}

export function clearSkillCommandDraft(value: string): string {
  return skillCommandQuery(value) === null ? value : ''
}

export function resolveSkillMenuKey(
  key: string,
  skillCount: number,
  activeIndex: number,
  shiftKey = false,
): { type: 'dismiss' } | { type: 'move' | 'select'; index: number } | null {
  if (key === 'Escape') return { type: 'dismiss' }
  if (skillCount < 1) return null
  if (key === 'ArrowDown') return { type: 'move', index: (activeIndex + 1) % skillCount }
  if (key === 'ArrowUp') return { type: 'move', index: (activeIndex - 1 + skillCount) % skillCount }
  if (key === 'Enter' && !shiftKey) return { type: 'select', index: Math.min(activeIndex, skillCount - 1) }
  return null
}

export function parseSkillCommand(value: string, skills: readonly SkillInstallation[]): { prompt: string; skillId?: string } {
  const trimmed = value.trim()
  const match = trimmed.match(/^\/([^\s/]+)(?:\s+([\s\S]*))?$/)
  if (!match) return { prompt: trimmed }
  const selected = eligibleComposerSkills(skills).find((skill) => skill.name === match[1])
  const prompt = match[2]?.trim()
  if (!selected || !prompt) return { prompt: trimmed }
  return { prompt, skillId: selected.id }
}
