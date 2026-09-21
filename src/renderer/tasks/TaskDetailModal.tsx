import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Check, Copy, FolderOpen, LoaderCircle, Pencil, RefreshCw, Square, X } from 'lucide-react'
import type { ImageTaskRecord } from '../../shared/contracts/images'
import type { TaskStatus } from '../../shared/contracts/tasks'
import { getImageApi } from '../settings/image-api'
import { getTaskApi } from './task-api'
import { resolveTaskImagePreviews } from './task-detail-model'
import { HoverTip } from '../common/HoverTip'

export interface TaskDetailData {
  id: string
  title: string
  status: TaskStatus
  progress: number
  model: string
  route: string
  archived?: boolean
  image?: ImageTaskRecord
  error?: string
}

export interface TaskDetailModalProps {
  task: TaskDetailData | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel?: (taskId: string) => void
  onRetry?: (taskId: string) => void
  onRename?: (taskId: string, newTitle: string) => void
}

function taskStatusLabel(status: TaskStatus): string {
  if (status === 'completed') return '已完成'
  if (status === 'running') return '运行中'
  if (status === 'pending') return '排队中'
  if (status === 'paused') return '已暂停'
  if (status === 'cancelled') return '已取消'
  return '失败'
}

function taskTone(status: TaskStatus): string {
  if (status === 'completed') return 'green'
  if (status === 'failed' || status === 'cancelled') return 'red'
  if (status === 'paused') return 'amber'
  return 'neutral'
}

export function TaskDetailModal({
  task,
  open,
  onOpenChange,
  onCancel,
  onRetry,
  onRename,
}: TaskDetailModalProps): React.ReactElement | null {
  const [copied, setCopied] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [savingTitle, setSavingTitle] = useState(false)
  const [renameError, setRenameError] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !task) return
    setDraftTitle(task.title)
    setEditingTitle(false)
    setSavingTitle(false)
    setRenameError(null)
  }, [open, task?.id, task?.title])

  if (!task) return null

  const prompt = task.image?.request.prompt || task.title
  const errorMsg = task.image?.error?.message || task.error
  const imagePreviews = resolveTaskImagePreviews(task.image?.result?.images ?? [])

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  const saveTitle = async () => {
    const title = draftTitle.trim()
    if (!title) {
      setRenameError('任务名称不能为空')
      return
    }
    setSavingTitle(true)
    setRenameError(null)
    try {
      const renamed = await getTaskApi().rename(task.id, title)
      if (!renamed) throw new Error('任务不存在或已被删除')
      setDraftTitle(renamed.title)
      setEditingTitle(false)
      onRename?.(task.id, renamed.title)
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : '重命名失败')
    } finally {
      setSavingTitle(false)
    }
  }

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay task-detail-overlay" />
          <Dialog.Content
            ref={contentRef}
            tabIndex={-1}
            className="dialog-content task-detail-dialog"
            onOpenAutoFocus={(event) => {
              event.preventDefault()
              contentRef.current?.focus()
            }}
          >
            <div className="dialog-head">
              <div>
                <div className="task-detail-title-row">
                  <Dialog.Title className={editingTitle ? 'sr-only' : undefined}>{task.title}</Dialog.Title>
                  {editingTitle ? <div className="task-detail-title-editor">
                    <input
                      autoFocus
                      value={draftTitle}
                      maxLength={24}
                      aria-label="任务名称"
                      disabled={savingTitle}
                      onChange={(event) => {
                        setDraftTitle(event.target.value)
                        if (renameError) setRenameError(null)
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault()
                          void saveTitle()
                        } else if (event.key === 'Escape') {
                          setDraftTitle(task.title)
                          setEditingTitle(false)
                          setRenameError(null)
                        }
                      }}
                    />
                    <HoverTip label="保存名称"><button type="button" className="icon-button" aria-label="保存任务名称" disabled={savingTitle || !draftTitle.trim()} onClick={() => void saveTitle()}>
                      {savingTitle ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}
                    </button></HoverTip>
                    <HoverTip label="取消编辑"><button type="button" className="icon-button" aria-label="取消编辑任务名称" disabled={savingTitle} onClick={() => {
                      setDraftTitle(task.title)
                      setEditingTitle(false)
                      setRenameError(null)
                    }}><X size={14} /></button></HoverTip>
                  </div> : <HoverTip label="编辑任务名称">
                    <button type="button" className="icon-button" aria-label="编辑任务名称" onClick={() => setEditingTitle(true)}>
                      <Pencil size={13} />
                    </button>
                  </HoverTip>}
                  <span className={`pill ${taskTone(task.status)}`}>
                    {taskStatusLabel(task.status)}
                  </span>
                </div>
                {renameError && <p className="task-detail-title-error" role="alert">{renameError}</p>}
                <Dialog.Description>ID: {task.id}</Dialog.Description>
              </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="关闭">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <div className="task-detail-body">
            {errorMsg && (
              <div className="task-detail-error" role="alert">
                <AlertCircle size={16} />
                <div>
                  <strong>执行失败原因</strong>
                  <p>{errorMsg}</p>
                </div>
              </div>
            )}

            {imagePreviews.length > 0 && (
              <section className="task-detail-preview-section" aria-label="任务生成结果">
                <div className="task-detail-section-label">
                  <span>生成结果</span>
                  <small>{imagePreviews.length} 张</small>
                </div>
                <div className="task-detail-preview-grid">
                  {imagePreviews.map((preview, index) => (
                    <figure
                      className="task-detail-preview"
                      key={`${preview.src}-${index}`}
                      style={preview.aspectRatio ? { aspectRatio: preview.aspectRatio } : undefined}
                    >
                      <img src={preview.src} alt={`${task.title} - 结果 ${index + 1}`} loading="lazy" />
                      {preview.width && preview.height && (
                        <figcaption>{preview.width} x {preview.height}</figcaption>
                      )}
                    </figure>
                  ))}
                </div>
              </section>
            )}

            <div className="task-detail-meta-grid">
              <div>
                <label>使用模型</label>
                <span>{task.model}</span>
              </div>
              <div>
                <label>执行路由</label>
                <span>{task.route}</span>
              </div>
              <div>
                <label>任务进度</label>
                <span>{task.progress}%</span>
              </div>
              {task.image?.request.size && (
                <div>
                  <label>输出分辨率</label>
                  <span>{task.image.request.size}</span>
                </div>
              )}
            </div>

            <div className="task-detail-prompt-block">
              <div className="task-detail-prompt-header">
                <label>执行提示词</label>
                <button
                  type="button"
                  className="icon-text-button"
                  onClick={() => void copyPrompt()}
                  aria-label="复制提示词"
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <p className="task-detail-prompt-text">{prompt}</p>
            </div>

            {task.image?.result?.images[0]?.localPath && (
              <div className="task-detail-prompt-block">
                <div className="task-detail-prompt-header">
                  <label>本地保存路径</label>
                  <button
                    type="button"
                    className="icon-text-button"
                    onClick={() => void getImageApi().revealOutput?.({ taskId: task.id, localPath: task.image?.result?.images[0]?.localPath })}
                    aria-label="在访达中显示已保存图片"
                  >
                    <FolderOpen size={13} />
                    <span>在访达中定位</span>
                  </button>
                </div>
                <code className="task-detail-path-text">{task.image.result.images[0].localPath}</code>
              </div>
            )}
          </div>

          <footer>
            {['pending', 'running', 'paused'].includes(task.status) && onCancel && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  onCancel(task.id)
                  onOpenChange(false)
                }}
              >
                <Square size={14} />
                <span>取消任务</span>
              </button>
            )}

            {!task.archived && ['failed', 'cancelled', 'paused'].includes(task.status) && onRetry && (
              <button
                type="button"
                className="primary"
                onClick={() => {
                  onRetry(task.id)
                  onOpenChange(false)
                }}
              >
                <RefreshCw size={14} />
                <span>重试此任务</span>
              </button>
            )}

            <Dialog.Close asChild>
              <button type="button" className="secondary">
                关闭
              </button>
            </Dialog.Close>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </>
  )
}
