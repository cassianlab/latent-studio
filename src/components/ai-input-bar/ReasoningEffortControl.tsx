import { useCallback, useEffect, useMemo, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Brain, Check, ChevronDown, Sparkles } from 'lucide-react'
import type { TextReasoningEffort } from '../../shared/contracts/text'
import {
  REASONING_EFFORT_HINTS,
  REASONING_EFFORT_LABELS,
  getSupportedReasoningEfforts,
} from '../../shared/models/reasoning'
import type { GlobalSettings } from '../../shared/contracts/settings'
import { getSettingsApi } from '../../renderer/settings/settings-api'
import { DropdownPortal } from './DropdownPortal'

const STORAGE_KEY = 'latent-studio:reasoning-history'

function loadReasoningHistory(): Record<string, TextReasoningEffort> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveReasoningHistory(history: Record<string, TextReasoningEffort>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
  } catch {}
}

export interface EffortOption {
  value: TextReasoningEffort
  label: string
  hint: string
  badge?: string
}

const ALL_EFFORT_OPTIONS: EffortOption[] = [
  { value: 'auto', label: '自动', hint: '由模型端自主调度思考预算', badge: '默认' },
  { value: 'none', label: '关闭', hint: '跳过深度思考推导，极速响应' },
  { value: 'low', label: '低强度', hint: '快速轻度自检，适合日常问答与快节奏创作' },
  { value: 'medium', label: '中强度', hint: '适中思考，平衡创作质量与响应耗时', badge: '推荐' },
  { value: 'high', label: '高强度', hint: '多轮严谨自检与深度推导，耗时稍增' },
  { value: 'xhigh', label: '极高强度', hint: '极限思考预算，针对极度复杂的推理逻辑' },
]

export interface ReasoningEffortControlProps {
  modelId: string
  settings?: GlobalSettings | null
  value: TextReasoningEffort
  onChange: (effort: TextReasoningEffort) => void
  compact?: boolean
}

export function ReasoningEffortControl({
  modelId,
  settings,
  value,
  onChange,
  compact = false,
}: ReasoningEffortControlProps): React.ReactElement | null {
  const [open, setOpen] = useState(false)

  const selectedModel = useMemo(() => {
    return settings?.models.find((m) => m.id === modelId)
  }, [settings, modelId])

  const reasoningInfo = useMemo(() => {
    if (!selectedModel) {
      return { supported: ['auto' as TextReasoningEffort], defaultEffort: 'auto' as TextReasoningEffort, source: 'unconfirmed' as const }
    }
    const connection = settings?.connections.find((c) => c.id === selectedModel.connectionId)
    return getSupportedReasoningEfforts({
      modelId: selectedModel.modelId,
      capabilities: selectedModel.capabilities,
      providerType: connection?.providerType,
    })
  }, [selectedModel, settings])

  // Filter available options: if model has specific support (e.g. xhigh), include it;
  // otherwise provide standard complete choices so user is never locked out.
  const displayOptions = useMemo(() => {
    const supportsXhigh = reasoningInfo.supported.includes('xhigh') || selectedModel?.modelId?.includes('xhigh')
    return ALL_EFFORT_OPTIONS.filter((opt) => {
      if (opt.value === 'xhigh' && !supportsXhigh) return false
      return true
    })
  }, [reasoningInfo, selectedModel])

  // Restore remembered choice on model switch
  useEffect(() => {
    if (!modelId) return
    const history = loadReasoningHistory()
    const remembered = history[modelId]
    if (remembered && remembered !== value) {
      onChange(remembered)
    }
  }, [modelId])

  // Listen to global effort updates (e.g. from Inspector)
  useEffect(() => {
    const onEffortChanged = (event: Event) => {
      const nextEffort = (event as CustomEvent<TextReasoningEffort>).detail
      if (nextEffort && nextEffort !== value) {
        onChange(nextEffort)
      }
    }
    window.addEventListener('latent-studio:reasoning-effort-updated', onEffortChanged)
    return () => window.removeEventListener('latent-studio:reasoning-effort-updated', onEffortChanged)
  }, [value, onChange])

  const handleSelect = useCallback((effort: TextReasoningEffort) => {
    onChange(effort)
    setOpen(false)
    if (modelId) {
      const history = loadReasoningHistory()
      history[modelId] = effort
      saveReasoningHistory(history)
    }

    // Dispatch global event for Inspector and listeners
    window.dispatchEvent(new CustomEvent('latent-studio:reasoning-effort-updated', { detail: effort }))

    // If user explicitly chooses non-auto on a model that doesn't have reasoning-effort in capabilities,
    // seamlessly persist reasoning capability so the service adapter accepts it
    if (effort !== 'auto' && selectedModel && !selectedModel.capabilities?.includes('reasoning-effort')) {
      void (async () => {
        try {
          const api = getSettingsApi()
          const currentCaps = selectedModel.capabilities ?? []
          if (!currentCaps.includes('reasoning-effort')) {
            await api.saveModel({
              id: selectedModel.id,
              connectionId: selectedModel.connectionId,
              modelId: selectedModel.modelId,
              name: selectedModel.name,
              kind: selectedModel.kind,
              capabilities: [...currentCaps, 'reasoning-effort'],
            })
          }
        } catch {}
      })()
    }
  }, [modelId, onChange, selectedModel])

  const currentLabel = REASONING_EFFORT_LABELS[value] ?? '自动'

  return (
    <div className={`reasoning-effort-control ${compact ? 'compact' : ''}`}>
      <DropdownPortal
        open={open}
        onOpenChange={setOpen}
        className="reasoning-effort-dropdown__menu"
        width={230}
        trigger={(ref) => (
          <div ref={ref} className="reasoning-effort-trigger-wrap">
            <Tooltip.Root delayDuration={250}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className={`input-dropdown-trigger reasoning-effort-trigger ${open ? 'open' : ''} ${value !== 'auto' ? 'active-effort' : ''}`}
                  onClick={() => setOpen((prev) => !prev)}
                  aria-label={`思考推理强度：${currentLabel}`}
                  aria-expanded={open}
                >
                  <Brain size={13} className="reasoning-icon" />
                  <span className="reasoning-label">思考: {currentLabel}</span>
                  <ChevronDown size={11} className="reasoning-chevron" />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content className="tooltip" side="top" sideOffset={7}>
                  思考强度：{currentLabel} · 点击自由切换
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>
        )}
      >
        <div className="input-dropdown-header">
          <Brain size={14} />
          <span>思考推理强度 (Reasoning Effort)</span>
        </div>
        <div className="input-dropdown-list" role="listbox" aria-label="选择思考推理强度">
          {displayOptions.map((opt) => {
            const isSelected = value === opt.value
            return (
              <button
                type="button"
                role="option"
                key={opt.value}
                aria-selected={isSelected}
                className={`reasoning-option-btn ${isSelected ? 'selected' : ''}`}
                onClick={() => handleSelect(opt.value)}
              >
                <div className="reasoning-option-top">
                  <span className="reasoning-option-name">{opt.label}</span>
                  {opt.badge && <span className="reasoning-option-badge">{opt.badge}</span>}
                  {isSelected && <Check size={14} className="reasoning-check text-green" />}
                </div>
                <div className="reasoning-option-hint">{opt.hint}</div>
              </button>
            )
          })}
        </div>
      </DropdownPortal>
    </div>
  )
}

export default ReasoningEffortControl
