import type { GlobalSettings, ModelProfile } from '../../shared/contracts/settings'

export interface ModelChannelInfo {
  groupName: string
  connectionName: string
  channelLabel: string
  providerType?: string
  displayName: string
}

export interface ModelChannelGroup {
  channelKey: string
  groupName: string
  connectionName: string
  channelLabel: string
  models: ModelProfile[]
}

export interface ProviderModelChoice extends ModelProfile {
  connectionName: string
}

export interface ProviderModelGroup {
  providerId: string
  providerName: string
  models: ProviderModelChoice[]
}

/**
 * 根据 model.connectionId 在 settings 中解析对应的供应商分组与 Key 连接渠道信息
 */
export function getModelChannelInfo(
  model: ModelProfile,
  settings?: GlobalSettings | null
): ModelChannelInfo {
  if (!settings) {
    return {
      groupName: '默认分组',
      connectionName: '默认连接',
      channelLabel: '默认渠道',
      displayName: model.name,
    }
  }

  const connection = settings.connections.find((c) => c.id === model.connectionId)
  const group = connection ? settings.groups.find((g) => g.id === connection.groupId) : undefined

  const groupName = group?.name || connection?.groupName || '未归类分组'
  const connectionName = connection?.name || '未知 Key'
  const channelLabel = `${groupName} · ${connectionName}`
  const displayName = `${model.name} (${groupName})`

  return {
    groupName,
    connectionName,
    channelLabel,
    providerType: connection?.providerType || group?.providerType,
    displayName,
  }
}

/**
 * 将模型列表按照“供应商分组 · Key 连接渠道”组织为层级结构，方便在下拉菜单（optgroup）中渲染
 */
export function groupModelsByChannel(
  models: ModelProfile[],
  settings?: GlobalSettings | null
): ModelChannelGroup[] {
  const groupsMap = new Map<string, ModelChannelGroup>()

  for (const model of models) {
    const channel = getModelChannelInfo(model, settings)
    const channelKey = model.connectionId || 'default'

    if (!groupsMap.has(channelKey)) {
      groupsMap.set(channelKey, {
        channelKey,
        groupName: channel.groupName,
        connectionName: channel.connectionName,
        channelLabel: channel.channelLabel,
        models: [],
      })
    }

    groupsMap.get(channelKey)!.models.push(model)
  }

  return Array.from(groupsMap.values())
}

export function groupModelsByProvider(
  models: ModelProfile[],
  settings?: GlobalSettings | null,
): ProviderModelGroup[] {
  const grouped = new Map<string, ProviderModelGroup>()

  for (const model of models) {
    const connection = settings?.connections.find((item) => item.id === model.connectionId)
    const provider = connection
      ? settings?.groups.find((item) => item.id === connection.groupId)
      : undefined
    const providerId = provider?.id ?? connection?.groupId ?? `unassigned:${model.connectionId}`
    const providerName = provider?.name ?? connection?.groupName ?? '未归类供应商'
    const current = grouped.get(providerId) ?? { providerId, providerName, models: [] }
    current.models.push({ ...model, connectionName: connection?.name ?? '未知连接' })
    grouped.set(providerId, current)
  }

  return [...grouped.values()]
}

/**
 * 格式化模型触发按钮 / 胶囊上的简短标签，附带渠道简称，如 "gpt-4o · 硅基流动"
 */
export function formatModelCapsuleLabel(
  model: ModelProfile | undefined,
  settings?: GlobalSettings | null,
  fallback = '未选模型'
): string {
  if (!model) return fallback
  const channel = getModelChannelInfo(model, settings)
  return `${model.name} · ${channel.groupName}`
}

export function compactModelName(name: string, kind: 'text' | 'image' = 'text'): string {
  const trimmed = name.trim()
  if (!trimmed) return kind === 'image' ? '图片模型' : '文本模型'
  const withoutVendor = kind === 'image'
    ? trimmed.replace(/^(?:openai\s+)?gpt[\s-]+image[\s-]*/i, '')
    : trimmed.replace(/^(?:openai\s+)?gpt[\s-]+/i, '').replace(/^(?:anthropic\s+)?claude[\s-]+/i, '')
  const normalized = (withoutVendor || trimmed).replace(/([\d.])-(?=[a-z])/gi, '$1 ').replace(/\s+/g, ' ').trim()
  return normalized.replace(/\b(sol|pro|max|mini|nano)\b/gi, (value) => `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}`)
}
