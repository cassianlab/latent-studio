import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import {
  ArrowUpRight,
  Crop,
  Eraser,
  MousePointer2,
  PenLine,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react'
import type { AnnotationTool } from './editor-model'

function HoverTip({
  label,
  children,
  side = 'right',
}: {
  label: string
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
}) {
  return (
    <Tooltip.Root delayDuration={150}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          className="tooltip"
          side={side}
          sideOffset={10}
          collisionPadding={12}
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

function IconButton({
  label,
  children,
  onClick,
  active = false,
  pressed,
  className = '',
  disabled = false,
}: {
  label: string
  children: React.ReactNode
  onClick?: () => void
  active?: boolean
  pressed?: boolean
  className?: string
  disabled?: boolean
}) {
  return (
    <HoverTip label={label}>
      <button
        type="button"
        className={`icon-button ${className} ${active ? 'active' : ''}`}
        onClick={onClick}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
      >
        {children}
      </button>
    </HoverTip>
  )
}

export interface EditorToolbarProps {
  tool: AnnotationTool
  onSelectTool: (tool: AnnotationTool) => void
  canUndo: boolean
  canRedo: boolean
  hasItems: boolean
  hasCrop: boolean
  onUndo: () => void
  onRedo: () => void
  onClear: () => void
  onClearCrop: () => void
}

export function EditorToolbar({
  tool,
  onSelectTool,
  canUndo,
  canRedo,
  hasItems,
  hasCrop,
  onUndo,
  onRedo,
  onClear,
  onClearCrop,
}: EditorToolbarProps): React.ReactElement {
  return (
    <Tooltip.Provider delayDuration={150}>
      <aside className="editor-toolbar" role="toolbar" aria-label="图片标注工具">
        <IconButton label="拖拽画布 (V)" active={tool === 'select'} pressed={tool === 'select'} onClick={() => onSelectTool('select')}>
          <MousePointer2 size={18} />
        </IconButton>
        <IconButton label="画笔标注 (P)" active={tool === 'pen'} pressed={tool === 'pen'} onClick={() => onSelectTool('pen')}>
          <PenLine size={18} />
        </IconButton>
        <IconButton label="矩形标注 (R)" active={tool === 'rect'} pressed={tool === 'rect'} onClick={() => onSelectTool('rect')}>
          <Square size={18} />
        </IconButton>
        <IconButton label="箭头指示 (A)" active={tool === 'arrow'} pressed={tool === 'arrow'} onClick={() => onSelectTool('arrow')}>
          <ArrowUpRight size={18} />
        </IconButton>
        <IconButton label="文字说明 (T)" active={tool === 'text'} pressed={tool === 'text'} onClick={() => onSelectTool('text')}>
          <Type size={18} />
        </IconButton>
        <IconButton label="裁剪区域 (C)" active={tool === 'crop'} pressed={tool === 'crop'} onClick={() => onSelectTool('crop')}>
          <Crop size={18} />
        </IconButton>

        <div className="editor-toolbar-separator" />

        <IconButton
          label="擦除标注 (E)"
          className="object-eraser-btn"
          active={tool === 'object-eraser'}
          pressed={tool === 'object-eraser'}
          onClick={() => onSelectTool('object-eraser')}
        >
          <Eraser size={18} />
        </IconButton>
        {hasCrop && <IconButton label="取消裁剪" onClick={onClearCrop}><X size={18} /></IconButton>}

        <div className="editor-toolbar-separator" />

        <IconButton label="撤销 (⌘Z)" onClick={onUndo} disabled={!canUndo}>
          <Undo2 size={18} />
        </IconButton>
        <IconButton label="重做 (⇧⌘Z)" onClick={onRedo} disabled={!canRedo}>
          <Redo2 size={18} />
        </IconButton>
        <IconButton label="清空全部标注" onClick={onClear} disabled={!hasItems}>
          <Trash2 size={18} />
        </IconButton>
      </aside>
    </Tooltip.Provider>
  )
}
