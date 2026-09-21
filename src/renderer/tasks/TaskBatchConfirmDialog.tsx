import * as Dialog from '@radix-ui/react-dialog'
import { LoaderCircle, X } from 'lucide-react'

export type TaskConfirmAction = 'cancel' | 'remove'

export function TaskBatchConfirmDialog({ action, count, pending, open, onOpenChange, onConfirm }: {
  action: TaskConfirmAction
  count: number
  pending: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}): React.ReactElement {
  const deleting = action === 'remove'
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next) }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay task-delete-overlay" />
      <Dialog.Content className="dialog-content task-delete-dialog">
        <div className="dialog-head">
          <div>
            <Dialog.Title>{deleting ? '删除任务记录' : '取消所选任务'}</Dialog.Title>
            <Dialog.Description>{deleting ? '此操作不可撤销' : '运行中的请求将立即停止'}</Dialog.Description>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" disabled={pending} onClick={() => onOpenChange(false)}><X size={17} /></button>
        </div>
        <p className="task-delete-copy">
          {deleting
            ? `确定删除所选的 ${count} 条任务记录？已生成的图片文件会继续保留在输出目录中。`
            : `确定取消所选的 ${count} 个可取消任务？已完成的任务和已生成结果不会受到影响。`}
        </p>
        <footer>
          <button type="button" className="secondary" disabled={pending} onClick={() => onOpenChange(false)}>返回</button>
          <button type="button" className={`primary ${deleting ? 'danger' : ''}`} disabled={pending || count === 0} onClick={onConfirm}>
            {pending && <LoaderCircle size={14} className="spin" />}
            {deleting ? `删除 ${count} 条记录` : `取消 ${count} 个任务`}
          </button>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
