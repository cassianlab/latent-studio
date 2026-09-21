import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertCircle, Info, RefreshCw, ScrollText, TriangleAlert, X } from 'lucide-react'
import type { RuntimeLogEntry } from '../../shared/contracts/logging'

function contextText(context: RuntimeLogEntry['context']): string {
  if (!context || Object.keys(context).length === 0) return ''
  return JSON.stringify(context, null, 2)
}

export function RuntimeLogDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): React.ReactElement {
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const api = typeof window !== 'undefined' ? window.latentStudio?.logs : undefined
      if (!api) throw new Error('运行日志仅在桌面应用中可用')
      setLogs(await api.list())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '运行日志读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) void load() }, [load, open])

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay runtime-log-overlay" />
        <Dialog.Content className="runtime-log-dialog">
          <header>
            <div><Dialog.Title><ScrollText size={18} />运行日志</Dialog.Title><Dialog.Description>保留最近 48 小时的脱敏记录，过期内容会自动清理。</Dialog.Description></div>
            <div className="runtime-log-actions">
              <button type="button" aria-label="刷新运行日志" title="刷新" onClick={() => void load()} disabled={loading}><RefreshCw size={15} className={loading ? 'spin' : ''} /></button>
              <Dialog.Close asChild><button type="button" aria-label="关闭运行日志"><X size={17} /></button></Dialog.Close>
            </div>
          </header>
          <div className="runtime-log-list" aria-busy={loading}>
            {error && <div className="runtime-log-empty error" role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
            {!error && !loading && logs.length === 0 && <div className="runtime-log-empty"><ScrollText size={21} /><span>最近 48 小时没有运行日志</span></div>}
            {logs.map((entry, index) => {
              const detail = contextText(entry.context)
              const Icon = entry.level === 'error' ? AlertCircle : entry.level === 'warn' ? TriangleAlert : Info
              return (
                <article className={`runtime-log-row ${entry.level}`} key={`${entry.timestamp}-${entry.message}-${index}`}>
                  <Icon size={15} />
                  <div>
                    <div className="runtime-log-meta"><time>{new Date(entry.timestamp).toLocaleString('zh-CN')}</time><span>{entry.source === 'diagnostic' ? '应用诊断' : '错误'}</span></div>
                    <strong>{entry.message}</strong>
                    {detail && <pre>{detail}</pre>}
                  </div>
                </article>
              )
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
