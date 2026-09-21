export const MAX_AUTO_TASK_TITLE_LENGTH = 24

export function conciseTaskTitle(value: string | undefined, fallback: string): string {
  const normalized = value?.replace(/\s+/g, ' ').trim() ?? ''
  const firstClause = normalized.split(/[\n。！？!?;；,，]/, 1)[0]?.trim() ?? ''
  const candidate = firstClause.replace(/^(任务名称|任务标题|标题)\s*[:：]\s*/, '').trim() || fallback
  const characters = Array.from(candidate)
  if (characters.length <= MAX_AUTO_TASK_TITLE_LENGTH) return candidate
  return `${characters.slice(0, MAX_AUTO_TASK_TITLE_LENGTH - 1).join('')}…`
}
