import { Archive, ArchiveRestore, LoaderCircle, RefreshCw, Square, Trash2, X } from 'lucide-react'
import type { TaskBatchAction } from '../../shared/contracts/tasks'
import { HoverTip } from '../common/HoverTip'

const ACTIONS: Array<{ action: TaskBatchAction; label: string; icon: typeof Archive; danger?: boolean }> = [
  { action: 'cancel', label: '取消任务', icon: Square },
  { action: 'retry', label: '重试', icon: RefreshCw },
  { action: 'archive', label: '归档', icon: Archive },
  { action: 'restore', label: '恢复', icon: ArchiveRestore },
  { action: 'remove', label: '删除记录', icon: Trash2, danger: true },
]

export function TaskSelectionToolbar({ selectedCount, actionCounts, pendingAction, onAction, onClear }: {
  selectedCount: number
  actionCounts: Record<TaskBatchAction, number>
  pendingAction: string | null
  onAction: (action: TaskBatchAction) => void
  onClear: () => void
}): React.ReactElement | null {
  if (selectedCount === 0) return null
  const busy = pendingAction !== null
  return <div className="task-selection-toolbar" role="toolbar" aria-label="批量任务操作">
    <div className="task-selection-count" aria-live="polite">
      <strong>{selectedCount}</strong>
      <span>项已选择</span>
    </div>
    <div className="task-batch-actions">
      {ACTIONS.map(({ action, label, icon: Icon, danger }) => actionCounts[action] > 0 && (
        <button
          key={action}
          type="button"
          className={`secondary small ${danger ? 'danger' : ''}`}
          disabled={busy}
          onClick={() => onAction(action)}
        >
          {pendingAction === `batch:${action}` ? <LoaderCircle size={14} className="spin" /> : <Icon size={14} />}
          {label}
          <span className="task-action-count">{actionCounts[action]}</span>
        </button>
      ))}
    </div>
    <HoverTip label="清空选择">
      <button type="button" className="icon-button" aria-label="清空任务选择" disabled={busy} onClick={onClear}><X size={16} /></button>
    </HoverTip>
  </div>
}
