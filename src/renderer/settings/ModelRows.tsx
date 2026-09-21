import { useMemo, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Check, CheckSquare, Layers, Search, Square, X } from 'lucide-react'
import type { ModelCapability, ModelDiscoveryCandidate } from '../../shared/contracts/models'
import type { ModelKind, SaveModelProfileInput } from '../../shared/contracts/settings'
import { KNOWN_OPENAI_REASONING_PATTERNS, KNOWN_XHIGH_PATTERNS } from '../../shared/models/reasoning'

const DEFAULT_TEXT_CAPABILITIES: ModelCapability[] = ['streaming', 'tool-calls']
const DEFAULT_IMAGE_CAPABILITIES: ModelCapability[] = ['reference-image']

export function getDefaultCapabilities(kind: ModelKind, modelId?: string): ModelCapability[] {
  if (kind !== 'text') return DEFAULT_IMAGE_CAPABILITIES
  const caps: ModelCapability[] = [...DEFAULT_TEXT_CAPABILITIES]
  if (modelId) {
    const id = modelId.toLowerCase()
    if (KNOWN_OPENAI_REASONING_PATTERNS.some((p) => p.test(id))) {
      caps.push('reasoning-effort' as ModelCapability)
      if (KNOWN_XHIGH_PATTERNS.some((p) => p.test(id))) {
        caps.push('reasoning:xhigh' as ModelCapability)
      }
    }
  }
  return caps
}

type EditableModel = { id: string; modelId: string; name: string; kind: ModelKind; capabilities?: string[] }

export function buildModelSaveInput({
  connectionId,
  model,
  modelId,
  name,
  kind,
}: {
  connectionId: string
  model?: EditableModel | null
  modelId: string
  name: string
  kind: ModelKind
}): SaveModelProfileInput {
  const trimmedId = modelId.trim()
  return {
    ...(model?.id ? { id: model.id } : {}),
    connectionId,
    modelId: trimmedId,
    name: name.trim() || trimmedId,
    kind,
    capabilities: model?.capabilities ?? getDefaultCapabilities(kind, trimmedId),
  }
}

export function guessModelKind(modelId: string, displayName?: string): ModelKind {
  const text = `${modelId} ${displayName ?? ''}`.toLowerCase()
  const imageKeywords = ['dall-e', 'dalle', 'flux', 'sd-', 'sd_', 'stable-diffusion', 'imagen', 'midjourney', 'recraft', 'kolors', 'image', 'cogview', 'janus']
  return imageKeywords.some((kw) => text.includes(kw)) ? 'image' : 'text'
}

export function ManualModelForm({
  connectionId,
  model,
  onSave,
  onSaveBatch,
  onCancel,
}: {
  connectionId: string
  model?: EditableModel | null
  onSave: (input: SaveModelProfileInput) => Promise<void>
  onSaveBatch?: (inputs: SaveModelProfileInput[]) => Promise<void>
  onCancel: () => void
}): React.ReactElement {
  const [mode, setMode] = useState<'single' | 'batch'>(model ? 'single' : 'single')
  const [modelId, setModelId] = useState(model?.modelId ?? '')
  const [name, setName] = useState(model?.name ?? '')
  const [kind, setKind] = useState<ModelKind>(model?.kind ?? 'text')
  const [batchText, setBatchText] = useState('')
  const [batchKindMode, setBatchKindMode] = useState<'auto' | 'text' | 'image'>('auto')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parsedBatchIds = useMemo(() => {
    return batchText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
  }, [batchText])

  const submitSingle = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave(buildModelSaveInput({ connectionId, model, modelId, name, kind }))
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '模型保存失败')
    } finally {
      setSaving(false)
    }
  }

  const submitBatch = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!parsedBatchIds.length) return
    setSaving(true)
    setError(null)
    try {
      const inputs: SaveModelProfileInput[] = parsedBatchIds.map((id) => {
        const itemKind: ModelKind = batchKindMode === 'auto' ? guessModelKind(id) : batchKindMode
        return {
          connectionId,
          modelId: id,
          name: id,
          kind: itemKind,
          capabilities: getDefaultCapabilities(itemKind, id),
        }
      })
      if (onSaveBatch) {
        await onSaveBatch(inputs)
      } else {
        for (const input of inputs) {
          await onSave(input)
        }
      }
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '批量添加失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="manual-model-container">
      {!model && (
        <div className="manual-mode-tabs">
          <button
            type="button"
            className={`tab-btn ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
          >
            单个录入
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === 'batch' ? 'active' : ''}`}
            onClick={() => setMode('batch')}
          >
            <Layers size={13} /> 批量粘贴添加 ({parsedBatchIds.length})
          </button>
        </div>
      )}

      {mode === 'single' ? (
        <form className="manual-model-form" onSubmit={submitSingle}>
          <div className="form-grid">
            <label>模型 ID<input value={modelId} onChange={(e) => setModelId(e.target.value)} placeholder="例如：gpt-4o, claude-3-5-sonnet" required /></label>
            <label>显示名称<input value={name} onChange={(e) => setName(e.target.value)} placeholder="留空使用模型 ID" /></label>
            <label>模型类型
              <select value={kind} onChange={(e) => setKind(e.target.value as ModelKind)}>
                <option value="text">文本模型</option>
                <option value="image">图片模型</option>
              </select>
            </label>
          </div>
          <p className="settings-kind-hint">
            {kind === 'text' ? '文本模型默认自动开启流式输出和工具调用能力。' : '图片模型默认自动开启参考图和提示词生图能力。'}
          </p>
          {error && <div className="start-state error"><span>{error}</span></div>}
          <footer>
            <button type="button" className="secondary small" onClick={onCancel}>取消</button>
            <button type="submit" className="primary small" disabled={saving || !modelId.trim()}>
              {saving ? '保存中…' : model ? '保存修改' : '保存模型'}
            </button>
          </footer>
        </form>
      ) : (
        <form className="manual-model-form" onSubmit={submitBatch}>
          <label className="batch-label">
            <span>批量模型 ID 列表（一行一个，支持从供应商控制台直接粘贴）</span>
            <textarea
              rows={5}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              placeholder="gpt-4o&#10;gpt-4o-mini&#10;dall-e-3&#10;flux-pro"
              className="batch-textarea"
            />
          </label>
          <div className="batch-type-row">
            <span>分类方式：</span>
            <label><input type="radio" name="batchKind" checked={batchKindMode === 'auto'} onChange={() => setBatchKindMode('auto')} /> 智能预判（图片/文本）</label>
            <label><input type="radio" name="batchKind" checked={batchKindMode === 'text'} onChange={() => setBatchKindMode('text')} /> 全部设为文本模型</label>
            <label><input type="radio" name="batchKind" checked={batchKindMode === 'image'} onChange={() => setBatchKindMode('image')} /> 全部设为图片模型</label>
          </div>
          {error && <div className="start-state error"><span>{error}</span></div>}
          <footer>
            <button type="button" className="secondary small" onClick={onCancel}>取消</button>
            <button type="submit" className="primary small" disabled={saving || parsedBatchIds.length === 0}>
              {saving ? '正在批量添加…' : `批量保存 ${parsedBatchIds.length} 个模型`}
            </button>
          </footer>
        </form>
      )}
    </div>
  )
}

export function CandidateRows({
  candidates,
  connectionId,
  onSave,
  onSaveBatch,
  onClose,
  onLoadMore,
  loadingMore = false,
}: {
  candidates: ModelDiscoveryCandidate[]
  connectionId: string
  onSave: (input: { connectionId: string; modelId: string; name: string; kind: ModelKind; capabilities: string[] }) => Promise<void>
  onSaveBatch?: (inputs: Array<{ connectionId: string; modelId: string; name: string; kind: ModelKind; capabilities: string[] }>) => Promise<void>
  onClose?: () => void
  onLoadMore?: () => Promise<void>
  loadingMore?: boolean
}) {
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [kinds, setKinds] = useState<Record<string, ModelKind>>(() => {
    const initial: Record<string, ModelKind> = {}
    for (const c of candidates) initial[c.id] = guessModelKind(c.id, c.displayName)
    return initial
  })
  const [savingBatch, setSavingBatch] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)

  const filtered = useMemo(() => {
    if (!search.trim()) return candidates
    const query = search.trim().toLowerCase()
    return candidates.filter((c) => c.id.toLowerCase().includes(query) || c.displayName.toLowerCase().includes(query))
  }, [candidates, search])

  const allFilteredSelected = filtered.length > 0 && filtered.every((c) => selectedIds.has(c.id))

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const c of filtered) next.delete(c.id)
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        for (const c of filtered) next.add(c.id)
        return next
      })
    }
  }

  const batchSetKind = (targetKind: ModelKind) => {
    setKinds((prev) => {
      const next = { ...prev }
      for (const id of selectedIds) next[id] = targetKind
      return next
    })
  }

  const handleSaveSelected = async () => {
    const targetCandidates = candidates.filter((c) => selectedIds.has(c.id))
    if (!targetCandidates.length) return
    setSavingBatch(true)
    setSaveError(null)
    setProgressMsg(`正在导入 0/${targetCandidates.length}...`)
    try {
      const payload = targetCandidates.map((c) => {
        const kind = kinds[c.id] ?? guessModelKind(c.id, c.displayName)
        return {
          connectionId,
          modelId: c.id,
          name: c.displayName,
          kind,
          capabilities: [...(c.capabilities && c.capabilities.length > 0 ? c.capabilities : getDefaultCapabilities(kind, c.id))],
        }
      })
      if (onSaveBatch) {
        await onSaveBatch(payload)
      } else {
        let count = 0
        for (const item of payload) {
          await onSave(item)
          count++
          setProgressMsg(`正在导入 ${count}/${payload.length}...`)
        }
      }
      setSelectedIds((current) => {
        const next = new Set(current)
        for (const item of payload) next.delete(item.modelId)
        return next
      })
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : '批量导入失败，请重试')
    } finally {
      setSavingBatch(false)
      setProgressMsg('')
    }
  }

  return (
    <div className="discovery-box">
      <div className="discovery-toolbar">
        <div className="discovery-search-wrap">
          <Search size={14} className="search-icon" />
          <input
            type="text"
            className="discovery-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`搜索 ${candidates.length} 个候选模型...`}
          />
        </div>

        <div className="discovery-batch-actions">
          <button type="button" className="secondary small" onClick={toggleSelectAll}>
            {allFilteredSelected ? <CheckSquare size={14} /> : <Square size={14} />}
            {allFilteredSelected ? '全不选' : '全选'}
          </button>
          <button type="button" className="secondary small" onClick={() => batchSetKind('text')} disabled={selectedIds.size === 0}>
            设为文本
          </button>
          <button type="button" className="secondary small" onClick={() => batchSetKind('image')} disabled={selectedIds.size === 0}>
            设为图片
          </button>
          <button
            type="button"
            className="primary small"
            onClick={() => void handleSaveSelected()}
            disabled={savingBatch || selectedIds.size === 0}
          >
            {savingBatch ? progressMsg || '导入中…' : `批量启用 (${selectedIds.size})`}
          </button>
          {onClose && (
            <button type="button" className="icon-button" onClick={onClose} title="收起候选列表">
              <X size={15} />
            </button>
          )}
          {onLoadMore && (
            <button type="button" className="secondary small" onClick={() => void onLoadMore()} disabled={loadingMore}>
              {loadingMore ? '加载中…' : '加载更多'}
            </button>
          )}
        </div>
      </div>

      {saveError && <div className="discovery-error" role="alert">{saveError}</div>}

      <div className="discovery-list">
        {filtered.map((candidate) => {
          const isSelected = selectedIds.has(candidate.id)
          const currentKind = kinds[candidate.id] ?? guessModelKind(candidate.id, candidate.displayName)
          return (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              connectionId={connectionId}
              kind={currentKind}
              selected={isSelected}
              onToggleSelect={(checked) => {
                setSelectedIds((prev) => {
                  const next = new Set(prev)
                  if (checked) next.add(candidate.id)
                  else next.delete(candidate.id)
                  return next
                })
              }}
              onKindChange={(nextKind) => setKinds((prev) => ({ ...prev, [candidate.id]: nextKind }))}
              onSave={onSave}
            />
          )
        })}
        {filtered.length === 0 && (
          <div className="discovery-empty">未找到匹配 “{search}” 的模型</div>
        )}
      </div>
    </div>
  )
}

export function ModelImportDialog({
  open,
  onOpenChange,
  connectionName,
  candidates,
  connectionId,
  onSave,
  onSaveBatch,
  onLoadMore,
  loadingMore,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionName: string
  candidates: ModelDiscoveryCandidate[]
  connectionId: string
  onSave: (input: SaveModelProfileInput) => Promise<void>
  onSaveBatch: (inputs: SaveModelProfileInput[]) => Promise<void>
  onLoadMore?: () => Promise<void>
  loadingMore?: boolean
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="model-import-overlay" />
        <Dialog.Content className="model-import-dialog" aria-describedby="model-import-description">
          <header className="model-import-dialog__header">
            <div>
              <Dialog.Title>从供应商导入模型</Dialog.Title>
              <Dialog.Description id="model-import-description">{connectionName} · 共获取 {candidates.length} 个候选模型</Dialog.Description>
            </div>
            <Dialog.Close asChild><button type="button" className="icon-button" aria-label="关闭模型导入窗口"><X size={17} /></button></Dialog.Close>
          </header>
          <div className="model-import-dialog__body">
            <CandidateRows
              candidates={candidates}
              connectionId={connectionId}
              onSave={onSave}
              onSaveBatch={onSaveBatch}
              onLoadMore={onLoadMore}
              loadingMore={loadingMore}
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CandidateRow({
  candidate,
  connectionId,
  kind,
  selected,
  onToggleSelect,
  onKindChange,
  onSave,
}: {
  candidate: ModelDiscoveryCandidate
  connectionId: string
  kind: ModelKind
  selected: boolean
  onToggleSelect: (selected: boolean) => void
  onKindChange: (kind: ModelKind) => void
  onSave: (input: { connectionId: string; modelId: string; name: string; kind: ModelKind; capabilities: string[] }) => Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave({
        connectionId,
        modelId: candidate.id,
        name: candidate.displayName,
        kind,
        capabilities: [...(candidate.capabilities && candidate.capabilities.length > 0 ? candidate.capabilities : getDefaultCapabilities(kind, candidate.id))],
      })
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`discovery-row ${selected ? 'selected' : ''}`}>
      <label className="candidate-select-label">
        <input
          type="checkbox"
          checked={selected}
          onChange={(e) => onToggleSelect(e.target.checked)}
          aria-label={`选择 ${candidate.displayName}`}
        />
      </label>
      <div className="candidate-info">
        <strong>{candidate.displayName}</strong>
        <small>
          {candidate.id} · <span className={`kind-tag ${kind}`}>{kind === 'text' ? '文本模型' : '图片模型'}</span>
          {candidate.capabilitySource === 'adapter' ? (
            <span className="source-tag adapter" title="由官方适配器明确提供能力">官方声明</span>
          ) : (
            <span className="source-tag unconfirmed" title="未确认完整能力，导入后可自定义">推断预设</span>
          )}
        </small>
      </div>
      <div className="discovery-actions">
        <select value={kind} onChange={(event) => onKindChange(event.target.value as ModelKind)} aria-label={`${candidate.displayName} 类型`}>
          <option value="text">文本模型</option>
          <option value="image">图片模型</option>
        </select>
        <button type="button" className="secondary small" onClick={() => void save()} disabled={saving || saved}>
          {saved ? <><Check size={14} />已启用</> : saving ? '保存中…' : '确认并启用'}
        </button>
      </div>
    </div>
  )
}

export function ModelRows({
  connectionId,
  models,
  defaultTextModelId,
  defaultImageModelId,
  onEdit,
  onDelete,
  onSetDefault,
}: {
  connectionId: string
  models: Array<{ id: string; connectionId: string; modelId: string; name: string; kind: ModelKind; capabilities: string[] }>
  defaultTextModelId?: string
  defaultImageModelId?: string
  onEdit: (model: { id: string; connectionId: string; modelId: string; name: string; kind: ModelKind; capabilities: string[] }) => void
  onDelete: (id: string, name: string) => Promise<void>
  onSetDefault: (id: string, kind: ModelKind) => Promise<void>
}) {
  const connectionModels = models.filter((model) => model.connectionId === connectionId)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | ModelKind>('all')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const visibleModels = connectionModels.filter((model) => {
    if (kindFilter !== 'all' && model.kind !== kindFilter) return false
    if (!normalizedQuery) return true
    return `${model.name} ${model.modelId}`.toLocaleLowerCase().includes(normalizedQuery)
  })

  if (connectionModels.length === 0) {
    return <div className="settings-models"><p className="settings-empty">当前分组尚未绑定模型，点击上方“获取模型列表”或“手动添加模型”。</p></div>
  }
  return (
    <div className="settings-models">
      <div className="settings-models-toolbar">
        <div className="settings-models-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={`搜索 ${connectionModels.length} 个已添加模型`}
            aria-label="搜索已添加模型"
          />
        </div>
        <div className="settings-models-filter" role="group" aria-label="按模型类型筛选">
          {(['all', 'text', 'image'] as const).map((filter) => (
            <button
              type="button"
              key={filter}
              className={kindFilter === filter ? 'active' : ''}
              aria-pressed={kindFilter === filter}
              onClick={() => setKindFilter(filter)}
            >
              {filter === 'all' ? '全部' : filter === 'text' ? '文本' : '图片'}
            </button>
          ))}
        </div>
      </div>
      {visibleModels.map((model) => {
        const isDefault = (model.kind === 'text' && defaultTextModelId === model.id) || (model.kind === 'image' && defaultImageModelId === model.id)
        return (
          <div className="model-row" key={model.id}>
            <div className="model-row-info">
              <strong>{model.name}</strong>
              <small>{model.modelId} · {model.kind === 'text' ? '文本模型' : '图片模型'}</small>
            </div>
            <div className="model-row-actions">
              {isDefault ? (
                <span className="pill green">默认{model.kind === 'text' ? '文本' : '图片'}</span>
              ) : (
                <button type="button" className="secondary small" onClick={() => void onSetDefault(model.id, model.kind)} title="设为默认模型">
                  设为默认
                </button>
              )}
              <button type="button" className="secondary small" onClick={() => onEdit(model)}>编辑</button>
              <button type="button" className="secondary small danger" onClick={() => void onDelete(model.id, model.name)}>删除</button>
            </div>
          </div>
        )
      })}
      {visibleModels.length === 0 && <p className="settings-empty">没有匹配的已添加模型。</p>}
    </div>
  )
}
