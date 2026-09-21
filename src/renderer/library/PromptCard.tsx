import { useEffect, useState } from 'react'
import { Check, Copy, CornerDownLeft, Image, Pencil, Star, Trash2 } from 'lucide-react'
import type { PromptAsset } from '../../shared/contracts/library'
import { promptCategoryLabel } from '../../shared/prompt-categories'
import { parsePromptTemplate } from '../../shared/prompt-template'
import { HoverTip } from '../common/HoverTip'
import { PromptParameterDialog } from '../../components/prompt-template/PromptParameterDialog'

export function PromptCard({ item, copied, onCopy, onApply, onEdit, onToggleFavorite, onRemove }: {
  item: PromptAsset
  copied: boolean
  onCopy: (prompt: string) => void
  onApply: (prompt?: string) => void
  onEdit: () => void
  onToggleFavorite: () => void
  onRemove: () => void
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [parameterDialogOpen, setParameterDialogOpen] = useState(false)
  const [locale, setLocale] = useState<'main' | 'zh-CN' | 'en'>(item.translations?.['zh-CN'] ? 'zh-CN' : 'main')
  useEffect(() => { setLocale(item.translations?.['zh-CN'] ? 'zh-CN' : 'main'); setExpanded(false) }, [item.id, item.translations])
  const variants = [
    { id: 'main' as const, label: item.primaryLocale === 'en' ? 'English' : item.primaryLocale === 'zh-CN' ? '中文' : '原文', content: item.content },
    ...(item.translations?.['zh-CN'] ? [{ id: 'zh-CN' as const, label: '中文', content: item.translations['zh-CN'] }] : []),
    ...(item.translations?.en ? [{ id: 'en' as const, label: 'English', content: item.translations.en }] : []),
  ].filter((variant, index, all) => all.findIndex((candidate) => candidate.content === variant.content) === index)
  const displayedPrompt = variants.find((variant) => variant.id === locale)?.content ?? item.content
  const apply = () => {
    if (parsePromptTemplate(displayedPrompt).length) setParameterDialogOpen(true)
    else onApply(displayedPrompt)
  }
  return <>
    <article className={`prompt-card ${item.previewUrl ? 'has-preview' : ''}`}>
    <div className="prompt-card-preview">
      {item.previewUrl && !previewFailed
        ? <><img src={item.previewUrl} alt={`${item.name} 样例`} loading="lazy" decoding="async" onError={() => setPreviewFailed(true)} /><span className="prompt-preview-label">样例图</span></>
        : <div className="prompt-card-placeholder" aria-hidden="true"><Image size={24} /></div>}
    </div>
    <div className="prompt-card-body">
      <div className="prompt-card-meta"><span className="pill prompt-group-pill">{item.collection}</span><span className="pill prompt-category-pill">{promptCategoryLabel(item.category)}</span><span className="prompt-version">v{item.version}</span><button type="button" className={`prompt-favorite-toggle ${item.favorite ? 'active' : ''}`} onClick={onToggleFavorite} aria-pressed={item.favorite} aria-label={item.favorite ? `取消收藏 ${item.name}` : `收藏 ${item.name}`} title={item.favorite ? '取消收藏' : '收藏'}><Star size={14} fill={item.favorite ? 'currentColor' : 'none'} /></button></div>
      <h3>{item.name}</h3>
      {variants.length > 1 && <div className="prompt-language-switch" aria-label="提示词语言">{variants.map((variant) => <button key={variant.id} type="button" className={locale === variant.id ? 'selected' : ''} onClick={() => { setLocale(variant.id); setExpanded(false) }}>{variant.label}</button>)}</div>}
      <p className={expanded ? 'expanded' : ''}>{displayedPrompt}</p>
      {displayedPrompt.length > 180 && <button type="button" className="prompt-expand" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>{expanded ? '收起提示词' : '查看完整提示词'}</button>}
    </div>
    <footer className={`prompt-card-actions ${item.source === 'import' ? 'read-only' : ''}`}>
      <button type="button" className="secondary small" onClick={() => onCopy(displayedPrompt)} aria-label={`复制 ${item.name}`}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? '已复制' : '复制'}</button>
      <button type="button" className="primary small prompt-apply-button" onClick={apply}><CornerDownLeft size={14} />应用</button>
      <HoverTip label={item.source === 'import' ? '另存为我的提示词' : '编辑并保存新版本'}><button type="button" className="icon-button" aria-label={`${item.source === 'import' ? '另存' : '编辑'} ${item.name}`} onClick={onEdit}><Pencil size={14} /></button></HoverTip>
      {item.source !== 'import' && <HoverTip label="删除"><button type="button" className="icon-button danger" aria-label={`删除 ${item.name}`} onClick={onRemove}><Trash2 size={14} /></button></HoverTip>}
    </footer>
    </article>
    <PromptParameterDialog open={parameterDialogOpen} template={displayedPrompt} onCancel={() => setParameterDialogOpen(false)} onApply={(prompt) => { setParameterDialogOpen(false); onApply(prompt) }} />
  </>
}
