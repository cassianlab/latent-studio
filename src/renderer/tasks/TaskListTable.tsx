import { useEffect, useRef } from 'react'
import {
  Archive,
  ArchiveRestore,
  Info,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
} from 'lucide-react'
import type { TaskStatus } from '../../shared/contracts/tasks'
import { HoverTip } from '../common/HoverTip'
import { canManageTask, type TaskListRow } from './task-list-model'

export type TaskManagementAction = 'archive' | 'restore' | 'remove'

const STATUS_LABELS: Record<TaskStatus, string> = { completed: '完成', running: '运行中', pending: '排队中', paused: '已暂停', cancelled: '已取消', failed: '失败' }
const STATUS_TONES: Record<TaskStatus, string> = { completed: 'green', failed: 'red', cancelled: 'red', paused: 'amber', pending: 'neutral', running: 'neutral' }
const TASK_TIME = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

function formatTaskTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : TASK_TIME.format(date)
}

function TaskSelectAll({ checked, indeterminate, count, onChange }: {
  checked: boolean
  indeterminate: boolean
  count: number
  onChange: (checked: boolean) => void
}): React.ReactElement {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])
  return <input
    ref={ref}
    type="checkbox"
    checked={checked}
    disabled={count === 0}
    aria-label={`选择当前列表全部 ${count} 个任务`}
    onChange={(event) => onChange(event.target.checked)}
  />
}

export interface TaskListTableProps {
  rows: TaskListRow[]
  selectedIds: ReadonlySet<string>
  pendingAction: string | null
  onToggleAll: (checked: boolean) => void
  onToggle: (taskId: string, checked: boolean) => void
  onOpen: (row: TaskListRow) => void
  onRename: (row: TaskListRow) => void
  onAction: (row: TaskListRow, action: 'cancel' | 'retry') => void
  onManage: (row: TaskListRow, action: TaskManagementAction) => void
  onDelete: (row: TaskListRow) => void
}

export function TaskListTable({ rows, selectedIds, pendingAction, onToggleAll, onToggle, onOpen, onRename, onAction, onManage, onDelete }: TaskListTableProps): React.ReactElement {
  const selectedVisible = rows.filter((row) => selectedIds.has(row.id)).length
  const allSelected = rows.length > 0 && selectedVisible === rows.length
  const someSelected = selectedVisible > 0 && !allSelected
  const busy = pendingAction !== null

  return <div className="task-table" role="table" aria-label="任务列表" aria-rowcount={rows.length + 1} aria-colcount={6} aria-live="polite" aria-busy={busy}>
    <div className="task-header" role="row">
      <span className="task-select-cell" role="columnheader">
        <TaskSelectAll checked={allSelected} indeterminate={someSelected} count={rows.length} onChange={onToggleAll} />
      </span>
      <span role="columnheader">任务</span>
      <span role="columnheader">状态</span>
      <span role="columnheader">模型与路由</span>
      <span role="columnheader">进度</span>
      <span className="task-header-actions" role="columnheader">操作</span>
    </div>
    {rows.length === 0 ? <div className="task-empty-row">当前筛选范围内暂无任务</div> : rows.map((row) => {
      const selected = selectedIds.has(row.id)
      return <div key={row.id} className={`task-row ${row.archived ? 'archived' : ''} ${selected ? 'selected' : ''}`} role="row" aria-selected={selected}>
        <span className="task-select-cell" role="cell">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`选择任务：${row.title}`}
            onChange={(event) => onToggle(row.id, event.target.checked)}
          />
        </span>
        <span className="task-title-cell" role="cell"><button type="button" className="task-cell-title" onClick={() => onOpen(row)} title={`${row.title}\nID: ${row.id}`}>
          <strong>{row.title}</strong><small>{row.id}</small>
        </button></span>
        <span className="task-cell-status" role="cell">
          <span className={`pill ${STATUS_TONES[row.status] || 'neutral'}`}>{STATUS_LABELS[row.status] || '失败'}</span>
          <small>{formatTaskTime(row.updatedAt)}</small>
        </span>
        <span className="task-cell-model" role="cell" title={`${row.model} · ${row.route}`}>
          <strong>{row.model}</strong>
          <small>{row.route}</small>
        </span>
        <span className="progress" role="cell">
          <i><b style={{ width: `${row.progress}%` }} /></i>
          <small>{row.progress}%</small>
        </span>
        <span className="task-actions" role="cell">
          <HoverTip label="重命名任务"><button type="button" className="icon-button" aria-label="重命名任务" disabled={busy} onClick={() => onRename(row)}><Pencil size={14} /></button></HoverTip>
          <HoverTip label="查看任务详情"><button type="button" className="icon-button" aria-label="查看任务详情" disabled={busy} onClick={() => onOpen(row)}><Info size={15} /></button></HoverTip>
          {!row.archived && ['pending', 'running', 'paused'].includes(row.status) && (
            <HoverTip label="取消任务"><button type="button" className="icon-button" aria-label="取消任务" disabled={busy} onClick={() => onAction(row, 'cancel')}>
              {pendingAction === `cancel:${row.id}` ? <LoaderCircle size={14} className="spin" /> : <Square size={14} />}
            </button></HoverTip>
          )}
          {!row.archived && ['failed', 'cancelled', 'paused'].includes(row.status) && (
            <HoverTip label="重新生成/重试"><button type="button" className="icon-button" aria-label="重试任务" disabled={busy} onClick={() => onAction(row, 'retry')}>
              {pendingAction === `retry:${row.id}` ? <LoaderCircle size={15} className="spin" /> : <RefreshCw size={15} />}
            </button></HoverTip>
          )}
          {!row.archived && canManageTask(row.status) && (
            <HoverTip label="归档此任务"><button type="button" className="icon-button" aria-label="归档任务" disabled={busy} onClick={() => onManage(row, 'archive')}>
              {pendingAction === `archive:${row.id}` ? <LoaderCircle size={15} className="spin" /> : <Archive size={15} />}
            </button></HoverTip>
          )}
          {row.archived && (
            <HoverTip label="恢复归档任务"><button type="button" className="icon-button" aria-label="恢复归档任务" disabled={busy} onClick={() => onManage(row, 'restore')}>
              {pendingAction === `restore:${row.id}` ? <LoaderCircle size={15} className="spin" /> : <ArchiveRestore size={15} />}
            </button></HoverTip>
          )}
          {canManageTask(row.status) && (
            <HoverTip label="删除任务记录"><button type="button" className="icon-button danger" aria-label="删除任务" disabled={busy} onClick={() => onDelete(row)}><Trash2 size={15} /></button></HoverTip>
          )}
        </span>
      </div>
    })}
  </div>
}
