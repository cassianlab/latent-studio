import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, FileImage, LoaderCircle, ShieldAlert, X } from 'lucide-react'
import type { ProjectAsset } from '../../shared/contracts/library'
import { isGeneratedAsset, summarizeBatchAssets } from './asset-batch-utils'
import './DeleteAssetDialog.css'

export interface BatchDeleteAssetDialogProps {
  open: boolean
  targets: ProjectAsset[]
  previews: Record<string, string>
  remarks: Record<string, string>
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

export function BatchDeleteAssetDialog({
  open,
  targets,
  previews,
  remarks,
  busy = false,
  onConfirm,
  onClose,
}: BatchDeleteAssetDialogProps): React.ReactElement | null {
  if (!open || targets.length === 0) return null

  const summary = summarizeBatchAssets(targets)
  const hasGenerated = summary.generated > 0
  const hasImported = summary.imported > 0

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onClose()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay asset-delete-overlay" />
        <Dialog.Content
          className="dialog-content asset-delete-dialog asset-batch-delete-dialog"
          aria-describedby="asset-batch-delete-desc"
        >
          {/* 头部标题与警告指示 */}
          <div className="asset-delete-head">
            <div className="asset-delete-head-left">
              <span className={`asset-delete-warning-badge ${hasGenerated ? 'generated' : 'imported'}`}>
                {hasGenerated ? <ShieldAlert size={20} /> : <AlertTriangle size={20} />}
              </span>
              <div>
                <div className="asset-delete-title-row">
                  <Dialog.Title className="asset-delete-title">
                    批量删除 {summary.total} 项素材
                  </Dialog.Title>
                </div>
                <Dialog.Description id="asset-batch-delete-desc" className="asset-delete-desc">
                  {hasGenerated && hasImported
                    ? `包含 ${summary.generated} 项生成图片（磁盘永久删除）与 ${summary.imported} 项外部素材（移出素材库）`
                    : hasGenerated
                      ? `已选 ${summary.total} 项均为项目生成图片，确认后将从本地磁盘永久删除`
                      : `已选 ${summary.total} 项均为外部导入素材，确认后将移出素材库（本地原文件保留）`}
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

          {/* 素材缩略图横向展示条 */}
          <div className="asset-batch-preview-strip">
            {targets.slice(0, 12).map((item) => {
              const displayName = remarks[item.id]?.trim() || item.name
              const preview = previews[item.id]
              const isGen = isGeneratedAsset(item)
              return (
                <div key={item.id} className="asset-batch-thumb-item" title={displayName}>
                  {preview ? (
                    <img src={preview} alt={displayName} className="asset-batch-thumb-img" />
                  ) : (
                    <div className="asset-batch-thumb-fallback">
                      <FileImage size={16} />
                    </div>
                  )}
                  <span className={`asset-batch-thumb-tag ${isGen ? 'generated' : 'imported'}`}>
                    {isGen ? '生成' : '导入'}
                  </span>
                </div>
              )
            })}
            {targets.length > 12 && (
              <div className="asset-batch-thumb-more">
                +{targets.length - 12}
              </div>
            )}
          </div>

          {/* 汇总信息卡 */}
          <div className="asset-batch-summary-stats">
            <div className="asset-batch-stat-row">
              <span className="label">待处理项目</span>
              <span className="val">共 <b>{summary.total}</b> 项素材（约 {formatBytes(summary.totalBytes)}）</span>
            </div>
            {hasGenerated && (
              <div className="asset-batch-stat-row warn">
                <span className="label">物理永久删除</span>
                <span className="val"><b>{summary.generated}</b> 个生成文件（不可从废纸篓恢复）</span>
              </div>
            )}
            {hasImported && (
              <div className="asset-batch-stat-row">
                <span className="label">仅移出素材库</span>
                <span className="val"><b>{summary.imported}</b> 个导入素材（电脑原始文件保留）</span>
              </div>
            )}
          </div>

          {/* 底部操作区 */}
          <div className="asset-delete-actions">
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
              className="danger asset-delete-btn"
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? (
                <>
                  <LoaderCircle size={15} className="spin" />
                  <span>正在批量删除…</span>
                </>
              ) : (
                <span>确认删除 {summary.total} 项</span>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
