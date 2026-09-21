import { useEffect, useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { GlobalSettings, ModelProfile } from '../../shared/contracts/settings'
import { groupModelsByProvider } from '../../renderer/settings/model-channel'
import './provider-model-picker.css'

export function resolveProviderSelection(
  providerIds: string[],
  currentProviderId: string,
  selectedProviderId?: string,
): string {
  if (providerIds.includes(currentProviderId)) return currentProviderId
  return selectedProviderId ?? providerIds[0] ?? ''
}

export function ProviderModelPicker({
  models,
  settings,
  value,
  onSelect,
  ariaLabel,
}: {
  models: ModelProfile[]
  settings?: GlobalSettings | null
  value?: string | null
  onSelect: (id: string) => void
  ariaLabel: string
}) {
  const providerGroups = useMemo(() => groupModelsByProvider(models, settings), [models, settings])
  const selectedProviderId = providerGroups.find((group) => group.models.some((model) => model.id === value))?.providerId
  const [providerId, setProviderId] = useState(selectedProviderId ?? providerGroups[0]?.providerId ?? '')
  const [connectionName, setConnectionName] = useState('')

  useEffect(() => {
    setProviderId((current) => resolveProviderSelection(
      providerGroups.map((group) => group.providerId),
      current,
      selectedProviderId,
    ))
  }, [providerGroups, selectedProviderId])

  const activeGroup = providerGroups.find((group) => group.providerId === providerId)
  const connections = [...new Set((activeGroup?.models ?? []).map((model) => model.connectionName))]
  const visibleModels = (activeGroup?.models ?? []).filter((model) => !connectionName || model.connectionName === connectionName)

  if (providerGroups.length === 0) {
    return <div className="provider-model-picker-empty">暂无可用模型，请先在设置中添加。</div>
  }

  return (
    <div className="provider-model-picker" aria-label={ariaLabel}>
      <div className="provider-model-picker__providers" role="group" aria-label="选择供应商">
        {providerGroups.map((group) => (
          <button
            type="button"
            key={group.providerId}
            className={group.providerId === providerId ? 'active' : ''}
            aria-pressed={group.providerId === providerId}
            onClick={() => {
              setProviderId(group.providerId)
              setConnectionName('')
            }}
          >
            <span>{group.providerName}</span>
            <small>{group.models.length}</small>
          </button>
        ))}
      </div>
      <section className="provider-model-picker__models">
        {connections.length > 1 && (
          <div className="provider-model-picker__tools">
            <select value={connectionName} onChange={(event) => setConnectionName(event.target.value)} aria-label="筛选连接">
              <option value="">全部连接</option>
              {connections.map((name) => <option value={name} key={name}>{name}</option>)}
            </select>
          </div>
        )}
        <div className="provider-model-picker__list" role="listbox" aria-label={ariaLabel}>
          {visibleModels.map((model) => {
            const selected = model.id === value
            return (
              <button
                type="button"
                role="option"
                aria-selected={selected}
                key={model.id}
                className={selected ? 'selected' : ''}
                onClick={() => onSelect(model.id)}
              >
                <span>
                  <strong>{model.name}</strong>
                  <small>{model.modelId}<i />{model.connectionName}</small>
                </span>
                {selected && <Check size={15} aria-label="已选择" />}
              </button>
            )
          })}
          {visibleModels.length === 0 && <div className="provider-model-picker-empty">当前供应商没有匹配的模型</div>}
        </div>
      </section>
    </div>
  )
}
