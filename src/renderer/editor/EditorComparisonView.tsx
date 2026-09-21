import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Stage, Layer } from 'react-konva'
import { Columns2, SlidersHorizontal, RotateCcw, Check, ChevronDown, Layers } from 'lucide-react'
import type { ImageEditorVersion } from '../../shared/contracts/editor'
import { getEditorApi } from './editor-api'
import { calculateCurtainSplit, type ComparisonViewMode } from './editor-model'

export interface EditorComparisonViewProps {
  /** 当前编辑画布的原图/底图 URL */
  sourcePreview: string
  /** 图片原始物理像素宽高 */
  naturalSize: { width: number; height: number }
  /** Konva 标注渲染节点 */
  renderedItems: React.ReactNode
  /** 历史版本列表（可选） */
  versions?: ImageEditorVersion[]
  /** 当前标注项数量 */
  itemCount?: number
  /** 退出对比模式的回调 */
  onExitCompare?: () => void
}

export function EditorComparisonView({
  sourcePreview,
  naturalSize,
  renderedItems,
  versions = [],
  itemCount = 0,
  onExitCompare,
}: EditorComparisonViewProps): React.ReactElement {
  const [mode, setMode] = useState<ComparisonViewMode>('curtain')
  const [splitPercent, setSplitPercent] = useState<number>(50)
  const [isDragging, setIsDragging] = useState<boolean>(false)

  // 对比基准选择：null 表示 v1 原图，否则为对应版本的 ID
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null)
  const [basePreview, setBasePreview] = useState<string>(sourcePreview)
  const [baseLoading, setBaseLoading] = useState<boolean>(false)
  const [isVersionDropdownOpen, setIsVersionDropdownOpen] = useState<boolean>(false)

  // 测量卷帘舞台与并排舞台的真实 DOM 像素尺寸，以便为 Konva Stage 计算等比缩放
  const curtainStageRef = useRef<HTMLDivElement>(null)
  const sideStageRef = useRef<HTMLDivElement>(null)
  const [curtainSize, setCurtainSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })
  const [sideSize, setSideSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 })

  // 监听选中的基准版本变化并加载对应预览图
  useEffect(() => {
    if (!selectedBaseId) {
      setBasePreview(sourcePreview)
      return
    }
    let cancelled = false
    setBaseLoading(true)
    getEditorApi()
      .getVersionPreview(selectedBaseId)
      .then((preview) => {
        if (!cancelled && preview) {
          setBasePreview(preview)
        }
      })
      .catch(() => {
        if (!cancelled) setBasePreview(sourcePreview)
      })
      .finally(() => {
        if (!cancelled) setBaseLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedBaseId, sourcePreview])

  // 观察容器尺寸自适应，更新 Konva 渲染尺寸
  useEffect(() => {
    const curtainEl = curtainStageRef.current
    if (!curtainEl) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setCurtainSize({ width: Math.round(width), height: Math.round(height) })
        }
      }
    })
    observer.observe(curtainEl)
    return () => observer.disconnect()
  }, [mode])

  useEffect(() => {
    const sideEl = sideStageRef.current
    if (!sideEl) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) {
          setSideSize({ width: Math.round(width), height: Math.round(height) })
        }
      }
    })
    observer.observe(sideEl)
    return () => observer.disconnect()
  }, [mode])

  // 卷帘拖拽交互
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return
    setIsDragging(true)
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    if (curtainStageRef.current) {
      const rect = curtainStageRef.current.getBoundingClientRect()
      const nextSplit = calculateCurtainSplit(e.clientX, rect, 2, 98)
      setSplitPercent(nextSplit)
    }
  }, [])

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging || !curtainStageRef.current) return
      const rect = curtainStageRef.current.getBoundingClientRect()
      const nextSplit = calculateCurtainSplit(e.clientX, rect, 2, 98)
      setSplitPercent(nextSplit)
    },
    [isDragging]
  )

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    setIsDragging(false)
    try {
      ;(e.target as HTMLElement).releasePointerCapture?.(e.pointerId)
    } catch {
      // 忽略部分平台 capture 丢失
    }
  }, [])

  // 快捷比例设置
  const setQuickSplit = (percent: number) => {
    setSplitPercent(percent)
  }

  // 选中基准版本标题
  const selectedBaseLabel = useMemo(() => {
    if (!selectedBaseId) return 'v1 原始原图'
    const match = versions.find((v) => v.id === selectedBaseId)
    if (!match) return '历史版本'
    return `v${match.id.slice(0, 6)} (${new Date(match.createdAt).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })})`
  }, [selectedBaseId, versions])

  // 计算 Konva 舞台等比缩放因子
  const curtainScale = curtainSize.width > 0 ? curtainSize.width / naturalSize.width : 1
  const sideScale = sideSize.width > 0 ? sideSize.width / naturalSize.width : 1

  return (
    <div className="editor-comparison-container" data-testid="editor-comparison-view">
      {/* 顶部控制栏 */}
      <div className="comparison-topbar">
        <div className="comparison-modes">
          <button
            type="button"
            className={`mode-btn ${mode === 'curtain' ? 'active' : ''}`}
            onClick={() => setMode('curtain')}
            data-testid="mode-curtain-btn"
          >
            <SlidersHorizontal size={14} />
            <span>卷帘对比</span>
          </button>
          <button
            type="button"
            className={`mode-btn ${mode === 'side-by-side' ? 'active' : ''}`}
            onClick={() => setMode('side-by-side')}
            data-testid="mode-side-btn"
          >
            <Columns2 size={14} />
            <span>并排对比</span>
          </button>
        </div>

        {/* 基准版本切换 */}
        <div className="comparison-version-picker">
          <span className="picker-label">对比基准：</span>
          <div className="picker-dropdown-wrapper">
            <button
              type="button"
              className="picker-trigger-btn"
              onClick={() => setIsVersionDropdownOpen((v) => !v)}
              aria-expanded={isVersionDropdownOpen}
              data-testid="base-version-trigger"
            >
              <Layers size={13} />
              <span>{selectedBaseLabel}</span>
              <ChevronDown size={13} />
            </button>
            {isVersionDropdownOpen && (
              <div className="picker-menu">
                <button
                  type="button"
                  className={`menu-item ${selectedBaseId === null ? 'selected' : ''}`}
                  onClick={() => {
                    setSelectedBaseId(null)
                    setIsVersionDropdownOpen(false)
                  }}
                >
                  <span className="item-title">v1 原始原图</span>
                  {selectedBaseId === null && <Check size={14} className="check-icon" />}
                </button>
                {versions.map((ver) => (
                  <button
                    type="button"
                    key={ver.id}
                    className={`menu-item ${selectedBaseId === ver.id ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedBaseId(ver.id)
                      setIsVersionDropdownOpen(false)
                    }}
                  >
                    <div className="item-info">
                      <span className="item-title">v{ver.id.slice(0, 6)}</span>
                      <span className="item-sub">
                        {new Date(ver.createdAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {ver.suggestion.slice(0, 16)}...
                      </span>
                    </div>
                    {selectedBaseId === ver.id && <Check size={14} className="check-icon" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 卷帘快速定位调节器 */}
        {mode === 'curtain' && (
          <div className="curtain-presets">
            <button
              type="button"
              className="preset-btn"
              onClick={() => setQuickSplit(100)}
              title="只看基准原图 (100% 基准)"
            >
              纯基准
            </button>
            <button
              type="button"
              className={`preset-btn ${splitPercent === 50 ? 'active' : ''}`}
              onClick={() => setQuickSplit(50)}
              title="双向居中对齐 (50% 对比)"
            >
              <RotateCcw size={12} />
              50% 居中
            </button>
            <button
              type="button"
              className="preset-btn"
              onClick={() => setQuickSplit(0)}
              title="只看当前标注 (100% 标注)"
            >
              纯标注
            </button>
          </div>
        )}

        <div className="comparison-meta">
          <span className="meta-badge">
            规格：{naturalSize.width}×{naturalSize.height}
          </span>
          {itemCount > 0 && <span className="meta-badge accent">{itemCount} 处标注</span>}
        </div>
      </div>

      {/* 主视图区域 */}
      <div className="comparison-viewport">
        {mode === 'curtain' ? (
          <div
            className="curtain-container"
            ref={curtainStageRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            style={{
              aspectRatio: `${naturalSize.width} / ${naturalSize.height}`,
            }}
            data-testid="curtain-stage"
          >
            {/* 底层：基准图 (原图/历史版本) */}
            <div className="curtain-layer base-layer">
              <img
                src={basePreview}
                alt={selectedBaseLabel}
                className="curtain-img"
                draggable={false}
              />
              <div className="layer-tag base-tag">基准：{selectedBaseLabel}</div>
            </div>

            {/* 顶层：当前标注修改图（使用 inset clip-path 裁切左侧） */}
            <div
              className="curtain-layer overlay-layer"
              style={{
                clipPath: `inset(0 0 0 ${splitPercent}%)`,
              }}
            >
              <img
                src={sourcePreview}
                alt="当前修改标注"
                className="curtain-img"
                draggable={false}
              />
              {/* Konva 标注画层，缩放适配 */}
              {curtainSize.width > 0 && (
                <div className="curtain-konva-wrap">
                  <Stage
                    width={curtainSize.width}
                    height={curtainSize.height}
                    scaleX={curtainScale}
                    scaleY={curtainScale}
                    listening={false}
                  >
                    <Layer>{renderedItems}</Layer>
                  </Stage>
                </div>
              )}
              <div className="layer-tag overlay-tag">当前编辑</div>
            </div>

            {/* 分割线与拖拽把手 */}
            <div
              className={`curtain-divider ${isDragging ? 'dragging' : ''}`}
              style={{ left: `${splitPercent}%` }}
            >
              <div className="curtain-handle" title="按住左右拖拽对比">
                <span className="handle-arrows">◂ ▸</span>
                <span className="handle-split-num">{splitPercent}%</span>
              </div>
            </div>
          </div>
        ) : (
          /* 并排对比模式 */
          <div className="side-by-side-grid" data-testid="side-by-side-stage">
            {/* 左侧卡片：基准图 */}
            <div className="side-card">
              <div className="side-card-header">
                <span className="card-title">基准：{selectedBaseLabel}</span>
                <span className="card-tag">原图规格</span>
              </div>
              <div
                className="side-card-body"
                style={{
                  aspectRatio: `${naturalSize.width} / ${naturalSize.height}`,
                }}
              >
                <img
                  src={basePreview}
                  alt={selectedBaseLabel}
                  className="side-img"
                  draggable={false}
                />
              </div>
            </div>

            {/* 右侧卡片：当前标注图 */}
            <div className="side-card">
              <div className="side-card-header">
                <span className="card-title">当前修改：待生成子版本</span>
                <span className="card-tag highlight">{itemCount} 处标注</span>
              </div>
              <div
                className="side-card-body"
                ref={sideStageRef}
                style={{
                  aspectRatio: `${naturalSize.width} / ${naturalSize.height}`,
                }}
              >
                <img
                  src={sourcePreview}
                  alt="当前标注修改"
                  className="side-img"
                  draggable={false}
                />
                {sideSize.width > 0 && (
                  <div className="side-konva-wrap">
                    <Stage
                      width={sideSize.width}
                      height={sideSize.height}
                      scaleX={sideScale}
                      scaleY={sideScale}
                      listening={false}
                    >
                      <Layer>{renderedItems}</Layer>
                    </Stage>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
