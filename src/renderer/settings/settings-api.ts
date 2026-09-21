import type { GlobalSettings, SettingsApi } from '../../shared/contracts/settings'

const mockSettings: GlobalSettings = {
  groups: [{ id: 'mock-group', name: '演示供应商', providerType: 'openai-compatible', baseUrl: 'https://api.example.local/v1', createdAt: '', updatedAt: '' }],
  connections: [{ id: 'mock-connection', groupId: 'mock-group', name: '默认密钥 Key 1', providerType: 'openai-compatible', baseUrl: 'https://api.example.local/v1', hasApiKey: true, maxConcurrency: 3, createdAt: '', updatedAt: '' }],
  models: [
    { id: 'mock-text', connectionId: 'mock-connection', modelId: 'claude-sonnet-4', name: 'Claude Sonnet 4', kind: 'text', capabilities: ['streaming', 'search'], createdAt: '', updatedAt: '' },
    { id: 'mock-image', connectionId: 'mock-connection', modelId: 'gpt-image-2.5-sunburst', name: 'GPT Image 2.5 Sunburst', kind: 'image', capabilities: ['reference-image', 'multi-reference'], createdAt: '', updatedAt: '' },
  ],
}

const mockApi: SettingsApi = {
  async get() { return structuredClone(mockSettings) },
  async saveGroup(input) {
    const group = { id: input.id ?? `mock-group-${Date.now()}`, name: input.name, providerType: input.providerType, baseUrl: input.baseUrl, createdAt: '', updatedAt: '' }
    mockSettings.groups = [group, ...mockSettings.groups.filter((item) => item.id !== group.id)]
    return { ...group }
  },
  async deleteGroup(id) {
    mockSettings.groups = mockSettings.groups.filter((item) => item.id !== id)
    const connIds = mockSettings.connections.filter((c) => c.groupId === id).map((c) => c.id)
    mockSettings.connections = mockSettings.connections.filter((c) => c.groupId !== id)
    mockSettings.models = mockSettings.models.filter((m) => !connIds.includes(m.connectionId))
  },
  async saveConnection(input) {
    const connection = { id: input.id ?? `mock-${Date.now()}`, groupId: input.groupId ?? mockSettings.groups[0]?.id ?? 'mock-group', name: input.name, providerType: input.providerType, baseUrl: input.baseUrl, hasApiKey: Boolean(input.apiKey), maxConcurrency: input.maxConcurrency, ...(input.groupName ? { groupName: input.groupName } : {}), createdAt: '', updatedAt: '' }
    mockSettings.connections = [connection, ...mockSettings.connections.filter((item) => item.id !== connection.id)]
    return { ...connection }
  },
  async deleteConnection(id) { mockSettings.connections = mockSettings.connections.filter((item) => item.id !== id); mockSettings.models = mockSettings.models.filter((item) => item.connectionId !== id) },
  async saveModel(input) {
    const model = { id: input.id ?? `mock-model-${Date.now()}`, connectionId: input.connectionId, modelId: input.modelId, name: input.name, kind: input.kind, capabilities: input.capabilities ?? [], createdAt: '', updatedAt: '' }
    mockSettings.models = [model, ...mockSettings.models.filter((item) => item.id !== model.id)]
    return { ...model }
  },
  async deleteModel(id) { mockSettings.models = mockSettings.models.filter((item) => item.id !== id) },
  async setDefaults(input) { mockSettings.defaultTextModelId = input.textModelId ?? undefined; mockSettings.defaultImageModelId = input.imageModelId ?? undefined; return structuredClone(mockSettings) },
  async testConnection() { return { ok: true, latencyMs: 42, message: '测试连接成功（模拟响应 42ms）', modelCount: 2 } },
}

export function getSettingsApi(): SettingsApi {
  if (typeof window !== 'undefined' && window.latentStudio?.settings) return window.latentStudio.settings
  return mockApi
}
