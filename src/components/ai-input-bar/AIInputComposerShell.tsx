import type { DragEventHandler, ReactNode } from 'react'

interface AIInputComposerShellProps {
  expanded?: boolean
  className?: string
  preview?: ReactNode
  textarea: ReactNode
  leftTools?: ReactNode
  controls?: ReactNode
  sendButton: ReactNode
  onDragEnter?: DragEventHandler<HTMLDivElement>
  onDragOver?: DragEventHandler<HTMLDivElement>
  onDragLeave?: DragEventHandler<HTMLDivElement>
  onDrop?: DragEventHandler<HTMLDivElement>
}

export function AIInputComposerShell({
  expanded = false,
  className = '',
  preview,
  textarea,
  leftTools,
  controls,
  sendButton,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
}: AIInputComposerShellProps) {
  return <div
    className={`ai-input-bar__container ai-input-composer-shell ${expanded ? 'ai-input-composer-shell--expanded' : ''} ${className}`}
    data-testid="ai-input-composer-shell"
    onDragEnter={onDragEnter}
    onDragOver={onDragOver}
    onDragLeave={onDragLeave}
    onDrop={onDrop}
  >
    <div className="ai-input-bar__bottom-bar">
      {leftTools && <div className="ai-input-bar__bottom-start">{leftTools}</div>}
      {controls && <div className="ai-input-bar__bottom-controls">{controls}</div>}
      {sendButton}
    </div>
    <div className="ai-input-bar__input-area">
      {preview && <div className="ai-input-bar__content-preview">{preview}</div>}
      <div className="ai-input-bar__prompt-row">{textarea}</div>
    </div>
  </div>
}
