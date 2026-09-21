export type ProviderType = 'openai' | 'anthropic' | 'gemini' | 'deepseek' | 'glm' | 'kimi' | 'openai-compatible'
export type ModelKind = 'text' | 'image'

export interface ProviderGroup {
  id: string
  name: string
  providerType: ProviderType
  baseUrl: string
  createdAt: string
  updatedAt: string
}

export interface ProviderConnection {
  id: string
  groupId: string
  name: string
  providerType: ProviderType
  baseUrl: string
  hasApiKey: boolean
  maxConcurrency: number
  groupName?: string
  createdAt: string
  updatedAt: string
}

export interface ModelProfile {
  id: string
  connectionId: string
  modelId: string
  name: string
  kind: ModelKind
  capabilities: string[]
  createdAt: string
  updatedAt: string
}

/** Renderer-safe settings; encrypted credentials never cross this contract. */
export interface GlobalSettings {
  groups: ProviderGroup[]
  connections: ProviderConnection[]
  models: ModelProfile[]
  defaultTextModelId?: string
  defaultImageModelId?: string
}

export interface SaveProviderGroupInput {
  id?: string
  name: string
  providerType: ProviderType
  baseUrl: string
}

/** Write-only connection input; apiKey is never returned by the settings API. */
export interface SaveProviderConnectionInput {
  id?: string
  groupId?: string
  name: string
  providerType: ProviderType
  baseUrl: string
  apiKey?: string
  maxConcurrency: number
  groupName?: string
}

export interface SaveModelProfileInput {
  id?: string
  connectionId: string
  modelId: string
  name: string
  kind: ModelKind
  capabilities?: string[]
}

export interface TestConnectionInput {
  connectionId?: string
  id?: string
  providerType?: ProviderType
  baseUrl?: string
  apiKey?: string
}

export interface TestConnectionResult {
  ok: boolean
  latencyMs?: number
  message: string
  modelCount?: number
}

export interface SettingsApi {
  get(): Promise<GlobalSettings>
  saveGroup(input: SaveProviderGroupInput): Promise<ProviderGroup>
  deleteGroup(id: string): Promise<void>
  saveConnection(input: SaveProviderConnectionInput): Promise<ProviderConnection>
  deleteConnection(id: string): Promise<void>
  saveModel(input: SaveModelProfileInput): Promise<ModelProfile>
  deleteModel(id: string): Promise<void>
  setDefaults(input: { textModelId?: string | null; imageModelId?: string | null }): Promise<GlobalSettings>
  testConnection(input: TestConnectionInput): Promise<TestConnectionResult>
}
