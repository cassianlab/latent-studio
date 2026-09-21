import { useEffect, useId, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { LoaderCircle, X } from 'lucide-react'
import { getTaskApi } from './task-api'

export interface TaskRenameModalProps {
  taskId: string | null
  initialTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved?: (taskId: string, newTitle: string) => void
}

export function TaskRenameModal({
  taskId,
  initialTitle,
  open,
  onOpenChange,
  onSaved,
}: TaskRenameModalProps): React.ReactElement | null {
  const [title, setTitle] = useState(initialTitle)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  useEffect(() => {
    if (open) {
      setTitle(initialTitle)
      setError(null)
      setSubmitting(false)
    }
  }, [open, initialTitle])

  if (!taskId) return null

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const trimmed = title.trim()
    if (!trimmed) {
      setError('任务名称不能为空')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const taskApi = getTaskApi()
      await taskApi.rename(taskId, trimmed)
      onSaved?.(taskId, trimmed)
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重命名失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay task-detail-overlay" />
        <Dialog.Content className="dialog-content task-rename-dialog" style={{ maxWidth: 440 }}>
          <div className="dialog-head">
            <div>
              <Dialog.Title>重命名任务</Dialog.Title>
              <Dialog.Description>修改当前任务的显示名称</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="icon-button" aria-label="关闭">
                <X size={17} />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="task-rename-form">
            <div className="task-rename-field" style={{ padding: '16px 20px' }}>
              <label htmlFor={inputId} style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--text)' }}>
                任务名称
              </label>
              <input
                id={inputId}
                type="text"
                autoFocus
                value={title}
                maxLength={24}
                onChange={(e) => {
                  setTitle(e.target.value)
                  if (error) setError(null)
                }}
                placeholder="请输入任务名称"
                disabled={submitting}
                className="input"
                style={{ width: '100%', boxSizing: 'border-box' }}
                onFocus={(e) => e.currentTarget.select()}
              />
              {error && (
                <div style={{ color: 'var(--accent, #d32f2f)', fontSize: 12, marginTop: 6 }}>
                  {error}
                </div>
              )}
            </div>

            <div className="dialog-foot" style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
              <button
                type="button"
                className="secondary small"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                取消
              </button>
              <button
                type="submit"
                className="primary small"
                disabled={submitting || !title.trim()}
              >
                {submitting ? <LoaderCircle size={14} className="spin" /> : null}
                保存
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
