import React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, FileImage, FolderOpen, LoaderCircle, ShieldCheck, Trash2, WandSparkles, X } from 'lucide-react'
import type { ProjectAsset } from '../../shared/contracts/library'
import { CATEGORY_SELECT_OPTIONS } from './AssetInspector'
import './DeleteAssetDialog.css'

export interface DeleteAssetDialogProps {
  open: boolean
  target: ProjectAsset | null
  remark?: string
  previewUrl?: string | null
  busy?: boolean
  onConfirm: () => void | Promise<void>
  onClose: () => void
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function DeleteAssetDialog({
  open,
  target,
  remark,
  previewUrl,
  busy = false,
  onConfirm,
  onClose,
}: DeleteAssetDialogProps): React.ReactElement | null {
  if (!target) return null

  const displayName = remark?.trim() || target.name
  const isGenerated =
    target.origin === 'generated' ||
    target.category === 'output' ||
    target.relativePath.startsWith('outputs/') ||
    target.relativePath.includes('/outputs/')
  const categoryLabel =
    CATEGORY_SELECT_OPTIONS.find((opt) => opt.value === target.category)?.label ||
    (isGenerated ? '生成结果' : '素材')

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
          className="dialog-content asset-delete-dialog"
          aria-describedby="asset-delete-description"
        >
          {/* 头部标题与来源指示徽章 */}
          <div className="asset-delete-head">
            <div className="asset-delete-head-left">
              <span className={`asset-delete-warning-badge ${isGenerated ? 'generated' : 'imported'}`}>
                {isGenerated ? <AlertTriangle size={18} /> : <ShieldCheck size={18} />}
              </span>
              <div>
                <div className="asset-delete-title-row">
                  <Dialog.Title className="asset-delete-title">
                    {isGenerated ? '删除项目生成图片' : '移除导入素材'}
                  </Dialog.Title>
                  <span className={`asset-delete-origin-tag ${isGenerated ? 'generated' : 'imported'}`}>
                    {isGenerated ? '项目生成' : '外部导入'}
                  </span>
                </div>
                <Dialog.Description id="asset-delete-description" className="asset-delete-desc">
                  {isGenerated
                    ? '此操作将从磁盘中永久物理粉碎删除该生成的图片文件'
                    : '将此素材从当前项目素材库中移出，电脑本地原始文件完好保留'}
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

          {/* 目标素材缩略图与信息卡片 */}
          <div className="asset-delete-preview-box">
            <div className="asset-delete-thumb-wrap">
              {previewUrl ? (
                <img src={previewUrl} alt={displayName} className="asset-delete-thumb-img" />
              ) : (
                <FileImage size={22} className="asset-delete-thumb-fallback" />
              )}
            </div>
            <div className="asset-delete-info">
              <span className="asset-delete-name" title={displayName}>
                {displayName}
              </span>
              <div className="asset-delete-meta-row">
                <span className="asset-delete-category-badge">{categoryLabel}</span>
                <span className="asset-delete-meta-dot">·</span>
                <span className="asset-delete-meta-text tabular-nums">{formatBytes(target.byteLength)}</span>
              </div>
              <code className="asset-delete-path" title={target.relativePath}>
                {target.relativePath}
              </code>
            </div>
          </div>

          {/* 区分来源展示不同说明 */}
          <div className="asset-delete-impact-box">
            {isGenerated ? (
              <>
                <div className="asset-delete-impact-item danger">
                  <span className="asset-delete-impact-icon danger">
                    <Trash2 size={13} />
                  </span>
                  <div className="asset-delete-impact-text">
                    <strong>无外部备份，物理原文件将被彻底永久删除</strong>
                    <p>
                      该图片是由 AI 模型在当前项目中直接生成的原图，本地磁盘对应文件将被<strong>彻底物理粉碎清除</strong>，删除后无法找回。
                    </p>
                  </div>
                </div>

                <div className="asset-delete-impact-item info">
                  <span className="asset-delete-impact-icon info">
                    <WandSparkles size={13} />
                  </span>
                  <div className="asset-delete-impact-text">
                    <strong>提示词与生成参数保留建议</strong>
                    <p>
                      若您后续仍可能需要该画面的创意构图，建议在删除前点击“保存提示词”以保留完整执行参数。
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="asset-delete-impact-item safe">
                  <span className="asset-delete-impact-icon safe">
                    <ShieldCheck size={13} />
                  </span>
                  <div className="asset-delete-impact-text">
                    <strong>电脑初始源文件完好保留不受影响</strong>
                    <p>
                      该素材此前是由外部导入，您本地电脑最初所在文件夹（如下载、桌面等）的原始文件完好保留，<strong>不会被删除</strong>。
                    </p>
                  </div>
                </div>

                <div className="asset-delete-impact-item info">
                  <span className="asset-delete-impact-icon info">
                    <FolderOpen size={13} />
                  </span>
                  <div className="asset-delete-impact-text">
                    <strong>仅从本项目素材库中移除</strong>
                    <p>
                      该素材将从当前项目的素材库索引中移除，并清理项目内的临时副本。
                    </p>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 底部动作按钮栏 */}
          <div className="asset-delete-footer">
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
              className={`primary ${isGenerated ? 'danger' : 'remove-imported'}`}
              disabled={busy}
              onClick={() => void onConfirm()}
            >
              {busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : isGenerated ? (
                <Trash2 size={14} />
              ) : (
                <X size={14} />
              )}
              <span>
                {busy
                  ? isGenerated ? '正在删除…' : '正在移除…'
                  : isGenerated
                  ? '彻底删除原文件'
                  : '从素材库移除'}
              </span>
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
