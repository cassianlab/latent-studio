import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Brain, FolderLock, Globe, LoaderCircle, Trash2, X } from 'lucide-react'
import type { MemoryEntry } from '../../shared/contracts/library'
import './DeleteMemoryDialog.css'

export interface DeleteMemoryDialogProps {
  open: boolean
  memory: MemoryEntry | null
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

export function DeleteMemoryDialog({
  open,
  memory,
  busy = false,
  onConfirm,
  onClose,
}: DeleteMemoryDialogProps): React.ReactElement | null {
  if (!memory) return null

  const isGlobal = memory.scope === 'global'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay memory-delete-overlay" />
        <Dialog.Content
          className="dialog-content memory-delete-dialog"
          aria-describedby="memory-delete-description"
        >
          {/* Header */}
          <div className="memory-delete-head">
            <div className="memory-delete-head-left">
              <span className={`memory-delete-badge ${isGlobal ? 'global' : 'project'}`}>
                {isGlobal ? <Globe size={18} /> : <FolderLock size={18} />}
              </span>
              <div>
                <div className="memory-delete-title-row">
                  <Dialog.Title className="memory-delete-title">
                    删除记忆规则
                  </Dialog.Title>
                  <span className={`memory-delete-scope-tag ${isGlobal ? 'global' : 'project'}`}>
                    {isGlobal ? '全局记忆' : '项目记忆'}
                  </span>
                </div>
                <Dialog.Description id="memory-delete-description" className="memory-delete-desc">
                  {isGlobal
                    ? '此全局记忆在所有项目中生效，删除后将彻底移除'
                    : '此记忆仅对当前项目生效，删除后不再参与提示词编译'}
                </Dialog.Description>
              </div>
            </div>
            <button
              type="button"
              className="icon-button"
              aria-label="关闭"
              disabled={busy}
              onClick={onClose}
            >
              <X size={17} />
            </button>
          </div>

          {/* Target Preview */}
          <div className="memory-delete-preview-box">
            <div className="memory-delete-preview-meta">
              <span className="memory-delete-name-tag">
                <Brain size={14} />
                <strong>{memory.title}</strong>
              </span>
              <span className="memory-delete-submeta">
                v{memory.version} · {memory.source || '手动维护'}
              </span>
            </div>
            <p className="memory-delete-preview-content">
              {memory.content}
            </p>
          </div>

          {/* Warning notice */}
          <div className="memory-delete-warning-note">
            <AlertTriangle size={14} className="memory-delete-warn-icon" />
            <span>删除后不可恢复。后续生成图片时，该项设定的约束规则将立即停止注入。</span>
          </div>

          {/* Actions */}
          <div className="memory-delete-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={onClose}
            >
              取消
            </button>
            <button
              type="button"
              className="danger memory-delete-confirm-btn"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  <span>删除中…</span>
                </>
              ) : (
                <>
                  <Trash2 size={15} />
                  <span>彻底删除</span>
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
