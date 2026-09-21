import { useCallback, useEffect, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { AlertTriangle, Check, Database, Download, LoaderCircle, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import type { EmbeddingModelStatus } from '../../shared/contracts/library'
import { getLibraryApi } from './library-api'
import './EmbeddingModelDialog.css'

type EmbeddingOperation = 'install' | 'update' | 'rebuild' | 'clear' | 'uninstall'

export interface EmbeddingModelPresentation {
  label: string
  tone: 'neutral' | 'working' | 'success' | 'danger'
  primaryAction: 'install' | 'update' | null
  retrievalLabel: '关键词检索' | '混合检索'
}

export function embeddingModelPresentation(status: EmbeddingModelStatus): EmbeddingModelPresentation {
  const retrievalLabel = status.retrievalMode === 'hybrid' ? '混合检索' : '关键词检索'
  if (status.status === 'ready') return { label: '可用', tone: 'success', primaryAction: 'update', retrievalLabel }
  if (status.status === 'downloading') return { label: '正在下载', tone: 'working', primaryAction: null, retrievalLabel }
  if (status.status === 'indexing') return { label: '正在建立索引', tone: 'working', primaryAction: null, retrievalLabel }
  if (status.status === 'installed') return { label: '已安装，待建索引', tone: 'neutral', primaryAction: 'update', retrievalLabel }
  if (status.status === 'failed') return { label: '需要修复', tone: 'danger', primaryAction: 'install', retrievalLabel }
  if (status.status === 'unavailable') return { label: '当前版本不可用', tone: 'danger', primaryAction: null, retrievalLabel }
  return { label: '未安装', tone: 'neutral', primaryAction: 'install', retrievalLabel }
}

export function formatEmbeddingBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1 }
  return `${unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const operationLabels: Record<EmbeddingOperation, string> = {
  install: '正在下载模型并建立索引…',
  update: '正在更新新增和变更的提示词索引…',
  rebuild: '正在重建全部提示词索引…',
  clear: '正在清空向量索引…',
  uninstall: '正在卸载本地向量模型…',
}

const confirmations: Record<'rebuild' | 'clear' | 'uninstall', { title: string; detail: string; confirm: string }> = {
  rebuild: { title: '重建全部索引？', detail: '现有向量会被替换，期间 Agent 自动退回关键词检索。提示词原文不会被删除。', confirm: '确认重建' },
  clear: { title: '清空向量索引？', detail: '保留已下载模型，仅删除提示词向量。之后仍可重新建立索引。', confirm: '确认清空' },
  uninstall: { title: '卸载向量模型？', detail: '模型文件与全部向量索引会从本机移除，提示词原文不受影响。', confirm: '确认卸载' },
}

export function EmbeddingModelDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.ReactElement {
  const api = getLibraryApi()
  const [status, setStatus] = useState<EmbeddingModelStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [operation, setOperation] = useState<EmbeddingOperation | null>(null)
  const [confirmation, setConfirmation] = useState<'rebuild' | 'clear' | 'uninstall' | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setStatus(await api.getEmbeddingStatus()) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '语义检索状态读取失败') }
    finally { setLoading(false) }
  }, [api])

  useEffect(() => {
    if (!open) return
    setConfirmation(null)
    setMessage(null)
    void refresh()
  }, [open, refresh])

  const run = async (next: EmbeddingOperation) => {
    setOperation(next)
    setConfirmation(null)
    setError(null)
    setMessage(null)
    try {
      const result = next === 'install' ? await api.installEmbeddingModel()
        : next === 'update' ? await api.updateEmbeddings()
          : next === 'rebuild' ? await api.rebuildEmbeddings()
            : next === 'clear' ? await api.clearEmbeddings()
              : await api.uninstallEmbeddingModel()
      setStatus(result)
      setMessage(next === 'install' ? '模型已安装，提示词向量索引已建立。'
        : next === 'update' ? '索引已更新，只处理了新增或发生变化的提示词。'
          : next === 'rebuild' ? '全部提示词索引已重建。'
            : next === 'clear' ? '向量索引已清空，当前使用关键词检索。'
              : '本地向量模型与索引已卸载。')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '语义检索操作失败')
      await refresh()
    } finally {
      setOperation(null)
    }
  }

  const presentation = status ? embeddingModelPresentation(status) : null
  const busy = loading || operation !== null
  const confirmationCopy = confirmation ? confirmations[confirmation] : null

  return <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !busy) onClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay embedding-model-overlay" />
      <Dialog.Content className="dialog-content embedding-model-dialog" aria-describedby="embedding-model-description">
        <div className="embedding-model-head">
          <div className="embedding-model-title">
            <span><Database size={18} /></span>
            <div><Dialog.Title>语义检索</Dialog.Title><Dialog.Description id="embedding-model-description">为 Agent 提示词搜索启用本地 RAG 向量模型</Dialog.Description></div>
          </div>
          <button type="button" className="icon-button" aria-label="关闭语义检索设置" onClick={onClose} disabled={busy}><X size={17} /></button>
        </div>

        {loading && !status ? <div className="embedding-model-loading"><LoaderCircle size={16} className="spin" />正在读取模型状态…</div> : status && presentation ? <>
          <div className="embedding-model-state">
            <div><span className={`embedding-status-dot ${presentation.tone}`} /><strong>{presentation.label}</strong><small>{presentation.retrievalLabel}</small></div>
            <dl>
              <div><dt>提示词总数</dt><dd>{status.totalCount.toLocaleString('zh-CN')}</dd></div>
              <div><dt>已索引</dt><dd>{status.indexedCount.toLocaleString('zh-CN')}</dd></div>
              <div><dt>待更新</dt><dd>{status.pendingCount.toLocaleString('zh-CN')}</dd></div>
              <div><dt>磁盘占用</dt><dd>{formatEmbeddingBytes(status.diskBytes)}</dd></div>
            </dl>
          </div>

          <div className="embedding-model-info">
            <p>未安装时仍可使用中文关键词、同义词和分类检索。安装后 Agent 会自动使用关键词与向量混合检索，仍只展示最多 4 条最佳结果。</p>
            {status.modelId && <span className="embedding-model-id" title={status.modelId}>{status.modelId}</span>}
            {status.license && <span>{status.license}</span>}
          </div>

          {operation && <div className="embedding-model-feedback working" role="status"><LoaderCircle size={14} className="spin" /><span>{operationLabels[operation]}首次处理大量提示词可能需要较长时间，请保持应用运行。</span></div>}
          {!operation && message && <div className="embedding-model-feedback success" role="status"><Check size={14} /><span>{message}</span></div>}
          {!operation && (error || status.lastError) && <div className="embedding-model-feedback error" role="alert"><AlertTriangle size={14} /><span>{error || status.lastError}</span></div>}

          {confirmationCopy && <div className="embedding-model-confirm" role="alertdialog" aria-label={confirmationCopy.title}>
            <div><strong>{confirmationCopy.title}</strong><p>{confirmationCopy.detail}</p></div>
            <div><button type="button" className="secondary small" onClick={() => setConfirmation(null)}>取消</button><button type="button" className="danger small" onClick={() => { if (confirmation) void run(confirmation) }}>{confirmationCopy.confirm}</button></div>
          </div>}

          <div className="embedding-model-actions">
            {presentation.primaryAction === 'install' && <button type="button" className="primary" disabled={busy} onClick={() => void run('install')}><Download size={15} />安装并建立索引</button>}
            {presentation.primaryAction === 'update' && <button type="button" className="primary" disabled={busy} onClick={() => void run('update')}><RefreshCw size={15} />更新索引</button>}
            {status.status !== 'not-installed' && status.status !== 'unavailable' && <>
              <button type="button" className="secondary" disabled={busy} onClick={() => setConfirmation('rebuild')}><RotateCcw size={15} />重建</button>
              <button type="button" className="secondary" disabled={busy || status.indexedCount === 0} onClick={() => setConfirmation('clear')}>清空索引</button>
              <button type="button" className="secondary danger-text" disabled={busy} onClick={() => setConfirmation('uninstall')}><Trash2 size={15} />卸载</button>
            </>}
            <button type="button" className="secondary" disabled={busy} onClick={() => void refresh()} aria-label="刷新语义检索状态"><RefreshCw size={15} />刷新状态</button>
          </div>
        </> : error ? <div className="embedding-model-feedback error" role="alert"><AlertTriangle size={14} /><span>{error}</span></div> : null}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
