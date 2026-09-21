import { ArchiveRestore, ChevronDown } from 'lucide-react'
import type { ConversationCompactionState } from './types'
import './CompactionStatusCard.css'

function formatTime(value: number | undefined): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function CompactionStatusCard({ state }: { state: ConversationCompactionState }): React.ReactElement {
  const fallback = state.compressionMode === 'local'
  const from = formatTime(state.coveredFromAt)
  const through = formatTime(state.coveredThroughAt)
  return (
    <details className={`compaction-status-card ${fallback ? 'local' : 'observational'}`}>
      <summary>
        <span className="compaction-status-icon"><ArchiveRestore size={16} /></span>
        <span className="compaction-status-copy">
          <strong>上下文已压缩</strong>
          <span>完整对话仍保留 · 保留 {state.keyItemCount ?? 0} 项关键状态 · 本轮使用压缩上下文</span>
        </span>
        <span className="compaction-mode-badge">{fallback ? '本地保底压缩' : '模型观察压缩'}</span>
        <ChevronDown className="compaction-chevron" size={15} aria-hidden="true" />
      </summary>
      <div className="compaction-status-details">
        <dl>
          <div><dt>覆盖消息</dt><dd>{state.coveredMessageCount ?? '未记录'} 条</dd></div>
          {(from || through) && <div><dt>覆盖时间</dt><dd>{from ?? '未知'} — {through ?? '未知'}</dd></div>}
          {state.fallbackReason && <div><dt>降级原因</dt><dd>{state.fallbackReason}</dd></div>}
        </dl>
        <section aria-label="压缩摘要">
          <h4>查看摘要</h4>
          <p>{state.summary}</p>
        </section>
      </div>
    </details>
  )
}
