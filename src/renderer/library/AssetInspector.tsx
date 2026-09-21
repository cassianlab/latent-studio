import React, { useEffect, useState } from 'react'
import { Check, Copy, FileImage, SlidersHorizontal, X } from 'lucide-react'
import type { ProjectAsset, ProjectAssetCategory } from '../../shared/contracts/library'

export const CATEGORY_SELECT_OPTIONS: Array<{ value: ProjectAssetCategory; label: string }> = [
  { value: 'character', label: '角色' },
  { value: 'scene', label: '场景' },
  { value: 'prop', label: '道具' },
  { value: 'style-reference', label: '风格参考' },
  { value: 'reference', label: '普通参考图' },
  { value: 'output', label: '生成结果' },
  { value: 'other', label: '其他' },
]

function getRatioLabel(w: number, h: number): string {
  if (!w || !h) return '未知'
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const divisor = gcd(w, h)
  const r = w / h
  if (Math.abs(r - 1) < 0.02) return '1:1 (正方形)'
  if (Math.abs(r - 16 / 9) < 0.03) return '16:9 (横屏)'
  if (Math.abs(r - 9 / 16) < 0.03) return '9:16 (竖屏)'
  if (Math.abs(r - 4 / 3) < 0.03) return '4:3 (标准横屏)'
  if (Math.abs(r - 3 / 4) < 0.03) return '3:4 (标准竖屏)'
  if (Math.abs(r - 3 / 2) < 0.03) return '3:2 (摄影横图)'
  if (Math.abs(r - 2 / 3) < 0.03) return '2:3 (摄影竖图)'
  if (Math.abs(r - 21 / 9) < 0.04) return '21:9 (宽银幕)'
  return `${w / divisor}:${h / divisor}`
}

interface AssetInspectorProps {
  selected: ProjectAsset
  preview?: string
  draftRemark: string
  busy: boolean
  onChangeDraftRemark: (value: string) => void
  onSaveRemark: (value: string) => void
  onCancelRemark: () => void
  onUpdateCategory: (category: ProjectAssetCategory) => void
  onClose?: () => void
}

export function AssetInspector({
  selected,
  preview,
  draftRemark,
  busy,
  onChangeDraftRemark,
  onSaveRemark,
  onCancelRemark,
  onUpdateCategory,
  onClose,
}: AssetInspectorProps): React.ReactElement {
  const [copied, setCopied] = useState(false)
  const [dimensions, setDimensions] = useState<{ width: number; height: number; ratio: string } | null>(null)

  useEffect(() => {
    if (!preview) {
      setDimensions(null)
      return
    }
    let active = true
    const img = new Image()
    img.onload = () => {
      if (!active) return
      const w = img.naturalWidth
      const h = img.naturalHeight
      if (w && h) {
        setDimensions({
          width: w,
          height: h,
          ratio: getRatioLabel(w, h),
        })
      }
    }
    img.src = preview
    return () => {
      active = false
    }
  }, [preview])

  const copyPath = () => {
    if (!selected.relativePath) return
    void navigator.clipboard.writeText(selected.relativePath)
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  const formatSize = (bytes: number) => {
    if (!bytes) return '未知大小'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <aside className="inspector-panel" aria-label="素材属性面板">
      {/* 1. Header Bar */}
      <div className="inspector-header">
        <div className="inspector-title">
          <SlidersHorizontal size={14} className="inspector-title-icon" />
          <span>素材属性</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="inspector-close-btn"
            onClick={onClose}
            aria-label="关闭属性面板"
            title="关闭面板"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* 2. Hero Preview Card */}
      <div className="inspector-hero-card">
        <div className="inspector-thumbnail-wrapper">
          {preview ? (
            <img src={preview} alt={draftRemark || selected.name} className="inspector-thumbnail-img" />
          ) : (
            <div className="inspector-thumbnail-empty">
              <FileImage size={24} />
            </div>
          )}
          <span className="inspector-badge-format">
            {selected.extension?.toUpperCase().slice(1) || 'PNG'}
          </span>
        </div>
        <div className="inspector-hero-meta">
          <span className="inspector-hero-name" title={draftRemark || selected.name}>
            {draftRemark || selected.name}
          </span>
          <span className="inspector-hero-sub">
            {dimensions ? `${dimensions.width}×${dimensions.height} · ` : ''}{formatSize(selected.byteLength)} · 双击卡片编辑
          </span>
        </div>
      </div>

      <div className="inspector-body">
        {/* 3. Remark & Title Input */}
        <div className="inspector-section">
          <label className="inspector-field-label" htmlFor="asset-remark-input">
            素材备注 / 别名
          </label>
          <input
            id="asset-remark-input"
            type="text"
            className="inspector-input"
            value={draftRemark}
            placeholder={selected.name}
            onChange={(e) => onChangeDraftRemark(e.target.value)}
            onBlur={() => onSaveRemark(draftRemark)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.currentTarget.blur()
              } else if (e.key === 'Escape') {
                onCancelRemark()
                e.currentTarget.blur()
              }
            }}
          />
          <div className="inspector-subtext" title={selected.name}>
            <span>原名：</span>
            <span className="inspector-filename">{selected.name}</span>
          </div>
        </div>

        {/* 4. Category Classification */}
        <div className="inspector-section">
          <label className="inspector-field-label" htmlFor="asset-category-select">
            所属分类
          </label>
          <div className="inspector-select-wrapper">
            <select
              id="asset-category-select"
              className="inspector-select"
              value={selected.category}
              onChange={(event) => onUpdateCategory(event.target.value as ProjectAssetCategory)}
              disabled={busy || selected.id.startsWith('mock-')}
            >
              {CATEGORY_SELECT_OPTIONS.map((option) => (
                <option value={option.value} key={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* 5. Specifications & Parameters List */}
        <div className="inspector-section">
          <span className="inspector-field-label">规格与参数</span>
          <div className="inspector-spec-box">
            {dimensions && (
              <>
                <div className="inspector-spec-row">
                  <span className="inspector-spec-key">像素尺寸</span>
                  <span className="inspector-spec-val tabular-nums">
                    {dimensions.width} × {dimensions.height} px
                  </span>
                </div>
                <div className="inspector-spec-row">
                  <span className="inspector-spec-key">画面比例</span>
                  <span className="inspector-spec-val">{dimensions.ratio}</span>
                </div>
              </>
            )}
            <div className="inspector-spec-row">
              <span className="inspector-spec-key">MIME 类型</span>
              <span className="inspector-spec-val font-mono">{selected.mimeType || 'image/png'}</span>
            </div>
            <div className="inspector-spec-row">
              <span className="inspector-spec-key">文件大小</span>
              <span className="inspector-spec-val tabular-nums">{formatSize(selected.byteLength)}</span>
            </div>
            <div className="inspector-spec-row">
              <span className="inspector-spec-key">导入时间</span>
              <span className="inspector-spec-val tabular-nums">
                {selected.importedAt ? new Date(selected.importedAt).toLocaleString('zh-CN', {
                  month: '2-digit',
                  day: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                }) : '原型示例'}
              </span>
            </div>

            <div className="inspector-path-row">
              <div className="inspector-path-header">
                <span className="inspector-spec-key">相对路径</span>
                <button
                  type="button"
                  className="inspector-copy-btn"
                  onClick={copyPath}
                  title="复制路径"
                >
                  {copied ? <Check size={11} className="text-green" /> : <Copy size={11} />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </button>
              </div>
              <code className="inspector-path-code" title={selected.relativePath}>
                {selected.relativePath}
              </code>
            </div>
          </div>
        </div>

        {/* 6. Subtle Micro Hint Footer */}
        <div className="inspector-micro-tip">
          💡 双击左侧素材卡片即可调起图像涂鸦与标注编辑器
        </div>
      </div>
    </aside>
  )
}
