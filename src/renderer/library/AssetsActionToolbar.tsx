import React from 'react'
import { BookmarkCheck, Check, ImagePlus, Minus, Trash2, X } from 'lucide-react'
import './AssetsActionToolbar.css'

export interface AssetsActionToolbarProps {
  totalDisplayed: number
  selectedCount: number
  referenceCount: number
  isAllDisplayedSelected: boolean
  onToggleSelectAll: () => void
  onBatchSetReference: () => void
  onBatchAddToCanvas: () => void
  onBatchDelete: () => void
  onClearSelection: () => void
}

export function AssetsActionToolbar({
  totalDisplayed,
  selectedCount,
  referenceCount,
  isAllDisplayedSelected,
  onToggleSelectAll,
  onBatchSetReference,
  onBatchAddToCanvas,
  onBatchDelete,
  onClearSelection,
}: AssetsActionToolbarProps): React.ReactElement {
  const hasSelection = selectedCount > 0
  const isPartial = selectedCount > 0 && !isAllDisplayedSelected

  return (
    <div className={`asset-action-toolbar ${hasSelection ? 'batch-active' : ''}`} role="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-select-group">
          <button
            type="button"
            className={`toolbar-master-checkbox ${hasSelection ? 'active' : ''} ${isPartial ? 'partial' : ''}`}
            onClick={onToggleSelectAll}
            aria-label={hasSelection ? '取消全选' : '全选当前素材'}
            title={hasSelection ? (isAllDisplayedSelected ? '取消全选' : '全选所有筛选素材') : '全选所有筛选素材'}
          >
            {isAllDisplayedSelected ? (
              <Check size={12} strokeWidth={3} />
            ) : isPartial ? (
              <Minus size={12} strokeWidth={3} />
            ) : null}
          </button>
          <button
            type="button"
            className="toolbar-select-text-btn"
            onClick={onToggleSelectAll}
          >
            {hasSelection ? `已选 ${selectedCount} 项` : '全选'}
          </button>
        </div>

        <span className="toolbar-divider" />

        <div className="toolbar-meta-info">
          <span>共 <b>{totalDisplayed}</b> 项素材</span>
          {referenceCount > 0 && (
            <span className="toolbar-ref-tag">
              <BookmarkCheck size={11} />
              <span>{referenceCount} 个参考图</span>
            </span>
          )}
        </div>
      </div>

      {hasSelection && (
        <div className="toolbar-right toolbar-batch-actions">
          <button
            type="button"
            className="secondary small toolbar-action-btn"
            onClick={onBatchSetReference}
            title="将勾选素材设为生图参考图（最多8项）"
          >
            <BookmarkCheck size={13} />
            <span>设为参考</span>
          </button>
          <button
            type="button"
            className="secondary small toolbar-action-btn"
            onClick={onBatchAddToCanvas}
            title="将勾选素材全部放入画布"
          >
            <ImagePlus size={13} />
            <span>放入画布</span>
          </button>
          <button
            type="button"
            className="danger small toolbar-action-btn asset-batch-del-btn"
            onClick={onBatchDelete}
            title="批量删除选中的素材"
          >
            <Trash2 size={13} />
            <span>批量删除 ({selectedCount})</span>
          </button>
          <button
            type="button"
            className="icon-button small toolbar-clear-btn"
            onClick={onClearSelection}
            title="取消选择"
            aria-label="取消选择"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
