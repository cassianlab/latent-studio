import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, FileText, LoaderCircle, Maximize2, Pencil, Save, WandSparkles, X } from 'lucide-react'
import type { PromptAsset, ProjectItemMetadata } from '../../shared/contracts/library'
import type { ConversationArtifact, ConversationDocumentArtifact, ConversationPromptArtifact } from '../conversation/types'
import { DocumentEditorModal } from '../library/DocumentEditorModal'
import { DocumentViewerModal } from '../library/DocumentViewerModal'
import { getLibraryApi } from '../library/library-api'
import { MarkdownViewer } from '../library/MarkdownViewer'
import './ConversationArtifacts.css'

function documentMetadata(artifact: ConversationDocumentArtifact): ProjectItemMetadata {
  return {
    relativePath: artifact.relativePath,
    name: artifact.name,
    kind: 'document',
    isDirectory: false,
    ...(artifact.extension ? { extension: artifact.extension } : {}),
    ...(artifact.mimeType ? { mimeType: artifact.mimeType } : {}),
    ...(artifact.byteLength !== undefined ? { byteLength: artifact.byteLength } : {}),
    ...(artifact.modifiedAt ? { modifiedAt: artifact.modifiedAt } : {}),
  }
}

function documentArtifact(metadata: ProjectItemMetadata, operation: ConversationDocumentArtifact['operation']): ConversationDocumentArtifact {
  return {
    type: 'document',
    operation,
    relativePath: metadata.relativePath,
    name: metadata.name,
    ...(metadata.extension ? { extension: metadata.extension } : {}),
    ...(metadata.mimeType ? { mimeType: metadata.mimeType } : {}),
    ...(metadata.byteLength !== undefined ? { byteLength: metadata.byteLength } : {}),
    ...(metadata.modifiedAt ? { modifiedAt: metadata.modifiedAt } : {}),
  }
}

function promptArtifact(item: PromptAsset, operation: ConversationPromptArtifact['operation']): ConversationPromptArtifact {
  return {
    type: 'prompt',
    operation,
    id: item.id,
    scope: item.scope,
    name: item.name,
    promptKind: item.kind,
    collection: item.collection,
    category: item.category,
  }
}

function formatFor(extension?: string): 'markdown' | 'json' | 'text' {
  const value = extension?.toLowerCase()
  if (value === '.json') return 'json'
  if (value === '.txt' || value === '.text') return 'text'
  return 'markdown'
}

function PromptEditorModal({ item, onClose, onSaved }: { item: PromptAsset | null; onClose: () => void; onSaved: (item: PromptAsset) => void }): React.ReactElement | null {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [collection, setCollection] = useState('')
  const [category, setCategory] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!item) return
    setName(item.name)
    setContent(item.content)
    setCollection(item.collection)
    setCategory(item.category)
    setError(null)
  }, [item])

  if (!item) return null
  const save = async () => {
    if (!name.trim() || !content.trim() || !collection.trim() || !category.trim()) return
    setSaving(true)
    setError(null)
    try {
      const updated = await getLibraryApi().updatePrompt({ id: item.id, scope: item.scope, name, content, collection, category })
      onSaved(updated)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提示词保存失败')
    } finally {
      setSaving(false)
    }
  }
  return <div className="library-modal" role="dialog" aria-modal="true" aria-label={`编辑提示词 ${item.name}`}>
    <div className="library-modal-card conversation-prompt-editor">
      <header><div><h3>编辑提示词</h3><p>将更新当前提示词，不会新建副本</p></div><button type="button" className="icon-button" aria-label="关闭" onClick={onClose}><X size={17} /></button></header>
      <label>名称<input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} autoFocus /></label>
      <div className="prompt-editor-taxonomy"><label>分组<input value={collection} onChange={(event) => setCollection(event.target.value)} maxLength={120} /></label><label>分类<input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={120} /></label></div>
      <label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={12} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <footer><button type="button" className="secondary" onClick={onClose} disabled={saving}>取消</button><button type="button" className="primary" onClick={() => void save()} disabled={saving || !name.trim() || !content.trim() || !collection.trim() || !category.trim()}>{saving ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />}{saving ? '保存中…' : '保存修改'}</button></footer>
    </div>
  </div>
}

function ArtifactItem({ artifact: initialArtifact, onUpdated }: { artifact: ConversationArtifact; onUpdated: (artifact: ConversationArtifact) => void }): React.ReactElement {
  const [artifact, setArtifact] = useState(initialArtifact)
  const [expanded, setExpanded] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewerOpen, setViewerOpen] = useState(false)
  const [documentEditorOpen, setDocumentEditorOpen] = useState(false)
  const [promptEditor, setPromptEditor] = useState<PromptAsset | null>(null)

  useEffect(() => setArtifact(initialArtifact), [initialArtifact])
  useEffect(() => {
    if (!expanded) {
      setContent(null)
      setError(null)
      setLoading(false)
      return
    }
    let disposed = false
    setLoading(true)
    setError(null)
    const request = artifact.type === 'document'
      ? window.latentStudio?.context?.readProjectFile({ filePath: artifact.relativePath }).then((value) => value.text)
      : getLibraryApi().getPrompt({ id: artifact.id, scope: artifact.scope }).then((value) => {
        if (!value) throw new Error('提示词不存在')
        return value.content
      })
    if (!request) {
      setLoading(false)
      setError('桌面应用中才能读取项目文档')
      return
    }
    void request.then((value) => { if (!disposed) setContent(value) }).catch((cause) => { if (!disposed) setError(cause instanceof Error ? cause.message : '内容读取失败') }).finally(() => { if (!disposed) setLoading(false) })
    return () => { disposed = true }
  }, [artifact, expanded])

  const update = (next: ConversationArtifact) => {
    setArtifact(next)
    setContent(null)
    onUpdated(next)
  }
  const openPromptEditor = async () => {
    if (artifact.type !== 'prompt') return
    setLoading(true)
    setError(null)
    try {
      const item = await getLibraryApi().getPrompt({ id: artifact.id, scope: artifact.scope })
      if (!item) throw new Error('提示词不存在')
      setPromptEditor(item)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提示词读取失败')
    } finally {
      setLoading(false)
    }
  }
  const isDocument = artifact.type === 'document'
  const label = `${artifact.operation === 'created' ? '已创建' : '已更新'}${isDocument ? '文档' : '提示词'}`
  const metadata = isDocument ? documentMetadata(artifact) : null

  return <article className="conversation-artifact">
    <div className="conversation-artifact-heading">
      <span className="conversation-artifact-icon">{isDocument ? <FileText size={16} /> : <WandSparkles size={16} />}</span>
      <div><small>{label}</small><strong title={isDocument ? artifact.relativePath : artifact.id}>{artifact.name}</strong>{isDocument ? <span>{artifact.relativePath}</span> : <span>{artifact.collection ?? '个人'} · {artifact.category ?? '未分类'} · {artifact.scope === 'project' ? '当前项目' : '全局'}</span>}</div>
    </div>
    <div className="conversation-artifact-actions">
      <button type="button" className="secondary small" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}{expanded ? '收起' : isDocument ? '展开阅读' : '展开查看'}</button>
      {isDocument && <button type="button" className="secondary small" onClick={() => setViewerOpen(true)}><Maximize2 size={13} />独立阅读</button>}
      <button type="button" className="secondary small" onClick={() => isDocument ? setDocumentEditorOpen(true) : void openPromptEditor()}><Pencil size={13} />{isDocument ? '编辑文档' : '编辑提示词'}</button>
    </div>
    {expanded && <div className="conversation-artifact-content">{loading ? <div className="start-state"><LoaderCircle size={15} className="spin" />正在读取{isDocument ? '文档' : '提示词'}内容…</div> : error ? <div className="start-state error" role="alert">{error}</div> : isDocument ? <MarkdownViewer content={content || '（此文档暂无内容）'} format={formatFor(artifact.extension)} /> : <pre>{content || '（此提示词暂无内容）'}</pre>}</div>}
    {metadata && <DocumentViewerModal open={viewerOpen} document={metadata} canEdit onClose={() => setViewerOpen(false)} onEdit={() => setDocumentEditorOpen(true)} />}
    {metadata && <DocumentEditorModal open={documentEditorOpen} document={metadata} onClose={() => setDocumentEditorOpen(false)} onSaved={(saved) => update(documentArtifact(saved, 'updated'))} />}
    <PromptEditorModal item={promptEditor} onClose={() => setPromptEditor(null)} onSaved={(saved) => update(promptArtifact(saved, 'updated'))} />
  </article>
}

export function ConversationArtifacts({ artifacts, onArtifactUpdated }: { artifacts: readonly ConversationArtifact[]; onArtifactUpdated: (index: number, artifact: ConversationArtifact) => void }): React.ReactElement | null {
  if (!artifacts.length) return null
  return <section className="conversation-artifacts" aria-label="Agent 成果">
    {artifacts.map((artifact, index) => <ArtifactItem key={`${artifact.type}:${artifact.type === 'document' ? artifact.relativePath : `${artifact.scope}:${artifact.id}`}:${index}`} artifact={artifact} onUpdated={(next) => onArtifactUpdated(index, next)} />)}
  </section>
}
