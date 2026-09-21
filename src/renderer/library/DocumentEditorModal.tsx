import React, { useEffect, useState } from 'react'
import { LoaderCircle, Save, X } from 'lucide-react'
import type { ProjectContextDocument } from '../../shared/contracts/context'
import type { ProjectItemMetadata } from '../../shared/contracts/library'
import { getLibraryApi } from './library-api'

export type DocumentFormat = 'md' | 'txt' | 'json'

export interface DocumentEditorModalProps {
  open: boolean
  document?: ProjectItemMetadata
  initialTitle?: string
  initialContent?: string
  initialFormat?: DocumentFormat
  onClose: () => void
  onSaved: (document: ProjectItemMetadata) => Promise<void> | void
}

function contextApi() {
  return typeof window !== 'undefined' && window.latentStudio?.context ? window.latentStudio.context : null
}

const FORMAT_OPTIONS: Array<{ key: DocumentFormat; label: string; desc: string }> = [
  { key: 'md', label: 'Markdown (.md)', desc: '支持分级标题、列表与表格排版' },
  { key: 'txt', label: '纯文本 (.txt)', desc: '轻量剧本、提示词草稿或灵感便签' },
  { key: 'json', label: 'JSON 数据 (.json)', desc: '结构化设定、分镜参数或配置' },
]

export function DocumentEditorModal({
  open,
  document,
  initialTitle,
  initialContent,
  initialFormat,
  onClose,
  onSaved,
}: DocumentEditorModalProps): React.ReactElement | null {
  const isNew = !document
  const [format, setFormat] = useState<DocumentFormat>(initialFormat ?? 'md')
  const [title, setTitle] = useState(initialTitle ?? '')
  const [content, setContent] = useState(initialContent ?? '')
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (isNew || !document) {
      setTitle(initialTitle ?? '')
      setContent(initialContent ?? '')
      setFormat(initialFormat ?? 'md')
      setError(null)
      setLoading(false)
      return
    }
    const rawExt = (document.extension || '').toLowerCase()
    if (rawExt === '.json') setFormat('json')
    else if (rawExt === '.txt' || rawExt === '.text') setFormat('txt')
    else setFormat('md')

    setTitle(document.name.replace(/\.(md|markdown|txt|text|json)$/i, ''))
    setContent('')
    setError(null)
    setLoading(true)

    const reader = contextApi()
    if (!reader) {
      setLoading(false)
      setError('浏览器预览不支持项目文档编辑')
      return
    }
    void reader
      .readProjectFile({ filePath: document.relativePath })
      .then((value: ProjectContextDocument) => setContent(value.text))
      .catch((cause) => setError(cause instanceof Error ? cause.message : '文档读取失败'))
      .finally(() => setLoading(false))
  }, [document, isNew, open, initialTitle, initialContent, initialFormat])

  if (!open) return null

  const handleFormatChange = (nextFormat: DocumentFormat) => {
    setFormat(nextFormat)
    if (nextFormat === 'json') {
      if (!content.trim()) {
        setContent('{\n  \n}')
      }
    } else if (content === '{\n  \n}') {
      setContent('')
    }
  }

  const save = async () => {
    if (!title.trim() || !content.trim()) return
    setError(null)

    if (format === 'json') {
      try {
        JSON.parse(content)
      } catch (err) {
        setError(`JSON 格式不合法：${(err as Error).message}`)
        return
      }
    }

    setSaving(true)
    try {
      const api = getLibraryApi()
      if (document) {
        const saved = await api.updateProjectDocument({ filePath: document.relativePath, title, content })
        await onSaved(saved)
      } else {
        const saved = await api.saveProjectDocument({ title, content, extension: `.${format}` })
        await onSaved(saved)
      }
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文档保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="library-modal"
      role="dialog"
      aria-modal="true"
      aria-label={isNew ? '新建项目文档' : '编辑项目文档'}
    >
      <div className="library-modal-card document-editor-modal">
        <header>
          <div>
            <h3>{isNew ? (initialContent ? '保存为项目文档' : '新建项目文档') : `编辑 ${document?.name}`}</h3>
            <p>{isNew ? '保存到当前项目的 documents 目录' : document?.relativePath}</p>
          </div>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        {loading ? (
          <div className="start-state">
            <LoaderCircle size={17} className="spin" />
            正在读取文档…
          </div>
        ) : (
          <>
            {isNew && (
              <div style={{ marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--muted)', marginBottom: 6 }}>
                  文档格式
                </span>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {FORMAT_OPTIONS.map((opt) => (
                    <button
                      key={opt.key}
                      type="button"
                      className={`pill-button ${format === opt.key ? 'active' : ''}`}
                      onClick={() => handleFormatChange(opt.key)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid',
                        borderColor: format === opt.key ? 'var(--text)' : 'var(--line)',
                        background: format === opt.key ? 'var(--surface-2)' : 'transparent',
                        color: 'var(--text)',
                        fontWeight: format === opt.key ? 600 : 400,
                        fontSize: 12,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                      }}
                      title={opt.desc}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <label>
              标题
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={180}
                placeholder="请输入文档标题"
                autoFocus={isNew}
              />
            </label>
            <label>
              内容
              <textarea
                value={content}
                onChange={(event) => {
                  setContent(event.target.value)
                  if (error) setError(null)
                }}
                rows={16}
                placeholder={format === 'json' ? '{\n  "key": "value"\n}' : '请输入文档内容…'}
                autoFocus={!isNew}
                style={{ fontFamily: format === 'json' ? 'monospace' : 'inherit' }}
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <footer>
              <button type="button" className="secondary" onClick={onClose} disabled={saving}>
                取消
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void save()}
                disabled={saving || !title.trim() || !content.trim()}
              >
                {saving ? <LoaderCircle size={14} className="spin" /> : <Save size={15} />}
                {saving ? '保存中…' : '保存文档'}
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
