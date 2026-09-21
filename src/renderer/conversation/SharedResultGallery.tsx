import { CircleAlert } from 'lucide-react'
import type { ImageEditorLaunch } from '../../shared/contracts/editor'
import type { SessionResultCard } from './types'
import { getImageApi } from '../settings/image-api'
import { getLibraryApi } from '../library/library-api'
import { ResultImageCard } from '../image/ResultImageCard'
import { partitionGalleryResults } from './result-timeline'

interface SharedResultGalleryProps {
  results: SessionResultCard[]
  resultIds?: readonly string[]
  inline?: boolean
  lastPrompt?: string
  onChange: (results: SessionResultCard[]) => void
  onCanvas: () => void
  onEditor: (launch: ImageEditorLaunch) => void
  onSavePrompt: (prompt: string) => void
}

export function SharedResultGallery({ results, resultIds, inline = false, lastPrompt, onChange, onCanvas, onEditor, onSavePrompt }: SharedResultGalleryProps): React.ReactElement | null {
  const visibleResults = resultIds ? results.filter((result) => resultIds.includes(result.id)) : results
  if (visibleResults.length === 0) return null
  const { cards, unfinished } = partitionGalleryResults(visibleResults)
  const failed = unfinished.filter((result) => result.status === 'failed')
  const cancelled = unfinished.length - failed.length
  const firstFailure = failed.find((result) => result.task?.error)?.task?.error
  const failureReason = firstFailure?.code === 'rate_limit'
    ? '图片服务繁忙，可在任务中心重试'
    : firstFailure?.message
  const imageApi = getImageApi()
  return <section className={inline ? 'inline-result-gallery' : 'shared-result-gallery'} aria-label={inline ? '本轮生成结果' : '历史图片结果'}>
    {inline && <div className="inline-result-gallery-title">本轮生成{cards.length > 0 ? ` · ${cards.length} 张` : ''}</div>}
    {cards.length > 0 && <div className="result-grid">
    {cards.map((item) => <ResultImageCard
      key={item.id}
      item={item}
      lastPrompt={lastPrompt}
      onRename={(id, title) => onChange(results.map((result) => result.id === id ? { ...result, title } : result))}
      onCanvas={onCanvas}
      onEditor={onEditor}
      onSavePrompt={onSavePrompt}
      onRevealOutput={(taskId, localPath) => void imageApi.revealOutput?.({ taskId, localPath })}
      onDelete={async (taskId, localPath) => {
        try { await getLibraryApi().removeAsset({ id: taskId }) } catch {}
        try { await imageApi.remove(taskId, localPath) } catch {}
        onChange(results.filter((result) => result.id !== taskId))
      }}
    />)}
    </div>}
    {unfinished.length > 0 && <div className="result-failure-summary" role="status">
      <CircleAlert size={15} aria-hidden="true" />
      <span>
        {failed.length > 0 && `${failed.length} 个任务生成失败`}
        {failed.length > 0 && cancelled > 0 && '，'}
        {cancelled > 0 && `${cancelled} 个任务已取消`}
        {failureReason && ` · ${failureReason}`}
      </span>
    </div>}
  </section>
}
