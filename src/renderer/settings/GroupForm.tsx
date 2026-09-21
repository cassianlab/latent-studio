import { useState } from 'react'
import { LoaderCircle, Save } from 'lucide-react'
import type { ProviderGroup, ProviderType, SaveProviderGroupInput } from '../../shared/contracts/settings'
import { defaultBaseUrls, providerLabels } from './ConnectionForm'

export function GroupForm({
  group,
  onSave,
  onCancel,
}: {
  group: ProviderGroup | null
  onSave: (input: SaveProviderGroupInput) => Promise<void>
  onCancel: () => void
}): React.ReactElement {
  const [name, setName] = useState(group?.name ?? '')
  const [providerType, setProviderType] = useState<ProviderType>(group?.providerType ?? 'openai-compatible')
  const [baseUrl, setBaseUrl] = useState(group?.baseUrl ?? defaultBaseUrls[group?.providerType ?? 'openai-compatible'] ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleProviderChange = (type: ProviderType) => {
    setProviderType(type)
    if (!group) {
      setBaseUrl(defaultBaseUrls[type] ?? '')
      if (!name || Object.values(providerLabels).some((label) => name.startsWith(label))) {
        setName(providerLabels[type])
      }
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim()) {
      setError('请输入供应商分组名称')
      return
    }
    if (!baseUrl.trim()) {
      setError('请输入默认 Base URL')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: group?.id,
        name: name.trim(),
        providerType,
        baseUrl: baseUrl.trim(),
      })
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存分组失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="settings-editor" onSubmit={submit}>
      <div className="section-heading-inner">
        <h3>{group ? '编辑供应商分组' : '新建供应商分组'}</h3>
        <p>创建供应商后，可在该分组内添加多个不同的 API Key（如文本系列、生图系列），并绑定对应模型。</p>
      </div>

      <div className="form-grid">
        <label>
          服务商协议类型
          <select value={providerType} onChange={(e) => handleProviderChange(e.target.value as ProviderType)}>
            {Object.entries(providerLabels).map(([value, label]) => (
              <option value={value} key={value}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          分组名称（如“硅基流动”、“OpenAI 官方”）
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：硅基流动"
            maxLength={80}
            required
          />
        </label>
        <label className="wide">
          默认 Base URL
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://..."
            required
          />
        </label>
      </div>

      {error && <div className="start-state error"><span>{error}</span></div>}

      <footer>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
        <button type="submit" className="primary" disabled={saving}>
          {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
          {group ? '保存修改' : '创建供应商分组'}
        </button>
      </footer>
    </form>
  )
}
