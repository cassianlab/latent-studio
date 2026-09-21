import React from 'react'
import {
  BookmarkCheck,
  Check,
  FileImage,
  FolderOpen,
  ImagePlus,
  MoreHorizontal,
  PenLine,
  Trash2,
} from 'lucide-react'
import type { ProjectAsset, ProjectAssetCategory } from '../../shared/contracts/library'

const CATEGORY_LABELS: Record<ProjectAssetCategory, string> = {
  character: '角色',
  scene: '场景',
  prop: '道具',
  'style-reference': '风格参考',
  reference: '普通参考图',
  output: '生成结果',
  other: '其他',
}

export function categoryLabel(category: ProjectAssetCategory): string {
  return CATEGORY_LABELS[category] ?? '其他'
}

export function formatAssetSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export interface AssetCardProps {
  item: ProjectAsset
  isSelected: boolean
  isReference: boolean
  isCurrent: boolean
  preview?: string
  remark?: string
  isMenuOpen: boolean
  busy: boolean
  onSelect: (e: React.MouseEvent) => void
  onToggleSelect: (e: React.MouseEvent) => void
  onDoubleClick: () => void
  onToggleReference: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onAddToCanvas: () => void
  onOpenEditor: () => void
  onRevealInFinder: () => void
  onRemove: () => void
}

export function AssetCard({
  item,
  isSelected,
  isReference,
  isCurrent,
  preview,
  remark,
  isMenuOpen,
  busy,
  onSelect,
  onToggleSelect,
  onDoubleClick,
  onToggleReference,
  onToggleMenu,
  onCloseMenu,
  onAddToCanvas,
  onOpenEditor,
  onRevealInFinder,
  onRemove,
}: AssetCardProps): React.ReactElement {
  const displayName = remark || item.name

  return (
    <div
      role="button"
      tabIndex={0}
      className={`asset-card ${isCurrent ? 'selected' : ''} ${isSelected ? 'is-selected' : ''} ${
        isReference ? 'reference-selected' : ''
      }`}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          onDoubleClick()
        } else if (e.key === ' ') {
          e.preventDefault()
          onToggleSelect(e as unknown as React.MouseEvent)
        }
      }}
    >
      <div className="asset-preview">
        {/* Top-left multi-select checkbox */}
        <button
          type="button"
          className={`asset-card-checkbox ${isSelected ? 'active' : ''}`}
          aria-label={isSelected ? '取消勾选素材' : '勾选素材进行批量操作'}
          title={isSelected ? '已勾选（点击取消勾选）' : '点击勾选（支持按住 Shift 连续多选）'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleSelect(e)
          }}
        >
          {isSelected && <Check size={13} strokeWidth={3} />}
        </button>

        {/* Category Badge */}
        <span className="asset-badge-category">{categoryLabel(item.category)}</span>

        {/* Reference Image Badge if designated */}
        {isReference && (
          <span className="asset-badge-ref-tag" title="已设为生图参考图">
            <BookmarkCheck size={11} />
            <span>参考</span>
          </span>
        )}

        {/* Action button menu */}
        <button
          type="button"
          className={`asset-card-more-btn ${isMenuOpen ? 'active' : ''}`}
          aria-label="更多操作"
          title="操作选项"
          onClick={(e) => {
            e.stopPropagation()
            onToggleMenu()
          }}
        >
          <MoreHorizontal size={14} />
        </button>

        {isMenuOpen && (
          <div className="asset-card-menu" onClick={(e) => e.stopPropagation()} role="menu">
            <button
              type="button"
              className="asset-menu-item"
              onClick={() => {
                onCloseMenu()
                onToggleReference()
              }}
            >
              <BookmarkCheck size={13} />
              <span>{isReference ? '取消生图参考' : '设为生图参考'}</span>
            </button>
            <button
              type="button"
              className="asset-menu-item"
              disabled={busy || !item.previewable}
              onClick={() => {
                onCloseMenu()
                onAddToCanvas()
              }}
            >
              <ImagePlus size={13} />
              <span>放入画布</span>
            </button>
            <button
              type="button"
              className="asset-menu-item"
              onClick={() => {
                onCloseMenu()
                onOpenEditor()
              }}
            >
              <PenLine size={13} />
              <span>标注编辑</span>
            </button>
            <button
              type="button"
              className="asset-menu-item"
              disabled={busy}
              onClick={() => {
                onCloseMenu()
                onRevealInFinder()
              }}
            >
              <FolderOpen size={13} />
              <span>在访达中打开</span>
            </button>
            <div className="asset-menu-divider" />
            <button
              type="button"
              className="asset-menu-item danger"
              disabled={busy}
              onClick={() => {
                onCloseMenu()
                onRemove()
              }}
            >
              <Trash2 size={13} />
              <span>删除素材</span>
            </button>
          </div>
        )}

        {preview ? (
          <img src={preview} alt={displayName} loading="lazy" />
        ) : item.previewable ? (
          <FileImage size={24} />
        ) : (
          <span className="file-icon">{item.extension?.slice(1).toUpperCase() || 'FILE'}</span>
        )}
      </div>
      <div className="asset-card-content">
        <strong title={item.name}>{displayName}</strong>
        <small>
          {categoryLabel(item.category)} · {formatAssetSize(item.byteLength)}
        </small>
      </div>
    </div>
  )
}
