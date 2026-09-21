import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, LibraryBig, LoaderCircle, Pencil, Plus, Search, Sparkles, Trash2, WandSparkles, X } from 'lucide-react'
import { getLibraryApi } from '../../renderer/library/library-api'
import {
  QUICK_PROMPT_CATEGORIES,
  QUICK_PROMPT_STORAGE_KEY,
  parseLegacyQuickPrompts,
  type QuickPrompt,
  type QuickPromptCategory,
} from '../../shared/quick-prompts'
import type { PromptAsset } from '../../shared/contracts/library'
import { parsePromptTemplate } from '../../shared/prompt-template'
import { HoverTip } from '../../renderer/common/HoverTip'
import { createAsyncActionLock } from './async-action-lock'
import { PromptParameterDialog } from '../prompt-template/PromptParameterDialog'
import './PromptQuickPicker.css'

interface PromptQuickPickerProps {
  open: boolean
  onClose: () => void
  onInsertPrompt: (text: string) => void
  onOpenFullLibrary: () => void
}

type PickerView = 'browse' | 'edit' | 'library'

interface EditorState {
  id?: string
  title: string
  prompt: string
  category: QuickPromptCategory
  description: string
  sourcePromptId?: string
}

const emptyEditor = (category: QuickPromptCategory): EditorState => ({ title: '', prompt: '', category, description: '' })

export function PromptQuickPicker({ open, onClose, onInsertPrompt, onOpenFullLibrary }: PromptQuickPickerProps): React.ReactElement | null {
  const libraryApi = useMemo(() => getLibraryApi(), [])
  const [category, setCategory] = useState<QuickPromptCategory>('style')
  const [items, setItems] = useState<QuickPrompt[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [view, setView] = useState<PickerView>('browse')
  const [editor, setEditor] = useState<EditorState>(() => emptyEditor('style'))
  const [libraryItems, setLibraryItems] = useState<PromptAsset[]>([])
  const [librarySearch, setLibrarySearch] = useState('')
  const [loadingLibrary, setLoadingLibrary] = useState(false)
  const [saving, setSaving] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingTemplate, setPendingTemplate] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const saveLock = useRef(createAsyncActionLock())
  const importLock = useRef(createAsyncActionLock())

  const refresh = async (migrateLegacy = false) => {
    setLoadingItems(true)
    try {
      const legacyItems = migrateLegacy && typeof window !== 'undefined'
        ? parseLegacyQuickPrompts(window.localStorage.getItem(QUICK_PROMPT_STORAGE_KEY))
        : undefined
      setItems(await libraryApi.listQuickPrompts(legacyItems ? { legacyItems } : undefined))
      if (legacyItems) window.localStorage.removeItem(QUICK_PROMPT_STORAGE_KEY)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '快捷灵感读取失败')
    } finally {
      setLoadingItems(false)
    }
  }

  useEffect(() => {
    if (!open) return
    void refresh(true)
    setView('browse')
    setError(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (view === 'browse') onClose()
      else { setView('browse'); setError(null) }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open, view])

  if (!open) return null

  const showToast = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(null), 1600)
  }

  const beginCreate = () => {
    setEditor(emptyEditor(category))
    setError(null)
    setView('edit')
  }

  const beginEdit = (item: QuickPrompt) => {
    setEditor({ id: item.id, title: item.title, prompt: item.prompt, category: item.category, description: item.description ?? '', sourcePromptId: item.sourcePromptId })
    setError(null)
    setView('edit')
  }

  const saveEditor = async () => {
    await saveLock.current.run(async () => {
      setSaving(true)
      setError(null)
      try {
        const saved = await libraryApi.saveQuickPrompt(editor)
        setCategory(saved.category)
        await refresh()
        setView('browse')
        showToast(editor.id ? '已保存修改' : '已添加快捷灵感')
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '快捷提示词保存失败')
      } finally {
        setSaving(false)
      }
    })
  }

  const remove = async (item: QuickPrompt) => {
    if (!window.confirm(`确认删除「${item.title}」？`)) return
    try {
      await libraryApi.removeQuickPrompt({ id: item.id })
      await refresh()
      showToast('已删除')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '快捷灵感删除失败')
    }
  }

  const openLibrary = async () => {
    setView('library')
    setLibrarySearch('')
    setLoadingLibrary(true)
    setError(null)
    try {
      const [project, global] = await Promise.all([
        libraryApi.listPrompts({ scope: 'project' }),
        libraryApi.listPromptPage({ scope: 'global', limit: 80 }),
      ])
      setLibraryItems([...project, ...global.items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提示词库读取失败')
    } finally {
      setLoadingLibrary(false)
    }
  }

  const visibleLibraryItems = libraryItems.filter((item) => {
    const query = librarySearch.trim().toLocaleLowerCase()
    return !query || `${item.name}\n${item.content}\n${item.collection}\n${item.category}`.toLocaleLowerCase().includes(query)
  }).slice(0, 80)

  const importPrompt = async (item: PromptAsset) => {
    await importLock.current.run(async () => {
      const importId = `${item.scope}:${item.id}`
      setImportingId(importId)
      setError(null)
      try {
        const existing = items.find((value) => value.sourcePromptId === importId)
        const saved = await libraryApi.saveQuickPrompt({ ...(existing ? { ...existing, id: existing.id } : {}), title: item.name, prompt: item.content, category: existing?.category ?? category, sourcePromptId: importId })
        await refresh()
        setCategory(saved.category)
        setView('browse')
        showToast(`已添加「${item.name}」`)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '提示词添加失败')
      } finally {
        setImportingId(null)
      }
    })
  }

  const activeItems = items.filter((item) => item.category === category)
  const choosePrompt = (item: QuickPrompt) => {
    if (parsePromptTemplate(item.prompt).length) {
      setPendingTemplate(item.prompt)
      showToast(`已选择「${item.title}」`)
      return
    }
    onInsertPrompt(item.prompt)
    showToast(`已应用「${item.title}」`)
  }

  return (
    <div className="prompt-quick-picker" ref={containerRef} role="dialog" aria-label="快捷灵感" aria-busy={loadingItems || loadingLibrary || saving || importingId !== null}>
      <header className="prompt-picker-header">
        <div className="prompt-picker-title">
          {view !== 'browse' && <HoverTip label="返回"><button type="button" className="icon-btn-micro" onClick={() => { setView('browse'); setError(null) }} aria-label="返回快捷灵感"><ArrowLeft size={14} /></button></HoverTip>}
          <Sparkles size={14} aria-hidden="true" />
          <span>{view === 'edit' ? (editor.id ? '编辑快捷灵感' : '新建快捷灵感') : view === 'library' ? '从提示词库添加' : '快捷灵感'}</span>
        </div>
        <HoverTip label="关闭"><button type="button" className="icon-btn-micro" onClick={onClose} aria-label="关闭快捷灵感"><X size={14} /></button></HoverTip>
      </header>

      {view === 'browse' && <>
        <div className="prompt-picker-tabs" role="tablist" aria-label="快捷灵感分类">
          {QUICK_PROMPT_CATEGORIES.map((item) => <button key={item.id} type="button" role="tab" aria-selected={category === item.id} className={`prompt-picker-tab ${category === item.id ? 'active' : ''}`} onClick={() => setCategory(item.id)}>{item.label}</button>)}
        </div>
        <div className="prompt-picker-body">
          <div className="quick-prompt-toolbar">
            <span>{activeItems.length} 条</span>
            <div>
              <button type="button" onClick={beginCreate}><Plus size={13} />新建</button>
              <button type="button" onClick={() => void openLibrary()}><LibraryBig size={13} />从提示词库添加</button>
            </div>
          </div>
          {loadingItems ? <div className="quick-prompt-empty">正在读取快捷灵感…</div> : activeItems.length ? <div className="quick-prompt-grid">
            {activeItems.map((item) => <article className="quick-prompt-item" key={item.id}>
              <button type="button" className="quick-prompt-apply" onClick={() => choosePrompt(item)}>
                <strong>{item.title}</strong>
                <span>{item.description || item.prompt}</span>
              </button>
              <div className="quick-prompt-actions">
                <HoverTip label="编辑"><button type="button" onClick={() => beginEdit(item)} aria-label={`编辑 ${item.title}`}><Pencil size={12} /></button></HoverTip>
                <HoverTip label="删除"><button type="button" onClick={() => void remove(item)} aria-label={`删除 ${item.title}`}><Trash2 size={12} /></button></HoverTip>
              </div>
            </article>)}
          </div> : <div className="quick-prompt-empty"><span>这个分类还没有快捷灵感</span><button type="button" onClick={beginCreate}><Plus size={13} />新建一条</button></div>}
        </div>
      </>}

      {view === 'edit' && <div className="quick-prompt-editor">
        <label><span>名称</span><input autoFocus value={editor.title} onChange={(event) => setEditor((current) => ({ ...current, title: event.target.value }))} maxLength={80} /></label>
        <label><span>分类</span><select value={editor.category} onChange={(event) => setEditor((current) => ({ ...current, category: event.target.value as QuickPromptCategory }))}>{QUICK_PROMPT_CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></label>
        <label><span>简短说明 <small>可选</small></span><input value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))} maxLength={160} /></label>
        <label><span>提示词</span><textarea value={editor.prompt} onChange={(event) => setEditor((current) => ({ ...current, prompt: event.target.value }))} rows={7} /></label>
        {error && <p className="quick-prompt-error" role="alert">{error}</p>}
        <div className="quick-prompt-editor-actions"><button type="button" onClick={() => setView('browse')} disabled={saving}>取消</button><button type="button" className="primary" onClick={() => void saveEditor()} disabled={saving || !editor.title.trim() || !editor.prompt.trim()}>{saving ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{saving ? '保存中…' : '保存'}</button></div>
      </div>}

      {view === 'library' && <div className="quick-prompt-library">
        <div className="quick-prompt-library-controls">
          <label className="quick-prompt-search"><Search size={13} aria-hidden="true" /><input autoFocus value={librarySearch} onChange={(event) => setLibrarySearch(event.target.value)} placeholder="搜索提示词库" aria-label="搜索提示词库" /></label>
          <select value={category} onChange={(event) => setCategory(event.target.value as QuickPromptCategory)} aria-label="添加到分类">{QUICK_PROMPT_CATEGORIES.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
        </div>
        {error && <p className="quick-prompt-error" role="alert">{error}</p>}
        <div className="quick-prompt-library-list">
          {loadingLibrary ? <div className="quick-prompt-empty">正在读取提示词库…</div> : visibleLibraryItems.length ? visibleLibraryItems.map((item) => <button type="button" key={`${item.scope}:${item.id}`} onClick={() => void importPrompt(item)} disabled={importingId !== null}>
            <span><strong>{item.name}</strong><small>{item.collection} · {item.category}</small></span>
            {importingId === `${item.scope}:${item.id}` ? <LoaderCircle size={14} className="spin" aria-label={`正在添加 ${item.name}`} /> : <Plus size={14} aria-hidden="true" />}
          </button>) : <div className="quick-prompt-empty">没有找到可添加的提示词</div>}
        </div>
      </div>}

      <PromptParameterDialog open={pendingTemplate !== null} template={pendingTemplate ?? ''} onCancel={() => setPendingTemplate(null)} onApply={(prompt) => { setPendingTemplate(null); onInsertPrompt(prompt) }} />
      <footer className="prompt-picker-footer">
        {toast ? <span className="prompt-picker-toast"><Check size={12} />{toast}</span> : <span className="section-hint">{view === 'browse' ? '点击内容即可追加' : '修改保存到本机数据库'}</span>}
        {view === 'browse' && <button type="button" className="prompt-picker-library-btn" onClick={() => { onClose(); onOpenFullLibrary() }}><WandSparkles size={12} /><span>打开完整提示词库</span></button>}
      </footer>
    </div>
  )
}
