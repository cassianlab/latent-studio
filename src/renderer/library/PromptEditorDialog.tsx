import { useEffect, useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Bookmark, Braces, Check, FileText, Languages, LoaderCircle, Sparkles, Star, Tag, X } from 'lucide-react'
import type { PromptAsset, PromptAssetKind, PromptLocale } from '../../shared/contracts/library'
import { parsePromptTemplate } from '../../shared/prompt-template'
import { getLibraryApi } from './library-api'
import { createPromptEditorDraft, derivePromptTitle, normalizePromptEditorDraft, validatePromptEditorDraft, type PromptEditorDraft, type PromptEditorErrors } from './prompt-editor'
import './PromptEditorDialog.css'

const KIND_OPTIONS: Array<{ value: PromptAssetKind; label: string; icon: typeof FileText }> = [
  { value: 'prompt', label: '提示词', icon: FileText },
  { value: 'template', label: '模板', icon: Braces },
  { value: 'style', label: '风格', icon: Sparkles },
]

function FieldError({ children }: { children?: string }): React.ReactElement | null {
  return children ? <span className="prompt-editor-field-error">{children}</span> : null
}

export function PromptEditorDialog({ open, item, onOpenChange, onSaved }: {
  open: boolean
  item?: PromptAsset
  onOpenChange: (open: boolean) => void
  onSaved: () => Promise<void>
}): React.ReactElement {
  const [draft, setDraft] = useState<PromptEditorDraft>(() => createPromptEditorDraft(item))
  const [errors, setErrors] = useState<PromptEditorErrors>({})
  const [busy, setBusy] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const parameters = useMemo(() => draft.kind === 'template' ? parsePromptTemplate(draft.content) : [], [draft.content, draft.kind])
  const tags = useMemo(() => [...new Set(draft.tagsText.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 30), [draft.tagsText])
  const imported = item?.source === 'import'

  useEffect(() => {
    if (!open) return
    setDraft(createPromptEditorDraft(item))
    setErrors({})
    setSubmitError(null)
  }, [item, open])

  const update = <Key extends keyof PromptEditorDraft>(key: Key, value: PromptEditorDraft[Key]) => {
    setDraft((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const save = async () => {
    const nextErrors = validatePromptEditorDraft(draft)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    setSubmitError(null)
    try {
      await getLibraryApi().savePrompt(normalizePromptEditorDraft(draft))
      await onSaved()
      onOpenChange(false)
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : '提示词保存失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!busy) onOpenChange(nextOpen) }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay prompt-editor-overlay" />
        <Dialog.Content className="dialog-content prompt-editor-dialog">
          <header className="prompt-editor-header">
            <div>
              <Dialog.Title>{imported ? '另存为我的提示词' : item ? '保存提示词新版本' : '新建提示词'}</Dialog.Title>
              <Dialog.Description>{item ? `基于 v${item.version} 创建新版本` : '提示词库'}</Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭"><X size={18} /></button></Dialog.Close>
          </header>

          <div className="prompt-editor-layout">
            <main className="prompt-editor-main">
              <label className="prompt-editor-name-field">
                <span>名称</span>
                <span className="prompt-editor-input-action">
                  <input value={draft.name} onChange={(event) => update('name', event.target.value)} maxLength={200} autoFocus aria-invalid={Boolean(errors.name)} placeholder="例如：雨夜街头人像" />
                  <button type="button" className="icon-button" aria-label="从内容生成名称" title="从内容生成名称" disabled={!draft.content.trim()} onClick={() => update('name', derivePromptTitle(draft.content))}><Sparkles size={14} /></button>
                </span>
                <FieldError>{errors.name}</FieldError>
              </label>

              <section className="prompt-editor-content-section">
                <div className="prompt-editor-field-heading">
                  <label htmlFor="prompt-editor-content">主要内容</label>
                  <select value={draft.primaryLocale} onChange={(event) => update('primaryLocale', event.target.value as PromptLocale)} aria-label="主要内容语言">
                    <option value="und">自动识别</option>
                    <option value="zh-CN">中文</option>
                    <option value="en">English</option>
                  </select>
                </div>
                <textarea id="prompt-editor-content" value={draft.content} onChange={(event) => update('content', event.target.value)} aria-invalid={Boolean(errors.content)} placeholder="输入可直接用于生成的提示词…" />
                <div className="prompt-editor-content-meta"><FieldError>{errors.content}</FieldError><span>{draft.content.length.toLocaleString('zh-CN')} 字符</span></div>
              </section>

              {draft.kind === 'template' && (
                <section className="prompt-editor-template-tools" aria-label="模板变量">
                  <div><Braces size={15} /><strong>模板变量</strong><span>{parameters.length ? `已识别 ${parameters.length} 个` : '未识别到变量'}</span></div>
                  {parameters.length > 0 && <div className="prompt-editor-parameter-list">{parameters.map((parameter) => <span key={parameter.name}>{parameter.name}{parameter.kind === 'required' ? ' *' : ''}</span>)}</div>}
                </section>
              )}

              <details className="prompt-editor-details" open={Boolean(draft.translationZh || draft.translationEn)}>
                <summary><Languages size={15} />双语版本</summary>
                <div className="prompt-editor-translation-grid">
                  <label>中文译文<textarea value={draft.translationZh} onChange={(event) => update('translationZh', event.target.value)} placeholder="可选" /></label>
                  <label>English<textarea value={draft.translationEn} onChange={(event) => update('translationEn', event.target.value)} placeholder="Optional" /></label>
                </div>
              </details>

              <label className="prompt-editor-description"><span>使用说明</span><textarea value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="适用场景、限制或使用建议（可选）" /></label>
            </main>

            <aside className="prompt-editor-properties">
              <section><span className="prompt-editor-section-label">类型</span><div className="prompt-editor-segments">{KIND_OPTIONS.map((option) => { const Icon = option.icon; return <button key={option.value} type="button" className={draft.kind === option.value ? 'selected' : ''} onClick={() => update('kind', option.value)}><Icon size={14} />{option.label}</button> })}</div></section>
              <section><span className="prompt-editor-section-label">保存到</span><div className="prompt-editor-segments two"><button type="button" className={draft.scope === 'project' ? 'selected' : ''} onClick={() => update('scope', 'project')}>当前项目</button><button type="button" className={draft.scope === 'global' ? 'selected' : ''} onClick={() => update('scope', 'global')}>全局</button></div></section>
              <label><span><Bookmark size={14} />分组</span><input value={draft.collection} onChange={(event) => update('collection', event.target.value)} maxLength={120} aria-invalid={Boolean(errors.collection)} /><FieldError>{errors.collection}</FieldError></label>
              <label><span><FileText size={14} />分类</span><input value={draft.category} onChange={(event) => update('category', event.target.value)} maxLength={120} aria-invalid={Boolean(errors.category)} /><FieldError>{errors.category}</FieldError></label>
              <label><span><Tag size={14} />标签</span><input value={draft.tagsText} onChange={(event) => update('tagsText', event.target.value)} placeholder="用逗号分隔" />{tags.length > 0 && <span className="prompt-editor-tag-preview">{tags.map((tag) => <i key={tag}>{tag}</i>)}</span>}</label>
              <label className="prompt-editor-favorite"><input type="checkbox" checked={draft.favorite} onChange={(event) => update('favorite', event.target.checked)} /><Star size={15} fill={draft.favorite ? 'currentColor' : 'none'} /><span>加入收藏</span></label>
              <details className="prompt-editor-details prompt-editor-link-details" open={Boolean(draft.previewUrl || draft.sourceUrl)}>
                <summary>来源信息</summary>
                <label>预览图地址<input value={draft.previewUrl} onChange={(event) => update('previewUrl', event.target.value)} aria-invalid={Boolean(errors.previewUrl)} placeholder="https://" /><FieldError>{errors.previewUrl}</FieldError></label>
                <label>来源地址<input value={draft.sourceUrl} onChange={(event) => update('sourceUrl', event.target.value)} aria-invalid={Boolean(errors.sourceUrl)} placeholder="https://" /><FieldError>{errors.sourceUrl}</FieldError></label>
              </details>
            </aside>
          </div>

          <footer className="prompt-editor-footer">
            <div role="status">{submitError ? <span className="prompt-editor-submit-error">{submitError}</span> : item ? <span><Check size={13} />原版本会保留</span> : null}</div>
            <Dialog.Close asChild><button type="button" className="secondary" disabled={busy}>取消</button></Dialog.Close>
            <button type="button" className="primary" onClick={() => void save()} disabled={busy}>{busy && <LoaderCircle size={14} className="spin" />}{busy ? '保存中…' : imported ? '保存到我的提示词' : item ? '保存新版本' : '创建提示词'}</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
