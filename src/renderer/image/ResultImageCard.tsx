import { useEffect, useRef, useState, type ReactElement } from 'react'
import {
  Check,
  Edit3,
  FolderOpen,
  LayoutGrid,
  LoaderCircle,
  MoreHorizontal,
  PenLine,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import type { ImageEditorLaunch } from '../../shared/contracts/editor'
import type { ImageRequest, ImageResult, ImageTaskRecord } from '../../shared/contracts/images'
import type { ProjectAsset } from '../../shared/contracts/library'
import { dispatchCanvasContent } from '../../components/canvas/canvas-content-bridge'
import { DeleteAssetDialog } from '../library/DeleteAssetDialog'
import './ResultImageCard.css'

export interface ResultCardItem {
  id: string
  title: string
  status: ImageTaskRecord['status']
  task?: ImageTaskRecord
}

export interface ResultImageCardProps {
  item: ResultCardItem
  lastPrompt?: string
  onRename: (id: string, newTitle: string) => void
  onCanvas?: () => void
  onEditor?: (launch: ImageEditorLaunch) => void
  onSavePrompt?: (prompt: string) => void
  onRevealOutput?: (taskId: string, localPath: string) => void
  onDelete?: (taskId: string, localPath?: string) => void | Promise<void>
}

function imageSource(task?: ImageTaskRecord): string | undefined {
  const result = task?.result?.images[0]
  if (!result) return undefined
  if (result.localPath) return encodeURI(`file://${result.localPath}`)
  if (result.b64Json) return `data:${result.mimeType ?? 'image/png'};base64,${result.b64Json}`
  return result.url
}

function statusLabel(status: ImageTaskRecord['status']): string {
  switch (status) {
    case 'completed': return '完成'
    case 'running': return '正在生成'
    case 'pending': return '排队中'
    case 'cancelled': return '已取消'
    default: return '失败'
  }
}

export function formatResultCardStatus(task: ImageTaskRecord): string {
  if (task.error && task.attempts > 0 && task.maxRetries > 0) {
    const totalAttempts = task.maxRetries + 1
    if (task.status === 'pending' && task.attempts <= task.maxRetries) return `自动重试 ${Math.min(task.attempts + 1, totalAttempts)}/${totalAttempts}`
    if (task.status === 'running' && task.attempts > 1) return `正在重试 ${Math.min(task.attempts, totalAttempts)}/${totalAttempts}`
  }
  return statusLabel(task.status)
}

export function formatResultCardSpec({
  request,
  result,
}: {
  request?: ImageRequest
  result?: ImageResult
}): string | undefined {
  const dimensions = result?.width && result.height
    ? `${result.width}x${result.height}`
    : request?.outputSize ?? request?.size
  const parts = [
    dimensions,
    request?.outputFormat?.toUpperCase(),
    request?.quality && request.quality !== 'auto' ? request.quality : undefined,
    request?.background === 'transparent' ? '透明背景' : undefined,
  ].filter((part): part is string => Boolean(part))
  return parts.length > 0 ? parts.join(' · ') : undefined
}

export function ResultImageCard({
  item,
  lastPrompt,
  onRename,
  onCanvas,
  onEditor,
  onSavePrompt,
  onRevealOutput,
  onDelete,
}: ResultImageCardProps): ReactElement {
  const cardRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editingTitle, setEditingTitle] = useState(item.title)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  const result = item.task?.result?.images[0]
  const source = item.task ? imageSource(item.task) : undefined
  const actualPrompt = item.task?.request.prompt || lastPrompt

  const launch: ImageEditorLaunch = {
    title: item.title,
    ...(source ? { preview: source } : {}),
    ...(result?.localPath ? { source: { type: 'file' as const, path: result.localPath, filename: item.title, mimeType: result.mimeType } } : {}),
    ...(result?.width ? { width: result.width } : {}),
    ...(result?.height ? { height: result.height } : {}),
  }

  // Close dropdown on outside click or Escape
  useEffect(() => {
    if (!menuOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const handleStartRename = () => {
    setEditingTitle(item.title)
    setIsEditing(true)
  }

  const handleSaveRename = () => {
    const trimmed = editingTitle.trim()
    if (trimmed && trimmed !== item.title) {
      onRename(item.id, trimmed)
    }
    setIsEditing(false)
  }

  const targetAsset: ProjectAsset = {
    id: item.id,
    name: item.title,
    relativePath: result?.localPath ? `outputs/${result.localPath.split('/').at(-1)}` : `outputs/${item.id}.png`,
    sourceName: item.title,
    category: 'output',
    origin: 'generated',
    byteLength: result?.byteLength ?? 0,
    modifiedAt: '',
    importedAt: '',
    previewable: true,
  }

  const handleConfirmDelete = async () => {
    setDeleteBusy(true)
    try {
      await onDelete?.(item.id, result?.localPath)
      setConfirmDelete(false)
    } catch {
      setToastMsg('删除图片失败')
      setTimeout(() => setToastMsg(null), 2500)
    } finally {
      setDeleteBusy(false)
    }
  }

  const handleAddToCanvas = () => {
    if (!source) return
    dispatchCanvasContent({
      id: `result-${item.id}`,
      title: item.title,
      source,
      mimeType: result?.mimeType || 'image/png',
    })
    onCanvas?.()
    setMenuOpen(false)
  }

  const handleRevealInFinder = () => {
    if (result?.localPath) {
      onRevealOutput?.(item.id, result.localPath)
    }
    setMenuOpen(false)
  }

  const handleSavePrompt = () => {
    if (actualPrompt) {
      onSavePrompt?.(actualPrompt)
    }
    setMenuOpen(false)
  }

  const handleOpenEditor = () => {
    onEditor?.(launch)
    setMenuOpen(false)
  }

  const finalSpec = formatResultCardSpec({ request: item.task?.request, result })
  const actualDimension = result?.width && result.height
    ? `${result.width}x${result.height}`
    : '尺寸未知'

  return (
    <article className={`result-card ${menuOpen ? 'menu-open' : ''}`} ref={cardRef}>
      <button
        className="result-card-preview"
        onClick={() => onEditor?.(launch)}
        type="button"
        title="点击进入全屏查看与标注"
        aria-label={`查看并标注 ${item.title}`}
      >
        {source ? (
          <img src={source} alt={item.title} />
        ) : (
          <div className="image-placeholder">
            <LoaderCircle size={18} className="spin" />
          </div>
        )}
        <span className="result-card-status">{item.task ? formatResultCardStatus(item.task) : statusLabel(item.status)}</span>
      </button>

      {/* Floating Action Badge Button (···) */}
      <button
        type="button"
        className={`result-card-badge-btn ${menuOpen ? 'menu-open' : ''}`}
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen(!menuOpen)
        }}
        title="更多操作"
        aria-label="更多操作"
      >
        <MoreHorizontal size={15} />
      </button>

      {/* Dropdown Action Menu */}
      {menuOpen && (
        <div className="result-card-dropdown" ref={menuRef} onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={`result-dropdown-item ${!source ? 'disabled' : ''}`}
            onClick={handleAddToCanvas}
            disabled={!source}
          >
            <LayoutGrid size={14} />
            <span>放到画布</span>
          </button>

          {result?.localPath && (
            <button
              type="button"
              className="result-dropdown-item"
              onClick={handleRevealInFinder}
            >
              <FolderOpen size={14} />
              <span>在访达中定位</span>
            </button>
          )}

          {actualPrompt && (
            <button
              type="button"
              className="result-dropdown-item"
              onClick={handleSavePrompt}
            >
              <WandSparkles size={14} />
              <span>保存提示词</span>
            </button>
          )}

          <button
            type="button"
            className="result-dropdown-item"
            onClick={handleOpenEditor}
          >
            <PenLine size={14} />
            <span>标注修改</span>
          </button>

          <button
            type="button"
            className="result-dropdown-item"
            onClick={() => {
              setMenuOpen(false)
              handleStartRename()
            }}
          >
            <Edit3 size={14} />
            <span>重命名备注</span>
          </button>

          <div className="result-dropdown-divider" />

          <button
            type="button"
            className="result-dropdown-item danger"
            onClick={() => {
              setMenuOpen(false)
              setConfirmDelete(true)
            }}
            title="删除此生成图片及本地原文件"
          >
            <Trash2 size={14} />
            <span>删除生成图片</span>
          </button>
        </div>
      )}

      {/* Toast Notification */}
      {toastMsg && (
        <div className="result-card-toast">
          <Check size={12} />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Card Note Footer - Minimal and Pure */}
      <div className="result-card-footer">
        {isEditing ? (
          <input
            type="text"
            className="result-card-note-input"
            value={editingTitle}
            autoFocus
            onChange={(e) => setEditingTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveRename()
              else if (e.key === 'Escape') setIsEditing(false)
            }}
            onBlur={handleSaveRename}
            onClick={(e) => e.stopPropagation()}
            aria-label="编辑备注"
          />
        ) : (
          <div className="result-card-footer-content">
            <span
              className="result-card-note"
              onDoubleClick={handleStartRename}
              title="双击快速修改备注"
            >
              {item.title}
            </span>
            {finalSpec && (
              <div
                className="result-card-specs"
                title={`导出目标: ${item.task?.request.outputSize ?? item.task?.request.size ?? '默认'} | 模型请求: ${item.task?.request.size ?? '默认'} | 实际尺寸: ${actualDimension}`}
              >
                <span>{finalSpec}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <DeleteAssetDialog
        open={confirmDelete}
        target={targetAsset}
        previewUrl={source}
        busy={deleteBusy}
        onConfirm={handleConfirmDelete}
        onClose={() => {
          if (!deleteBusy) setConfirmDelete(false)
        }}
      />
    </article>
  )
}
