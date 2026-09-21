import { useCallback, useEffect, useMemo, useState } from 'react'
import { LoaderCircle, Pause, Play, RefreshCw, Search, X } from 'lucide-react'
import type { ImageTaskEvent } from '../../shared/contracts/images'
import type { TaskBatchAction, TaskBatchResult, TaskEvent } from '../../shared/contracts/tasks'
import { getImageApi } from '../settings/image-api'
import { getTaskApi } from './task-api'
import { TaskBatchConfirmDialog, type TaskConfirmAction } from './TaskBatchConfirmDialog'
import { TaskDetailModal, type TaskDetailData } from './TaskDetailModal'
import { TaskListTable, type TaskManagementAction } from './TaskListTable'
import { TaskRenameModal } from './TaskRenameModal'
import { TaskSelectionToolbar } from './TaskSelectionToolbar'
import './tasks.css'
import {
  buildTaskRows,
  filterTaskRows,
  imageTaskToRow,
  rowsForTaskAction,
  searchTaskRows,
  sortTaskRows,
  type TaskFilterKey,
  type TaskListRow,
  type TaskSortKey,
} from './task-list-model'

const FILTER_LABELS: Record<TaskFilterKey, string> = { running: '运行中', pending: '排队中', completed: '已完成', attention: '需要处理', archived: '已归档', all: '全部活动' }
const BATCH_ACTIONS: TaskBatchAction[] = ['cancel', 'retry', 'archive', 'restore', 'remove']
const ACTION_PAST_TENSE: Record<TaskBatchAction, string> = { cancel: '取消', retry: '重试', archive: '归档', restore: '恢复', remove: '删除' }

interface ConfirmRequest {
  action: TaskConfirmAction
  rows: TaskListRow[]
}

interface ActionFeedback {
  tone: 'success' | 'warning'
  message: string
}

function summarizeBatch(result: TaskBatchResult): ActionFeedback {
  const parts = [`已${ACTION_PAST_TENSE[result.action]} ${result.succeeded.length} 项`]
  if (result.skipped.length) parts.push(`${result.skipped.length} 项状态已变化，未处理`)
  if (result.failed.length) parts.push(`${result.failed.length} 项执行失败`)
  return { tone: result.failed.length || result.skipped.length ? 'warning' : 'success', message: parts.join('；') }
}

export function TasksPage(): React.ReactElement {
  const taskApi = useMemo(() => getTaskApi(), [])
  const imageApi = useMemo(() => getImageApi(), [])
  const [rows, setRows] = useState<TaskListRow[]>([])
  const [filter, setFilter] = useState<TaskFilterKey>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<TaskSortKey>('updated-desc')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [queuePaused, setQueuePaused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null)
  const [selectedTask, setSelectedTask] = useState<TaskDetailData | null>(null)
  const [renameTarget, setRenameTarget] = useState<Pick<TaskListRow, 'id' | 'title'> | null>(null)
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      const [tasks, images, archivedTasks, archivedImages, queueState] = await Promise.all([
        taskApi.list(),
        imageApi.list(),
        taskApi.list({ archived: true }),
        imageApi.list({ archived: true }),
        taskApi.getQueueState(),
      ])
      setRows(buildTaskRows(tasks, images, archivedTasks, archivedImages))
      setQueuePaused(queueState.paused)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务列表读取失败')
      if (!quiet) setRows([])
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [imageApi, taskApi])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const offTask = taskApi.onEvent((event: TaskEvent) => {
      if (event.type === 'created' || event.type === 'archived' || event.type === 'restored' || event.type === 'removed') {
        void load(true)
        return
      }
      setRows((current) => current.map((row) => row.id === event.task.id ? {
        ...row,
        title: event.task.title,
        status: event.task.status,
        progress: event.task.progress,
        updatedAt: event.task.updatedAt,
        error: event.task.error?.message,
      } : row))
    })
    const offImage = imageApi.onTaskEvent((event: ImageTaskEvent) => setRows((current) => {
      const next = imageTaskToRow(event.task, false)
      const index = current.findIndex((row) => row.id === next.id)
      return index < 0 ? [next, ...current] : current.map((row, rowIndex) => rowIndex === index ? next : row)
    }))
    return () => { offTask(); offImage() }
  }, [imageApi, load, taskApi])

  const activeRows = rows.filter((row) => !row.archived)
  const active = activeRows.filter((row) => row.status === 'running').length
  const queued = activeRows.filter((row) => row.status === 'pending').length
  const completed = activeRows.filter((row) => row.status === 'completed').length
  const needsAttention = activeRows.filter((row) => row.status === 'failed' || row.status === 'paused' || row.status === 'cancelled').length
  const archived = rows.filter((row) => row.archived).length
  const filteredRows = useMemo(() => sortTaskRows(searchTaskRows(filterTaskRows(rows, filter), query), sort), [filter, query, rows, sort])

  useEffect(() => {
    const visibleIds = new Set(filteredRows.map((row) => row.id))
    setSelectedIds((current) => {
      const next = new Set([...current].filter((taskId) => visibleIds.has(taskId)))
      return next.size === current.size ? current : next
    })
  }, [filteredRows])

  const batchTargets = useMemo(() => Object.fromEntries(
    BATCH_ACTIONS.map((action) => [action, rowsForTaskAction(rows, selectedIds, action)]),
  ) as Record<TaskBatchAction, TaskListRow[]>, [rows, selectedIds])
  const actionCounts = useMemo(() => Object.fromEntries(
    BATCH_ACTIONS.map((action) => [action, batchTargets[action].length]),
  ) as Record<TaskBatchAction, number>, [batchTargets])

  const setQueueState = async (paused: boolean) => {
    setPendingAction('queue')
    setError(null)
    try {
      if (paused) await taskApi.pause()
      else await taskApi.resume()
      setQueuePaused(paused)
      setFeedback({ tone: 'success', message: paused ? '任务队列已暂停' : '任务队列已继续执行' })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '队列状态更新失败')
    } finally {
      setPendingAction(null)
    }
  }

  const action = async (row: TaskListRow, kind: 'cancel' | 'retry') => {
    setPendingAction(`${kind}:${row.id}`)
    setError(null)
    try {
      const succeeded = await taskApi[kind](row.id)
      if (!succeeded) throw new Error(kind === 'cancel' ? '当前任务无法取消' : '当前任务无法重试')
      setFeedback({ tone: 'success', message: kind === 'cancel' ? '任务已取消' : '任务已重新进入队列' })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务操作失败')
    } finally {
      setPendingAction(null)
    }
  }

  const manage = async (row: TaskListRow, kind: TaskManagementAction) => {
    if (kind === 'remove') { setConfirmRequest({ action: 'remove', rows: [row] }); return }
    setPendingAction(`${kind}:${row.id}`)
    setError(null)
    try {
      const succeeded = await taskApi[kind](row.id)
      if (!succeeded) throw new Error(`当前任务无法${kind === 'archive' ? '归档' : '恢复'}，请刷新后重试`)
      if (selectedTask?.id === row.id && kind === 'archive') setSelectedTask(null)
      setFeedback({ tone: 'success', message: kind === 'archive' ? '任务已归档' : '任务已恢复' })
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '任务操作失败')
    } finally {
      setPendingAction(null)
    }
  }

  const executeBatch = async (batchAction: TaskBatchAction, targets: TaskListRow[]) => {
    if (!targets.length) return
    setPendingAction(`batch:${batchAction}`)
    setError(null)
    try {
      const result = await taskApi.batch({ action: batchAction, taskIds: targets.map((row) => row.id) })
      setFeedback(summarizeBatch(result))
      setSelectedIds(new Set([...result.skipped, ...result.failed.map((item) => item.taskId)]))
      if (batchAction === 'remove' && selectedTask && result.succeeded.includes(selectedTask.id)) setSelectedTask(null)
      setConfirmRequest(null)
      await load(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量任务操作失败')
    } finally {
      setPendingAction(null)
    }
  }

  const requestBatch = (batchAction: TaskBatchAction) => {
    const targets = batchTargets[batchAction]
    if (batchAction === 'cancel' || batchAction === 'remove') setConfirmRequest({ action: batchAction, rows: targets })
    else void executeBatch(batchAction, targets)
  }

  const toggleAll = (checked: boolean) => setSelectedIds((current) => {
    const next = new Set(current)
    for (const row of filteredRows) checked ? next.add(row.id) : next.delete(row.id)
    return next
  })

  return <div className="content-page">
    <div className="section-heading">
      <div><h2>任务中心</h2><p>集中查看模型任务、处理异常并批量管理历史记录</p></div>
      <div className="asset-header-actions">
        <button type="button" className="secondary small" onClick={() => void load(true)} disabled={loading || refreshing || pendingAction !== null} aria-label="刷新任务列表">
          <RefreshCw size={15} className={refreshing ? 'spin' : ''} />刷新
        </button>
        <button type="button" className={queuePaused ? 'primary small' : 'secondary small'} onClick={() => void setQueueState(!queuePaused)} disabled={pendingAction !== null} aria-pressed={queuePaused}>
          {pendingAction === 'queue' ? <LoaderCircle size={15} className="spin" /> : queuePaused ? <Play size={15} /> : <Pause size={15} />}
          {queuePaused ? '继续队列' : '暂停队列'}
        </button>
      </div>
    </div>

    <div className="metrics" role="group" aria-label="任务状态筛选">
      {([
        ['running', active, '运行中'],
        ['pending', queued, '排队中'],
        ['completed', completed, '已完成'],
        ['attention', needsAttention, '需要处理'],
        ['archived', archived, '已归档'],
      ] as const).map(([key, count, label]) => <button key={key} type="button" className={`metric-card ${filter === key ? 'active' : ''}`} onClick={() => setFilter((current) => current === key ? 'all' : key)} aria-pressed={filter === key}>
        <strong className={key === 'attention' && count > 0 ? 'text-accent' : ''}>{count}</strong><span>{label}</span>
      </button>)}
    </div>

    <div className="task-list-toolbar">
      <label className="task-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、模型、路由或错误" aria-label="搜索任务" />
        {query && <button type="button" className="icon-button" onClick={() => setQuery('')} aria-label="清空任务搜索"><X size={14} /></button>}
      </label>
      <label className="task-sort">排序<select value={sort} onChange={(event) => setSort(event.target.value as TaskSortKey)} aria-label="任务排序">
        <option value="updated-desc">最近更新</option><option value="created-asc">最早创建</option><option value="status">按状态</option>
      </select></label>
      <span className="task-result-count">{FILTER_LABELS[filter]} · {filteredRows.length} 项</span>
      {filter !== 'all' && <button type="button" className="text-button" onClick={() => setFilter('all')}>清除筛选</button>}
    </div>

    {error && <div className="task-notice error" role="alert"><span>{error}</span><button type="button" className="icon-button" onClick={() => void load(true)} aria-label="重试"><RefreshCw size={16} /></button></div>}
    {feedback && !error && <div className={`task-notice ${feedback.tone}`} role="status"><span>{feedback.message}</span><button type="button" className="icon-button" onClick={() => setFeedback(null)} aria-label="关闭提示"><X size={15} /></button></div>}

    <TaskSelectionToolbar selectedCount={selectedIds.size} actionCounts={actionCounts} pendingAction={pendingAction} onAction={requestBatch} onClear={() => setSelectedIds(new Set())} />

    {loading ? <div className="start-state"><LoaderCircle size={17} className="spin" />正在读取任务队列…</div> : <TaskListTable
      rows={filteredRows}
      selectedIds={selectedIds}
      pendingAction={pendingAction}
      onToggleAll={toggleAll}
      onToggle={(taskId, checked) => setSelectedIds((current) => { const next = new Set(current); checked ? next.add(taskId) : next.delete(taskId); return next })}
      onOpen={setSelectedTask}
      onRename={setRenameTarget}
      onAction={(row, kind) => void action(row, kind)}
      onManage={(row, kind) => void manage(row, kind)}
      onDelete={(row) => setConfirmRequest({ action: 'remove', rows: [row] })}
    />}

    <TaskDetailModal task={selectedTask} open={selectedTask !== null} onOpenChange={(open) => { if (!open) setSelectedTask(null) }} onCancel={(taskId) => { const row = rows.find((item) => item.id === taskId); if (row) void action(row, 'cancel') }} onRetry={(taskId) => { const row = rows.find((item) => item.id === taskId); if (row) void action(row, 'retry') }} onRename={(id, title) => { setRows((current) => current.map((row) => row.id === id ? { ...row, title } : row)); setSelectedTask((current) => current?.id === id ? { ...current, title } : current) }} />
    <TaskRenameModal taskId={renameTarget?.id ?? null} initialTitle={renameTarget?.title ?? ''} open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null) }} onSaved={(id, title) => { setRows((current) => current.map((row) => row.id === id ? { ...row, title } : row)); if (selectedTask?.id === id) setSelectedTask((current) => current ? { ...current, title } : null) }} />
    <TaskBatchConfirmDialog action={confirmRequest?.action ?? 'remove'} count={confirmRequest?.rows.length ?? 0} pending={pendingAction?.startsWith('batch:') === true} open={confirmRequest !== null} onOpenChange={(open) => { if (!open) setConfirmRequest(null) }} onConfirm={() => { if (confirmRequest) void executeBatch(confirmRequest.action, confirmRequest.rows) }} />
  </div>
}

export default TasksPage
