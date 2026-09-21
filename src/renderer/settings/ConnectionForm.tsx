import { useState } from 'react'
import { CheckCircle2, LoaderCircle, Radio, Save, XCircle } from 'lucide-react'
import type { ProviderConnection, ProviderGroup, ProviderType, SaveProviderConnectionInput, TestConnectionInput, TestConnectionResult } from '../../shared/contracts/settings'

export const providerLabels: Record<ProviderType, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  glm: 'GLM (智谱)',
  kimi: 'Kimi (Moonshot)',
  'openai-compatible': 'OpenAI 兼容协议 / 硅基流动',
}

export const defaultBaseUrls: Record<ProviderType, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  gemini: 'https://generativelanguage.googleapis.com',
  deepseek: 'https://api.deepseek.com/v1',
  glm: 'https://open.bigmodel.cn/api/paas/v4',
  kimi: 'https://api.moonshot.cn/v1',
  'openai-compatible': 'https://api.siliconflow.cn/v1',
}

export function ConnectionForm({
  group,
  connection,
  onSave,
  onTest,
  onCancel,
}: {
  group: ProviderGroup
  connection: ProviderConnection | null
  onSave: (input: SaveProviderConnectionInput) => Promise<void>
  onTest: (input: TestConnectionInput) => Promise<TestConnectionResult>
  onCancel: () => void
}): React.ReactElement {
  const [name, setName] = useState(connection?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(connection?.baseUrl ?? group.baseUrl)
  const [apiKey, setApiKey] = useState('')
  const [maxConcurrency, setMaxConcurrency] = useState(String(connection?.maxConcurrency ?? 1))
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleTest = async () => {
    if (!baseUrl.trim()) {
      setError('请输入 Base URL')
      return
    }
    if (!connection?.hasApiKey && !apiKey.trim()) {
      setError('请输入 API Key 后再测试连接')
      return
    }
    setTesting(true)
    setError(null)
    setTestResult(null)
    try {
      const result = await onTest({
        connectionId: connection?.id,
        providerType: group.providerType,
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      setTestResult(result)
    } catch (cause) {
      setTestResult({
        ok: false,
        message: cause instanceof Error ? cause.message : '连接测试异常',
      })
    } finally {
      setTesting(false)
    }
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await onSave({
        id: connection?.id,
        groupId: group.id,
        name: name.trim() || `${group.name} Key`,
        providerType: group.providerType,
        baseUrl: baseUrl.trim(),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        maxConcurrency: Number(maxConcurrency),
      })
      onCancel()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Key 保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="settings-editor" onSubmit={submit}>
      <div className="section-heading-inner">
        <h3>{connection ? `编辑 Key：${connection.name}` : `在「${group.name}」中添加新 Key`}</h3>
        <p>为该 Key 配置专用的 API Key、Base URL 以及并发度。每个 Key 可以独立挂载绑定不同的模型。</p>
      </div>

      <div className="form-grid">
        <label>
          所属供应商
          <input value={`${group.name} (${providerLabels[group.providerType]})`} readOnly />
        </label>
        <label>
          Key 备注名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：文本模型系列 / 生图专用 Key"
            maxLength={160}
            required
          />
        </label>
        <label className="wide">
          Base URL（默认继承供应商，支持自定义）
          <input
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              if (testResult) setTestResult(null)
              if (error) setError(null)
            }}
            required
          />
        </label>
        <label>
          API Key {connection?.hasApiKey ? '（留空保持原密钥）' : ''}
          <input
            type="password"
            value={apiKey}
            onChange={(e) => {
              setApiKey(e.target.value)
              if (testResult) setTestResult(null)
              if (error) setError(null)
            }}
            placeholder={connection?.hasApiKey ? '已配置，留空保持不变' : '输入 API Key'}
            autoComplete="off"
            required={!connection?.hasApiKey}
          />
        </label>
        <label>
          最大并发
          <input
            type="number"
            min="1"
            max="64"
            value={maxConcurrency}
            onChange={(e) => setMaxConcurrency(e.target.value)}
            required
          />
        </label>
      </div>

      {testResult && (
        <div className={`connection-test-result banner ${testResult.ok ? 'success' : 'error'}`}>
          {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{testResult.message}</span>
        </div>
      )}

      {error && <div className="start-state error"><span>{error}</span></div>}

      <footer>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
        <button
          type="button"
          className="secondary"
          onClick={() => void handleTest()}
          disabled={testing || saving}
        >
          {testing ? <LoaderCircle size={15} className="spin" /> : <Radio size={15} />}
          {testing ? '正在测试…' : '测试此 Key 连接'}
        </button>
        <button type="submit" className="primary" disabled={saving || testing}>
          {saving ? <LoaderCircle size={15} className="spin" /> : <Save size={15} />}
          {connection ? '保存 Key 修改' : '添加 Key'}
        </button>
      </footer>
    </form>
  )
}
