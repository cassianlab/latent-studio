import { Pencil } from 'lucide-react'
import type { SessionMessage, SessionResultCard } from './types'

export function canReEditTurn(messages: readonly SessionMessage[], index: number, results: readonly SessionResultCard[] = []): boolean {
  const message = messages[index]
  if (!message || message.role !== 'user') return false
  const nextAssistant = messages.slice(index + 1).find((candidate) => candidate.role === 'assistant')
  if (!nextAssistant) return false
  if (nextAssistant.cancelled) return true
  if (!nextAssistant.imageTaskIds?.length) return false
  const statuses = new Map(results.map((result) => [result.id, result.status]))
  const taskStatuses = nextAssistant.imageTaskIds.map((id) => statuses.get(id))
  return taskStatuses.some((status) => status === 'cancelled')
    && taskStatuses.every((status) => status === 'completed' || status === 'failed' || status === 'cancelled')
}

export function MessageReEditAction({ onEdit }: { onEdit: () => void }): React.ReactElement {
  return <button type="button" className="message-reedit-action" onClick={onEdit}><Pencil size={12} />重新编辑</button>
}
