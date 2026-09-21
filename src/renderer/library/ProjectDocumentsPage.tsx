import React, { useEffect, useMemo, useState } from 'react'
import {
  Eye,
  FileText,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import type { ProjectContextDocument } from '../../shared/contracts/context'
import type { ProjectItemMetadata } from '../../shared/contracts/library'
import { getLibraryApi } from './library-api'
import { DocumentViewerModal } from './DocumentViewerModal'
import { DocumentEditorModal } from './DocumentEditorModal'
import { DeleteDocumentDialog } from './DeleteDocumentDialog'
import { HoverTip } from '../common/HoverTip'
import './ProjectDocumentsPage.css'

const EDITABLE_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.text', '.json'])
const DOCUMENT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.text', '.json', '.pdf', '.doc', '.docx',
])

type DocumentCategoryFilter = 'all' | 'markdown' | 'text' | 'data' | 'other'

function contextApi() {
  return typeof window !== 'undefined' && window.latentStudio?.context ? window.latentStudio.context : null
}

function formatBytes(bytes?: number): string {
  if (!bytes) return '未知大小'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function matchesFilter(item: ProjectItemMetadata, filter: DocumentCategoryFilter): boolean {
  const ext = item.extension?.toLowerCase() ?? ''
  if (filter === 'markdown') return ext === '.md' || ext === '.markdown'
  if (filter === 'text') return ext === '.txt' || ext === '.text'
  if (filter === 'data') return ext === '.json'
  if (filter === 'other') return ['.pdf', '.doc', '.docx'].includes(ext)
  return true
}

export function ProjectDocumentsPage(): React.ReactElement {
  const api = useMemo(() => getLibraryApi(), [])
  const [items, setItems] = useState<ProjectItemMetadata[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<DocumentCategoryFilter>('all')

  const [editor, setEditor] = useState<{ open: boolean; document?: ProjectItemMetadata }>({
    open: false,
  })
  const [viewer, setViewer] = useState<{ open: boolean; document: ProjectItemMetadata | null }>({
    open: false,
    document: null,
  })
  const [deleteTarget, setDeleteTarget] = useState<ProjectItemMetadata | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setItems(await api.listProjectItems({ recursive: true, maxEntries: 300 }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '项目文件读取失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const documents = useMemo(() => {
    return items.filter(
      (item) =>
        !item.isDirectory &&
        DOCUMENT_EXTENSIONS.has(item.extension?.toLowerCase() ?? ''),
    )
  }, [items])

  const filteredDocuments = useMemo(() => {
    const query = search.trim().toLowerCase()
    return documents.filter((item) => {
      if (!matchesFilter(item, filter)) return false
      if (query) {
        const nameMatch = item.name.toLowerCase().includes(query)
        const pathMatch = item.relativePath.toLowerCase().includes(query)
        if (!nameMatch && !pathMatch) return false
      }
      return true
    })
  }, [documents, filter, search])

  const canEdit = (item: ProjectItemMetadata) =>
    EDITABLE_EXTENSIONS.has(item.extension?.toLowerCase() ?? '')

  const handleReveal = (item: ProjectItemMetadata) => {
    void api.revealAsset({ relativePath: item.relativePath })
  }

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return
    setDeleteBusy(true)
    try {
      await api.deleteProjectDocument({ filePath: deleteTarget.relativePath })
      setDeleteTarget(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除文档失败')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="content-page">
      <div className="section-heading">
        <div>
          <h2>项目文档</h2>
          <p>管理当前项目文件夹中的剧本、设定大纲与参考资料</p>
        </div>
        <div className="asset-header-actions">
          <button
            type="button"
            className="secondary small"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={15} />
            刷新
          </button>
          <button
            type="button"
            className="primary small"
            onClick={() => setEditor({ open: true })}
          >
            <Plus size={15} />
            新建文档
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="documents-toolbar">
        <div className="documents-filter-tabs">
          <button
            type="button"
            className={`documents-filter-tab ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            全部 ({documents.length})
          </button>
          <button
            type="button"
            className={`documents-filter-tab ${filter === 'markdown' ? 'active' : ''}`}
            onClick={() => setFilter('markdown')}
          >
            Markdown
          </button>
          <button
            type="button"
            className={`documents-filter-tab ${filter === 'text' ? 'active' : ''}`}
            onClick={() => setFilter('text')}
          >
            纯文本
          </button>
          <button
            type="button"
            className={`documents-filter-tab ${filter === 'data' ? 'active' : ''}`}
            onClick={() => setFilter('data')}
          >
            JSON
          </button>
          <button
            type="button"
            className={`documents-filter-tab ${filter === 'other' ? 'active' : ''}`}
            onClick={() => setFilter('other')}
          >
            其他格式
          </button>
        </div>

        <div className="documents-search-wrap">
          <Search size={14} className="documents-search-icon" />
          <input
            className="documents-search-input"
            type="text"
            placeholder="搜索文档名称或路径…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className="documents-search-clear"
              onClick={() => setSearch('')}
              aria-label="清空搜索"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Content Area */}
      {loading ? (
        <div className="start-state">
          <LoaderCircle size={17} className="spin" />
          正在读取项目文件…
        </div>
      ) : error ? (
        <div className="start-state error" role="alert">
          <span>{error}</span>
          <button className="icon-button" aria-label="重试" onClick={() => void load()}>
            <RefreshCw size={16} />
          </button>
        </div>
      ) : filteredDocuments.length ? (
        <div className="documents-table" aria-live="polite">
          <div className="documents-header">
            <span>格式</span>
            <span>文档名称与路径</span>
            <span>类型</span>
            <span>修改时间</span>
            <span className="documents-th-actions">操作</span>
          </div>
          {filteredDocuments.map((item) => (
            <div key={item.relativePath} className="documents-row">
              <span className="documents-cell-icon">
                <FileText size={15} />
              </span>
              <span
                className="documents-cell-name"
                onClick={() => setViewer({ open: true, document: item })}
                title="点击查看文档"
              >
                <strong>{item.name}</strong>
                <small>
                  {item.relativePath} · {formatBytes(item.byteLength)}
                </small>
              </span>
              <span className="documents-cell-type">
                <span className="pill">
                  {item.extension?.toUpperCase().slice(1) ?? '文件'}
                </span>
              </span>
              <time className="documents-cell-date">
                {item.modifiedAt ? new Date(item.modifiedAt).toLocaleDateString('zh-CN') : '-'}
              </time>
              <div className="documents-cell-actions">
                <HoverTip label="查看文档内容">
                  <button
                    type="button"
                    className="document-action-btn"
                    aria-label={`查看 ${item.name}`}
                    onClick={() => setViewer({ open: true, document: item })}
                  >
                    <Eye size={14} />
                  </button>
                </HoverTip>
                {canEdit(item) && (
                  <HoverTip label="编辑文档">
                    <button
                      type="button"
                      className="document-action-btn"
                      aria-label={`编辑 ${item.name}`}
                      onClick={() => setEditor({ open: true, document: item })}
                    >
                      <Pencil size={14} />
                    </button>
                  </HoverTip>
                )}
                <HoverTip label="在访达中显示">
                  <button
                    type="button"
                    className="document-action-btn"
                    aria-label={`在访达中显示 ${item.name}`}
                    onClick={() => handleReveal(item)}
                  >
                    <FolderOpen size={14} />
                  </button>
                </HoverTip>
                <HoverTip label="删除文档">
                  <button
                    type="button"
                    className="document-action-btn danger"
                    aria-label={`删除 ${item.name}`}
                    onClick={() => setDeleteTarget(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                </HoverTip>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="start-state">
          {search ? '没有找到符合搜索条件的文档。' : '当前项目还没有可识别的文档文件。'}
        </div>
      )}

      {/* Editor Modal */}
      <DocumentEditorModal
        open={editor.open}
        document={editor.document}
        onClose={() => setEditor({ open: false })}
        onSaved={load}
      />

      {/* Viewer Modal */}
      <DocumentViewerModal
        open={viewer.open}
        document={viewer.document}
        canEdit={viewer.document ? canEdit(viewer.document) : false}
        onClose={() => setViewer({ open: false, document: null })}
        onEdit={(doc) => setEditor({ open: true, document: doc })}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteDocumentDialog
        open={Boolean(deleteTarget)}
        document={deleteTarget}
        busy={deleteBusy}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
      />
    </div>
  )
}
