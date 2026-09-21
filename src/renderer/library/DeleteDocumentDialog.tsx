import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, FileText, LoaderCircle, Trash2, X } from 'lucide-react'
import type { ProjectItemMetadata } from '../../shared/contracts/library'
import './DeleteDocumentDialog.css'

export interface DeleteDocumentDialogProps {
  open: boolean
  document: ProjectItemMetadata | null
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function DeleteDocumentDialog({
  open,
  document,
  busy = false,
  onConfirm,
  onClose,
}: DeleteDocumentDialogProps): React.ReactElement | null {
  if (!document) return null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay document-delete-overlay" />
        <Dialog.Content
          className="dialog-content document-delete-dialog"
          aria-describedby="document-delete-description"
        >
          {/* Header */}
          <div className="document-delete-head">
            <div className="document-delete-head-left">
              <span className="document-delete-warning-badge">
                <AlertTriangle size={18} />
              </span>
              <div>
                <div className="document-delete-title-row">
                  <Dialog.Title className="document-delete-title">
                    删除项目文档
                  </Dialog.Title>
                  <span className="document-delete-tag">永久删除</span>
                </div>
                <Dialog.Description id="document-delete-description" className="document-delete-desc">
                  此操作将从项目目录中永久删除该文档文件
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

          {/* Document File Preview */}
          <div className="document-delete-preview-box">
            <div className="document-delete-file-icon">
              <FileText size={20} />
            </div>
            <div className="document-delete-info">
              <strong className="document-delete-filename" title={document.name}>
                {document.name}
              </strong>
              <span className="document-delete-meta">
                {document.relativePath} · {formatBytes(document.byteLength)}
              </span>
            </div>
          </div>

          {/* Warning notice */}
          <div className="document-delete-warning-note">
            <AlertTriangle size={14} className="document-delete-warn-icon" />
            <span>删除后不可恢复。该文档将直接从磁盘永久清除，无法从回收站找回。</span>
          </div>

          {/* Actions */}
          <div className="document-delete-actions">
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
              className="danger document-delete-confirm-btn"
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
