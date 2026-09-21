import { useState } from 'react'
import { CheckCircle2, Key, LoaderCircle, Plus, Radio, WandSparkles, XCircle } from 'lucide-react'
import type { ModelDiscoveryCandidate } from '../../shared/contracts/models'
import type { ModelKind, ModelProfile, ProviderConnection, SaveModelProfileInput, TestConnectionResult } from '../../shared/contracts/settings'
import { getTextApi } from './model-api'
import { ManualModelForm, ModelImportDialog, ModelRows } from './ModelRows'

export function KeyCard({
  connection,
  models,
  defaultTextModelId,
  defaultImageModelId,
  onTest,
  onEdit,
  onDelete,
  onSaveModel,
  onSaveModels,
  onDeleteModel,
  onSetDefault,
}: {
  connection: ProviderConnection
  models: ModelProfile[]
  defaultTextModelId?: string
  defaultImageModelId?: string
  onTest: (connection: ProviderConnection) => Promise<TestConnectionResult>
  onEdit: (connection: ProviderConnection) => void
  onDelete: (connection: ProviderConnection) => void
  onSaveModel: (input: SaveModelProfileInput) => Promise<void>
  onSaveModels: (inputs: SaveModelProfileInput[]) => Promise<void>
  onDeleteModel: (id: string, name: string) => Promise<void>
  onSetDefault: (id: string, kind: ModelKind) => Promise<void>
}): React.ReactElement {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null)
  const [discovering, setDiscovering] = useState(false)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discoverEmpty, setDiscoverEmpty] = useState(false)
  const [candidates, setCandidates] = useState<ModelDiscoveryCandidate[]>([])
  const [nextPageToken, setNextPageToken] = useState<string | undefined>()
  const [importOpen, setImportOpen] = useState(false)
  const [manualModelOpen, setManualModelOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<{ id: string; modelId: string; name: string; kind: ModelKind; capabilities?: string[] } | null>(null)

  const boundModels = models.filter((m) => m.connectionId === connection.id)
  const textCount = boundModels.filter((m) => m.kind === 'text').length
  const imageCount = boundModels.filter((m) => m.kind === 'image').length

  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const result = await onTest(connection)
      setTestResult(result)
    } catch (cause) {
      setTestResult({
        ok: false,
        message: cause instanceof Error ? cause.message : '连接测试失败',
      })
    } finally {
      setTesting(false)
    }
  }

  const handleDiscover = async (pageToken?: string) => {
    setDiscovering(true)
    setDiscoverError(null)
    if (!pageToken) setDiscoverEmpty(false)
    try {
      const result = await getTextApi().discoverModels({ connectionId: connection.id, ...(pageToken ? { pageToken } : {}) })
      setCandidates((current) => {
        const merged = pageToken ? [...current, ...result.models] : [...result.models]
        return [...new Map(merged.map((candidate) => [candidate.id, candidate])).values()]
      })
      setNextPageToken(result.nextPageToken)
      setDiscoverEmpty(!pageToken && result.models.length === 0)
      if (result.models.length > 0 || pageToken) setImportOpen(true)
    } catch (cause) {
      setDiscoverError(cause instanceof Error ? cause.message : '获取模型列表失败')
    } finally {
      setDiscovering(false)
    }
  }

  const handleSaveBatch = async (inputs: SaveModelProfileInput[]) => {
    await onSaveModels(inputs)
    const savedIds = new Set(inputs.map((i) => i.modelId))
    setCandidates((prev) => prev.filter((c) => !savedIds.has(c.id)))
  }

  return (
    <div className="settings-key-card">
      <div className="key-card-head">
        <div className="key-card-title-block">
          <div className="key-card-icon-title">
            <Key size={16} className="key-card-icon" />
            <strong className="key-card-name">{connection.name}</strong>
            <span className={`pill ${connection.hasApiKey ? 'green' : ''}`}>
              {connection.hasApiKey ? '已配置密钥' : '未配置密钥'}
            </span>
          </div>
          <div className="key-card-meta">
            <span>Base URL: <code>{connection.baseUrl}</code></span>
            <span>并发限制: {connection.maxConcurrency}</span>
          </div>
        </div>

        <div className="key-card-actions">
          <button
            type="button"
            className="secondary small"
            onClick={() => void handleTest()}
            disabled={testing}
          >
            {testing ? <LoaderCircle size={13} className="spin" /> : <Radio size={13} />}
            {testing ? '测试中…' : '测试连接'}
          </button>
          <button type="button" className="secondary small" onClick={() => onEdit(connection)}>
            编辑 Key
          </button>
          <button type="button" className="secondary small danger" onClick={() => onDelete(connection)}>
            删除 Key
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`connection-test-result banner ${testResult.ok ? 'success' : 'error'}`}>
          {testResult.ok ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{testResult.message}</span>
        </div>
      )}

      <div className="key-card-models-section">
        <div className="key-card-models-head">
          <div className="key-card-models-title">
            <strong>专属绑定模型</strong>
            <span className="settings-kind-note">文本 {textCount} · 图片 {imageCount}</span>
          </div>
          <div className="key-card-models-actions">
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                if (candidates.length > 0) setImportOpen(true)
                else void handleDiscover()
              }}
              disabled={discovering || !connection.hasApiKey}
            >
              <WandSparkles size={13} />
              {discovering ? '获取中…' : candidates.length > 0 ? `继续导入 (${candidates.length})` : '获取模型列表'}
            </button>
            <button
              type="button"
              className="secondary small"
              onClick={() => {
                setEditingModel(null)
                setManualModelOpen((prev) => !prev)
              }}
            >
              <Plus size={13} />
              手动添加模型
            </button>
          </div>
        </div>

        {discoverError && <div className="start-state error"><span>{discoverError}</span></div>}
        {discoverEmpty && <div className="connection-test-result banner"><span>连接成功，但供应商没有返回可导入的模型。可尝试手动添加。</span></div>}

        {candidates.length > 0 && (
          <ModelImportDialog
            open={importOpen}
            onOpenChange={setImportOpen}
            connectionName={connection.name}
            candidates={candidates}
            connectionId={connection.id}
            onSave={async (input) => {
              await onSaveModel(input)
              setCandidates((prev) => prev.filter((c) => c.id !== input.modelId))
            }}
            onSaveBatch={handleSaveBatch}
            onLoadMore={nextPageToken ? () => handleDiscover(nextPageToken) : undefined}
            loadingMore={discovering}
          />
        )}

        {manualModelOpen && (
          <ManualModelForm
            connectionId={connection.id}
            model={editingModel}
            onSave={async (input) => {
              await onSaveModel(input)
              setEditingModel(null)
              setManualModelOpen(false)
            }}
            onSaveBatch={async (inputs) => {
              await onSaveModels(inputs)
              setEditingModel(null)
              setManualModelOpen(false)
            }}
            onCancel={() => {
              setEditingModel(null)
              setManualModelOpen(false)
            }}
          />
        )}

        <ModelRows
          connectionId={connection.id}
          models={models}
          defaultTextModelId={defaultTextModelId}
          defaultImageModelId={defaultImageModelId}
          onEdit={(model) => {
            setEditingModel(model)
            setManualModelOpen(true)
          }}
          onDelete={onDeleteModel}
          onSetDefault={onSetDefault}
        />
      </div>
    </div>
  )
}
