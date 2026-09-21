import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import type { PromptCatalogSourceInfo } from '../../shared/contracts/library'
import type { PromptCatalogSyncProgress as SyncProgress } from './prompt-sync'

interface PromptSyncProgressProps {
  sources: readonly PromptCatalogSourceInfo[]
  syncing: boolean
  progress: SyncProgress | null
  results: readonly SyncProgress[]
}

export function PromptSyncProgress({ sources, syncing, progress, results }: PromptSyncProgressProps): React.ReactElement | null {
  if (!progress && results.length === 0) return null
  const labels = new Map(sources.map((source) => [source.id, source.displayName]))
  const total = progress?.total ?? sources.length
  const completed = progress ? progress.current - (progress.state === 'syncing' ? 1 : 0) : results.length
  const currentLabel = progress ? labels.get(progress.source) ?? progress.source : ''

  return <section className="prompt-sync-progress" role="status" aria-live="polite">
    <div className="prompt-sync-progress-heading">
      <div>
        <strong>{syncing && progress ? `正在同步 ${progress.current}/${total}` : `同步完成 ${completed}/${total}`}</strong>
        {syncing && progress && <span>{currentLabel}</span>}
      </div>
      <span className="prompt-sync-progress-count">{completed} / {total}</span>
    </div>
    <progress aria-label={`提示词仓库同步进度，已完成 ${completed} 个，共 ${total} 个`} value={completed} max={Math.max(1, total)} />
    {results.length > 0 && <div className="prompt-sync-source-results">
      {results.map((entry) => <div className={`prompt-sync-source-result ${entry.state}`} key={entry.source}>
        {entry.state === 'succeeded'
          ? <Check size={14} aria-hidden="true" />
          : entry.state === 'failed'
            ? <CircleAlert size={14} aria-hidden="true" />
            : <LoaderCircle size={14} className="spin" aria-hidden="true" />}
        <strong>{labels.get(entry.source) ?? entry.source}</strong>
        {entry.result
          ? <span>完成 · 来源条目 {entry.result.total} · 新增 {entry.result.imported} · 更新 {entry.result.updated} · 移除 {entry.result.removed} · 未变化 {entry.result.skipped}</span>
          : <span>失败 · {entry.message ?? '同步失败'}</span>}
      </div>)}
    </div>}
  </section>
}
