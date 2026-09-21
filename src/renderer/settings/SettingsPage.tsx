import { useMemo, useState } from 'react'
import {
  ArrowLeft, LoaderCircle,
  Plus, RefreshCw, Server, Trash2
} from 'lucide-react'
import type { ModelKind, ProviderConnection, ProviderGroup } from '../../shared/contracts/settings'
import { useSettings } from './use-settings'
import { ConnectionForm, providerLabels } from './ConnectionForm'
import { GroupForm } from './GroupForm'
import { KeyCard } from './KeyCard'
import { getModelChannelInfo } from './model-channel'
import { WindowCloseSettings } from './WindowCloseSettings'
import './settings.css'

export function SettingsPage({
  onOpenProjectSettings,
}: {
  onOpenProjectSettings?: () => void
}) {
  const state = useSettings()
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null)
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<string>>(new Set())
  const [editingGroup, setEditingGroup] = useState<ProviderGroup | null | undefined>(undefined)
  const [editingConnection, setEditingConnection] = useState<ProviderConnection | null | undefined>(undefined)

  const groups = state.settings?.groups ?? []
  const connections = state.settings?.connections ?? []
  const allModels = state.settings?.models ?? []

  const selectedGroup = useMemo(() => {
    if (!groups.length) return null
    return groups.find((g) => g.id === (selectedGroupId ?? groups[0]?.id)) ?? groups[0] ?? null
  }, [groups, selectedGroupId])

  if (state.loading) {
    return (
      <div className="content-page settings-page">
        <div className="start-state">
          <LoaderCircle size={17} className="spin" />
          正在读取供应商与模型设置…
        </div>
      </div>
    )
  }

  if (state.error || !state.settings) {
    return (
      <div className="content-page settings-page">
        <div className="start-state error">
          <span>{state.error ?? '无法读取模型设置'}</span>
          <button className="icon-button" onClick={() => void state.reload()} aria-label="重试">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
    )
  }

  const handleBatchDeleteGroups = async () => {
    const count = selectedGroupIds.size
    if (count === 0) return
    const names = groups.filter((g) => selectedGroupIds.has(g.id)).map((g) => `「${g.name}」`).join('、')
    const prompt = `确定要批量删除以下 ${count} 个供应商分组吗？\n${names}\n\n注意：这些分组下的所有 Key 及其绑定的全部模型配置也将一并删除！`
    if (window.confirm(prompt)) {
      for (const id of selectedGroupIds) {
        await state.deleteGroup(id)
      }
      setSelectedGroupIds(new Set())
      if (selectedGroupId && selectedGroupIds.has(selectedGroupId)) {
        setSelectedGroupId(null)
      }
    }
  }

  const toggleGroupSelection = (id: string) => {
    setSelectedGroupIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleDeleteGroup = async (group: ProviderGroup) => {
    const keyCount = connections.filter((c) => c.groupId === group.id).length
    const prompt = keyCount > 0
      ? `确定要删除供应商分组“${group.name}”吗？该分组下的 ${keyCount} 个 Key 及其全部模型配置也将一并删除。`
      : `确定要删除供应商分组“${group.name}”吗？`
    if (window.confirm(prompt)) {
      await state.deleteGroup(group.id)
      setSelectedGroupId(null)
      setSelectedGroupIds((prev) => {
        const next = new Set(prev)
        next.delete(group.id)
        return next
      })
    }
  }

  const handleDeleteConnection = async (conn: ProviderConnection) => {
    const boundModels = allModels.filter((m) => m.connectionId === conn.id)
    const isDefault = boundModels.some((m) => m.id === state.settings?.defaultTextModelId || m.id === state.settings?.defaultImageModelId)
    const defaultWarning = isDefault ? '\n⚠️ 警告：该 Key 包含当前设为默认的模型，删除后默认模型将被清除！' : ''
    const msg = boundModels.length > 0
      ? `确定要删除 Key “${conn.name}”吗？该 Key 绑定的 ${boundModels.length} 个模型配置也将被移除。${defaultWarning}`
      : `确定要删除 Key “${conn.name}”吗？`
    if (window.confirm(msg)) {
      await state.deleteConnection(conn.id)
    }
  }

  const handleDeleteModel = async (id: string, name: string) => {
    if (window.confirm(`确定要删除模型“${name}”吗？`)) {
      await state.deleteModel(id)
    }
  }

  const handleSetDefault = async (id: string, kind: ModelKind) => {
    if (kind === 'text') {
      await state.setDefaults({ textModelId: id })
    } else {
      await state.setDefaults({ imageModelId: id })
    }
  }

  const selectedGroupConnections = selectedGroup
    ? connections.filter((c) => c.groupId === selectedGroup.id)
    : []

  const defaultTextModel = allModels.find((m) => m.id === state.settings?.defaultTextModelId && m.kind === 'text')
  const defaultImageModel = allModels.find((m) => m.id === state.settings?.defaultImageModelId && m.kind === 'image')
  const textChannel = defaultTextModel ? getModelChannelInfo(defaultTextModel, state.settings) : null
  const imageChannel = defaultImageModel ? getModelChannelInfo(defaultImageModel, state.settings) : null

  return (
    <div className="content-page settings-page">
      <div className="section-heading">
        <div>
          <h2>全局模型与供应商设置</h2>
          <p>按供应商分组管理不同的 API Key（如文本系列、生图系列），每个 Key 可独立测试连接并绑定对应模型。</p>
        </div>
        <div className="settings-head-actions">
          {onOpenProjectSettings && (
            <button type="button" className="secondary small" onClick={onOpenProjectSettings}>
              <ArrowLeft size={14} /> 查看当前项目设置
            </button>
          )}
          <button
            className="primary small"
            onClick={() => {
              setEditingGroup(null)
              setEditingConnection(undefined)
            }}
          >
            <Plus size={15} />新建供应商分组
          </button>
        </div>
      </div>

      <div className="project-settings-tabs-nav">
        {onOpenProjectSettings && (
          <button type="button" className="project-settings-tab link" onClick={onOpenProjectSettings}>
            ← 当前项目设置
          </button>
        )}
        <span className="project-settings-tab active">全局供应商与多 Key 模型配置</span>
      </div>

      <WindowCloseSettings />

      <div className="settings-grid">
        <aside className="settings-sidebar-grouped">
          <div className="settings-sidebar-header">
            <label className="settings-select-all-label" title={selectedGroupIds.size > 0 ? '取消选择' : '全选供应商分组'}>
              <input
                type="checkbox"
                checked={groups.length > 0 && selectedGroupIds.size === groups.length}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedGroupIds(new Set(groups.map((g) => g.id)))
                  } else {
                    setSelectedGroupIds(new Set())
                  }
                }}
                disabled={groups.length === 0}
              />
              <strong className="settings-nav-title">
                {selectedGroupIds.size > 0 ? `已选 ${selectedGroupIds.size}/${groups.length}` : `供应商分组 (${groups.length})`}
              </strong>
            </label>
            {selectedGroupIds.size > 0 ? (
              <button
                type="button"
                className="secondary small danger"
                onClick={() => void handleBatchDeleteGroups()}
                title="批量删除选中的供应商分组"
              >
                <Trash2 size={12} />
                <span>删除</span>
              </button>
            ) : (
              <button
                type="button"
                className="settings-new-group-btn"
                onClick={() => {
                  setEditingGroup(null)
                  setEditingConnection(undefined)
                }}
                title="新建供应商分组"
              >
                <Plus size={13} />
                <span>新建</span>
              </button>
            )}
          </div>

          <div className="settings-group-list">
            {groups.map((group) => {
              const groupKeys = connections.filter((c) => c.groupId === group.id)
              const groupKeyIds = new Set(groupKeys.map((c) => c.id))
              const groupModelCount = allModels.filter((m) => groupKeyIds.has(m.connectionId)).length
              const isActive = selectedGroup?.id === group.id && editingGroup === undefined && editingConnection === undefined

              return (
                <div
                  key={group.id}
                  className={`provider-group-nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedGroupId(group.id)
                    setEditingGroup(undefined)
                    setEditingConnection(undefined)
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setSelectedGroupId(group.id)
                      setEditingGroup(undefined)
                      setEditingConnection(undefined)
                    }
                  }}
                >
                  <div className="group-nav-select">
                    <input
                      type="checkbox"
                      className="group-select-checkbox"
                      checked={selectedGroupIds.has(group.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        e.stopPropagation()
                        toggleGroupSelection(group.id)
                      }}
                      title="选择该分组"
                    />
                  </div>
                  <div className="group-nav-icon">
                    {group.name.slice(0, 1)}
                  </div>
                  <div className="group-nav-info">
                    <span className="group-nav-name">{group.name}</span>
                    <span className="group-nav-provider">{providerLabels[group.providerType] || group.providerType}</span>
                  </div>
                  <div className="group-nav-meta">
                    <span className="group-nav-keys-count">{groupKeys.length} 个 Key</span>
                    <span className="group-nav-models-count">{groupModelCount} 模型</span>
                  </div>
                </div>
              )
            })}
          </div>

          {groups.length === 0 && (
            <div className="settings-empty-sidebar">
              <Server size={24} style={{ opacity: 0.4, marginBottom: 8 }} />
              <p>暂无供应商分组</p>
              <small>点击上方“+”按钮创建第一个供应商</small>
            </div>
          )}
        </aside>

        <main>
          {editingGroup !== undefined ? (
            <GroupForm
              group={editingGroup}
              onSave={async (input) => {
                await state.saveGroup(input)
                setEditingGroup(undefined)
              }}
              onCancel={() => setEditingGroup(undefined)}
            />
          ) : editingConnection !== undefined && selectedGroup ? (
            <ConnectionForm
              group={selectedGroup}
              connection={editingConnection}
              onSave={async (input) => {
                await state.saveConnection(input)
                setEditingConnection(undefined)
              }}
              onTest={state.testConnection}
              onCancel={() => setEditingConnection(undefined)}
            />
          ) : selectedGroup ? (
            <>
              {(defaultTextModel || defaultImageModel) && (
                <div className="defaults-channel-banner">
                  <span className="defaults-channel-item">
                    默认文本渠道：
                    {defaultTextModel ? (
                      <strong>
                        {defaultTextModel.name}
                        <span className="channel-tag-badge">{textChannel?.channelLabel}</span>
                      </strong>
                    ) : (
                      <span className="muted">未设置</span>
                    )}
                  </span>
                  <span className="defaults-channel-item">
                    默认生图渠道：
                    {defaultImageModel ? (
                      <strong>
                        {defaultImageModel.name}
                        <span className="channel-tag-badge">{imageChannel?.channelLabel}</span>
                      </strong>
                    ) : (
                      <span className="muted">未设置</span>
                    )}
                  </span>
                </div>
              )}
              <div className="connection-head">
                <div className="group-head-summary">
                  <span className="provider-logo">{selectedGroup.name.slice(0, 1)}</span>
                  <span>
                    <strong>{selectedGroup.name}</strong>
                    <small>协议: {providerLabels[selectedGroup.providerType]} · 默认 URL: {selectedGroup.baseUrl}</small>
                  </span>
                </div>
                <div className="connection-actions">
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => setEditingConnection(null)}
                  >
                    <Plus size={14} /> 添加 Key
                  </button>
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => setEditingGroup(selectedGroup)}
                  >
                    编辑分组
                  </button>
                  <button
                    type="button"
                    className="secondary small danger"
                    onClick={() => void handleDeleteGroup(selectedGroup)}
                  >
                    删除分组
                  </button>
                </div>
              </div>

              <div className="group-keys-container">
                {selectedGroupConnections.length === 0 ? (
                  <div className="group-empty-keys">
                    <p><strong>「{selectedGroup.name}」下尚未添加 API Key</strong></p>
                    <p>一个供应商分组支持添加多个不同的 Key（例如配置文本系列专用 Key 与生图系列专用 Key），互不干扰独立测速并绑定各自模型。</p>
                    <button
                      type="button"
                      className="primary small"
                      onClick={() => setEditingConnection(null)}
                    >
                      <Plus size={14} /> 添加第一个 Key
                    </button>
                  </div>
                ) : (
                  <div className="group-keys-list">
                    {selectedGroupConnections.map((conn) => (
                      <KeyCard
                        key={conn.id}
                        connection={conn}
                        models={allModels}
                        defaultTextModelId={state.settings?.defaultTextModelId}
                        defaultImageModelId={state.settings?.defaultImageModelId}
                        onTest={(c) => state.testConnection({
                          connectionId: c.id,
                          providerType: c.providerType,
                          baseUrl: c.baseUrl,
                        })}
                        onEdit={(c) => setEditingConnection(c)}
                        onDelete={handleDeleteConnection}
                        onSaveModel={state.saveModel}
                        onSaveModels={state.saveModels}
                        onDeleteModel={handleDeleteModel}
                        onSetDefault={handleSetDefault}
                      />
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="settings-empty">请在左侧选择或新建一个供应商分组。</div>
          )}
        </main>
      </div>
    </div>
  )
}

export default SettingsPage
