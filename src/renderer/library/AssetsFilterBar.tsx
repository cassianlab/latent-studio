import React from 'react'
import { BookmarkCheck, Command, ListFilter } from 'lucide-react'
import type { ProjectAssetCategory } from '../../shared/contracts/library'
import './AssetsFilterBar.css'

export const CATEGORY_OPTIONS: Array<{ value: ProjectAssetCategory | ''; label: string }> = [
  { value: '', label: '全部' },
  { value: 'character', label: '角色' },
  { value: 'scene', label: '场景' },
  { value: 'prop', label: '道具' },
  { value: 'style-reference', label: '风格参考' },
  { value: 'reference', label: '普通参考图' },
  { value: 'output', label: '生成结果' },
  { value: 'other', label: '其他' },
]

export interface AssetsFilterBarProps {
  category: ProjectAssetCategory | ''
  onCategoryChange: (category: ProjectAssetCategory | '') => void
  onlyReferences: boolean
  onToggleOnlyReferences: () => void
  referenceCount: number
  search: string
  onSearchChange: (val: string) => void
  showShortcutsPopover: boolean
  onToggleShortcutsPopover: () => void
}

export function AssetsFilterBar({
  category,
  onCategoryChange,
  onlyReferences,
  onToggleOnlyReferences,
  referenceCount,
  search,
  onSearchChange,
  showShortcutsPopover,
  onToggleShortcutsPopover,
}: AssetsFilterBarProps): React.ReactElement {
  return (
    <div className="filterbar">
      <div className="segmented segmented-scroll">
        {CATEGORY_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            className={category === option.value ? 'active' : ''}
            onClick={() => onCategoryChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <button
        type="button"
        className={`ref-filter-btn ${onlyReferences ? 'active' : ''}`}
        onClick={onToggleOnlyReferences}
        title="只查看已勾选为参考图的素材"
      >
        <BookmarkCheck size={14} />
        <span>仅看参考图</span>
        {referenceCount > 0 && <span className="ref-filter-badge">{referenceCount}</span>}
      </button>

      <label className="asset-search">
        <ListFilter size={15} />
        <input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索素材名称或备注..."
          aria-label="搜索素材"
        />
      </label>

      {/* Shortcuts Trigger Popover */}
      <div className="shortcuts-trigger-box">
        <button
          type="button"
          className={`shortcuts-trigger-btn ${showShortcutsPopover ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            onToggleShortcutsPopover()
          }}
          title="查看操作指南"
        >
          <Command size={13} />
          <span>指南</span>
        </button>

        {showShortcutsPopover && (
          <div className="shortcuts-popover-card" onClick={(e) => e.stopPropagation()}>
            <div className="shortcuts-popover-title">操作快捷指引</div>
            <div className="shortcuts-popover-row">
              <kbd>左上角勾选</kbd>
              <span>勾选素材（按住 Shift 支持连续多选）</span>
            </div>
            <div className="shortcuts-popover-row">
              <kbd>单击卡片</kbd>
              <span>在右侧检查并修改属性，Cmd/Ctrl 多选</span>
            </div>
            <div className="shortcuts-popover-row highlight">
              <kbd>双击卡片</kbd>
              <span>直接打开图像标注与编辑工具</span>
            </div>
            <div className="shortcuts-popover-row">
              <kbd>顶部操作栏</kbd>
              <span>多选后一键设为参考、放入画布或批量删除</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
