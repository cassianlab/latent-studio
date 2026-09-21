import React, { useEffect, useMemo, useState } from 'react'
import { BookOpen, Check, Code, Copy, ExternalLink, FileText, LoaderCircle, Pencil, X } from 'lucide-react'
import type { ProjectContextDocument } from '../../shared/contracts/context'
import type { ProjectItemMetadata } from '../../shared/contracts/library'
import { getLibraryApi } from './library-api'
import { MarkdownViewer } from './MarkdownViewer'
import './DocumentViewerModal.css'

export interface DocumentViewerModalProps {
  open: boolean
  document: ProjectItemMetadata | null
  canEdit?: boolean
  onClose: () => void
  onEdit?: (doc: ProjectItemMetadata) => void
}

function contextApi() {
  return typeof window !== 'undefined' && window.latentStudio?.context ? window.latentStudio.context : null
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function DocumentViewerModal({
  open,
  document,
  canEdit = false,
  onClose,
  onEdit,
}: DocumentViewerModalProps): React.ReactElement | null {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered')

  const format = useMemo<'markdown' | 'json' | 'text'>(() => {
    const ext = (document?.extension || '').toLowerCase()
    if (ext === '.json') return 'json'
    if (ext === '.txt' || ext === '.text') return 'text'
    return 'markdown'
  }, [document?.extension])

  useEffect(() => {
    if (!open || !document) {
      setContent('')
      setLoading(false)
      setError(null)
      return
    }

    setLoading(true)
    setError(null)
    const reader = contextApi()
    if (!reader) {
      setLoading(false)
      setContent('# 示例预览文档\n\n当前处于浏览器开发环境，真实文档内容将在 macOS 桌面客户端中完整呈现。')
      return
    }

    void reader.readProjectFile({ filePath: document.relativePath })
      .then((res: ProjectContextDocument) => {
        setContent(res.text ?? '')
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : '无法读取文档内容')
      })
      .finally(() => {
        setLoading(false)
      })
  }, [open, document])

  const stats = useMemo(() => {
    const chars = content.length
    const lines = content ? content.split('\n').length : 0
    return { chars, lines }
  }, [content])

  if (!open || !document) return null

  const handleCopy = () => {
    void navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleReveal = () => {
    const api = getLibraryApi()
    void api.revealAsset({ relativePath: document.relativePath })
  }

  return (
    <div className="library-modal" role="dialog" aria-modal="true" aria-label={`查看文档 ${document.name}`}>
      <div className="library-modal-card document-viewer-card">
        {/* Header */}
        <header className="document-viewer-header">
          <div className="document-viewer-title-group">
            <div className="document-viewer-icon">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="document-viewer-title">{document.name}</h3>
              <p className="document-viewer-subtitle">
                {document.relativePath} · {formatBytes(document.byteLength)} ·{' '}
                {document.modifiedAt ? new Date(document.modifiedAt).toLocaleString('zh-CN') : ''}
              </p>
            </div>
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>

        {/* Toolbar */}
        <div className="document-viewer-toolbar">
          <div className="document-viewer-toolbar-left">
            <span className="document-viewer-stats">
              {stats.chars} 字符 · {stats.lines} 行
            </span>
            {format !== 'text' && (
              <div className="document-viewer-mode-switch">
                <button
                  type="button"
                  className={`mode-btn ${viewMode === 'rendered' ? 'active' : ''}`}
                  onClick={() => setViewMode('rendered')}
                  aria-pressed={viewMode === 'rendered'}
                >
                  <BookOpen size={12} />
                  <span>阅读视图</span>
                </button>
                <button
                  type="button"
                  className={`mode-btn ${viewMode === 'raw' ? 'active' : ''}`}
                  onClick={() => setViewMode('raw')}
                  aria-pressed={viewMode === 'raw'}
                >
                  <Code size={12} />
                  <span>源码</span>
                </button>
              </div>
            )}
          </div>
          <div className="document-viewer-toolbar-actions">
            <button
              type="button"
              className="secondary small"
              onClick={handleReveal}
              title="在访达中定位该文档"
            >
              <ExternalLink size={13} />
              <span>在访达中显示</span>
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={handleCopy}
              disabled={loading || !content}
              title="复制全部文档文本"
            >
              {copied ? <Check size={13} style={{ color: 'var(--green, #22c55e)' }} /> : <Copy size={13} />}
              <span>{copied ? '已复制' : '复制全文'}</span>
            </button>
            {canEdit && onEdit && (
              <button
                type="button"
                className="primary small"
                onClick={() => {
                  onClose()
                  onEdit(document)
                }}
              >
                <Pencil size={13} />
                <span>编辑文档</span>
              </button>
            )}
          </div>
        </div>

        {/* Content Viewport */}
        <div className="document-viewer-body">
          {loading ? (
            <div className="start-state">
              <LoaderCircle size={18} className="spin" />
              <span>正在读取文档内容…</span>
            </div>
          ) : error ? (
            <div className="start-state error" role="alert">
              <span>{error}</span>
            </div>
          ) : viewMode === 'rendered' && format !== 'text' ? (
            <div className="document-viewer-rendered">
              <MarkdownViewer content={content || '（此文档暂无内容）'} format={format} />
            </div>
          ) : (
            <pre className="document-viewer-text">{content || '（此文档暂无内容）'}</pre>
          )}
        </div>

        {/* Footer */}
        <footer className="document-viewer-footer">
          <button type="button" className="secondary" onClick={onClose}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
