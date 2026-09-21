import { useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Bot, ChevronDown, ImagePlus } from 'lucide-react'
import type { GlobalSettings, ModelProfile } from '../../shared/contracts/settings'
import { compactModelName, getModelChannelInfo } from '../../renderer/settings/model-channel'
import type { TextReasoningEffort } from '../../shared/contracts/text'
import { getSupportedReasoningEfforts, REASONING_EFFORT_LABELS } from '../../shared/models/reasoning'
import { DropdownPortal } from './DropdownPortal'
import { ProviderModelPicker } from './ProviderModelPicker'

export const REASONING_PILL_OPTIONS: Array<{ value: TextReasoningEffort; label: string }> = [
  { value: 'auto', label: '自动' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '极高' },
]

export interface ModelDropdownProps {
  kind: string
  name: string
  models: ModelProfile[]
  settings?: GlobalSettings | null
  value?: string
  onChange: (id: string) => void
  reasoningEffort?: TextReasoningEffort
  onChangeReasoningEffort?: (effort: TextReasoningEffort) => void
}

export function ModelDropdown({
  kind,
  name,
  models,
  settings,
  value,
  onChange,
  reasoningEffort,
  onChangeReasoningEffort,
}: ModelDropdownProps): React.ReactElement {
  const [open, setOpen] = useState(false)

  const currentModel = models.find((m) => m.id === value)
  const channel = currentModel ? getModelChannelInfo(currentModel, settings) : null
  const connection = settings?.connections.find((item) => item.id === currentModel?.connectionId)
  const supportedEfforts = currentModel && connection?.providerType !== 'openai-compatible'
    ? getSupportedReasoningEfforts({ modelId: currentModel.modelId, capabilities: currentModel.capabilities, providerType: connection?.providerType }).supported
    : REASONING_PILL_OPTIONS.map((option) => option.value)
  const effortLabel = reasoningEffort ? (REASONING_EFFORT_LABELS[reasoningEffort] ?? '自动') : ''
  const tipLabel = currentModel
    ? `${kind}：${currentModel.name}（渠道：${channel?.channelLabel}）${effortLabel ? ` · 思考强度：${effortLabel}` : ''}`
    : `${kind}：${name}`
  const isImage = kind.includes('图')
  const displayName = currentModel ? compactModelName(currentModel.name, isImage ? 'image' : 'text') : name

  return (
    <DropdownPortal
      open={open}
      onOpenChange={setOpen}
      className="model-dropdown__menu"
      width={340}
      trigger={(ref) => (
        <div ref={ref}>
          <Tooltip.Root delayDuration={220}>
            <Tooltip.Trigger asChild>
              <button
                type="button"
                className={`composer-model-capsule model-dropdown-trigger ${open ? 'open' : ''}`}
                aria-label={tipLabel}
                aria-expanded={open}
                onClick={() => setOpen((prev) => !prev)}
              >
                {isImage ? <ImagePlus size={13} className="capsule-icon" /> : <Bot size={13} className="capsule-icon" />}
                <span className="capsule-label">{displayName}</span>
                <ChevronDown size={11} className="capsule-chevron" />
              </button>
            </Tooltip.Trigger>
            <Tooltip.Portal>
              <Tooltip.Content className="tooltip" side="top" sideOffset={7}>
                {tipLabel}
              </Tooltip.Content>
            </Tooltip.Portal>
          </Tooltip.Root>
        </div>
      )}
    >
      <div className="model-dropdown-header">
        <div className="model-dropdown-header-left">
          {isImage ? <ImagePlus size={13} /> : <Bot size={13} />}
          <span>{kind}选择</span>
        </div>
        <span className="model-dropdown-count-badge">共 {models.length} 个模型</span>
      </div>

      {onChangeReasoningEffort && (
        <div className="model-dropdown-reasoning-section">
          <div className="model-dropdown-reasoning-head">
            <span className="model-dropdown-reasoning-title">思考推理强度</span>
            <span className="model-dropdown-reasoning-hint">当前：{effortLabel || '自动'}</span>
          </div>
          <div className="model-dropdown-reasoning-pills" role="radiogroup" aria-label="思考推理强度">
            {REASONING_PILL_OPTIONS.filter((option) => supportedEfforts.includes(option.value)).map((opt) => {
              const active = (reasoningEffort ?? 'auto') === opt.value
              return (
                <button
                  type="button"
                  key={opt.value}
                  role="radio"
                  aria-checked={active}
                  className={`model-reasoning-pill ${active ? 'active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChangeReasoningEffort(opt.value)
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <ProviderModelPicker
        models={models}
        settings={settings}
        value={value}
        ariaLabel={`选择${kind}`}
        onSelect={(id) => { onChange(id); setOpen(false) }}
      />
    </DropdownPortal>
  )
}
