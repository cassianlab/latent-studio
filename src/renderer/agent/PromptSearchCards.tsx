import { useState } from 'react'
import { Check, Copy, ExternalLink, Image, WandSparkles } from 'lucide-react'
import type { PromptSearchResult } from '../../shared/contracts/agent'
import { parsePromptTemplate } from '../../shared/prompt-template'
import { PromptParameterDialog } from '../../components/prompt-template/PromptParameterDialog'
import { publishSelectedPrompt } from '../library/prompt-selection'
import './PromptSearchCards.css'

export function promptApplyAction(item: PromptSearchResult): 'parameters' | 'publish' {
  return parsePromptTemplate(item.content).length ? 'parameters' : 'publish'
}

export function PromptSearchCards({ results }: { results: readonly PromptSearchResult[] }): React.ReactElement | null {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [parameterItem, setParameterItem] = useState<PromptSearchResult | null>(null)
  if (!results.length) return null
  const copy = async (item: PromptSearchResult) => {
    try {
      await navigator.clipboard.writeText(item.content)
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => current === item.id ? null : current), 1500)
    } catch {
      // Clipboard access can be unavailable in browser preview; the card remains usable.
    }
  }
  const apply = (item: PromptSearchResult) => {
    if (promptApplyAction(item) === 'parameters') setParameterItem(item)
    else publishSelectedPrompt(item.content)
  }
  return <><section className="prompt-search-results" aria-label="提示词检索结果">
    <header><span><WandSparkles size={14} />提示词库匹配</span><small>最多展示 4 条最佳结果</small></header>
    <div className="prompt-search-grid">
      {results.slice(0, 4).map((item, index) => <article className="prompt-search-card" key={item.id} aria-label={`第 ${index + 1} 个提示词`}>
        <span className="prompt-search-index" aria-hidden="true">{index + 1}</span>
        <div className="prompt-search-thumb">
          {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={`${item.title} 样例`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none' }} /> : <Image size={22} />}
        </div>
        <div className="prompt-search-body">
          <strong title={item.title}>{item.title}</strong>
          <small>{item.collection ?? '个人'} · {item.category} · {item.type === 'template' ? '模板' : item.type === 'style' ? '风格' : item.type === 'fragment' ? '片段' : '提示词'}</small>
          <small>{item.reason} · 相关度 {Math.round(item.score * 100)}%</small>
          <p>{item.content}</p>
        </div>
        <footer>
          <button type="button" className="secondary small" onClick={() => void copy(item)}>{copiedId === item.id ? <Check size={12} /> : <Copy size={12} />}{copiedId === item.id ? '已复制' : '复制'}</button>
          <button type="button" className="primary small" onClick={() => apply(item)}><WandSparkles size={12} />应用</button>
          <button type="button" className="secondary small" onClick={() => publishSelectedPrompt(item.content, 'agent')} title="让 Agent 直接使用原提示词">直接调用</button>
          <button type="button" className="secondary small" onClick={() => publishSelectedPrompt(`请根据当前需求改写并使用以下提示词：\n${item.content}`, 'agent')} title="让 Agent 根据当前需求改写">改写使用</button>
          {item.sourceUrl && <a className="prompt-search-source" href={item.sourceUrl} target="_blank" rel="noreferrer" aria-label={`打开 ${item.title} 来源`}><ExternalLink size={12} /></a>}
        </footer>
      </article>)}
    </div>
  </section><PromptParameterDialog open={parameterItem !== null} template={parameterItem?.content ?? ''} onCancel={() => setParameterItem(null)} onApply={(prompt) => { setParameterItem(null); publishSelectedPrompt(prompt) }} /></>
}
