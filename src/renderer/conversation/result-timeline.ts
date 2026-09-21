import type { SessionMessage, SessionResultCard } from './types'

export function partitionGalleryResults(results: readonly SessionResultCard[]): {
  cards: SessionResultCard[]
  unfinished: SessionResultCard[]
} {
  const cards: SessionResultCard[] = []
  const unfinished: SessionResultCard[] = []
  for (const result of results) {
    if (result.status === 'failed' || result.status === 'cancelled') unfinished.push(result)
    else cards.push(result)
  }
  return { cards, unfinished }
}

function resultTime(result: SessionResultCard): number | undefined {
  const value = result.task?.createdAt ?? result.task?.updatedAt
  if (!value) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function assignResultsToMessages(
  messages: readonly SessionMessage[],
  results: readonly SessionResultCard[],
): Map<string, string[]> {
  const assignments = new Map<string, string[]>()
  const assigned = new Set<string>()
  const resultIds = new Set(results.map((result) => result.id))

  for (const message of messages) {
    const ids = (message.imageTaskIds ?? []).filter((id) => resultIds.has(id) && !assigned.has(id))
    if (!ids.length) continue
    assignments.set(message.id, ids)
    ids.forEach((id) => assigned.add(id))
  }

  const candidates = messages.filter((message) => !message.pending)
  for (const result of results) {
    if (assigned.has(result.id) || !candidates.length) continue
    const timestamp = resultTime(result)
    const preceding = timestamp === undefined
      ? []
      : candidates.filter((message) => message.createdAt <= timestamp)
    const pool = preceding.length ? preceding : candidates
    const assistantPool = pool.filter((message) => message.role === 'assistant')
    const target = (assistantPool.length ? assistantPool : pool).at(-1)
    if (!target) continue
    assignments.set(target.id, [...(assignments.get(target.id) ?? []), result.id])
    assigned.add(result.id)
  }

  return assignments
}
