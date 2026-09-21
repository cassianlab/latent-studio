import { randomUUID } from 'node:crypto'
import type {
  GlobalSettings,
  ModelKind,
  ModelProfile,
  ProviderConnection,
  ProviderGroup,
  ProviderType,
  SaveModelProfileInput,
  SaveProviderConnectionInput,
  SaveProviderGroupInput,
  TestConnectionInput,
  TestConnectionResult,
} from '../../shared/contracts/settings'
import type { WindowClosePreference } from '../../shared/contracts/window-lifecycle'
import type { EncryptedCredentialStore } from '../credentials'
import type { GlobalDatabase } from '../config'
import { discoverModels } from '../models/discovery'
import type { TextProvider } from '../models/contracts'

const PROVIDER_TYPES: ProviderType[] = ['openai', 'anthropic', 'gemini', 'deepseek', 'glm', 'kimi', 'openai-compatible']
const MODEL_KINDS: ModelKind[] = ['text', 'image']
const WINDOW_CLOSE_PREFERENCES: WindowClosePreference[] = ['ask', 'minimize', 'quit']
const WINDOW_CLOSE_PREFERENCE_KEY = 'windowClosePreference'

export class SettingsError extends Error {
  constructor(public readonly code: 'invalid-connection' | 'invalid-model' | 'not-found' | 'conflict', message: string) {
    super(message)
    this.name = 'SettingsError'
  }
}

interface GroupRow {
  id: string
  name: string
  provider_type: string
  base_url: string
  created_at: string
  updated_at: string
}

interface ConnectionRow {
  id: string
  group_id?: string | null
  name: string
  provider_type: string
  base_url: string
  encrypted_api_key: string | null
  max_concurrency: number
  group_name?: string | null
  created_at: string
  updated_at: string
}

interface ModelRow {
  id: string
  connection_id: string
  model_id: string
  name: string
  kind: string
  capabilities_json: string
  created_at: string
  updated_at: string
}

interface SettingsRow { key: string; value: string }

export interface ConnectionExecutionConfig {
  connection: ProviderConnection
  apiKey: string
}

export interface ModelExecutionConfig extends ConnectionExecutionConfig {
  model: ModelProfile
}

function requiredText(value: unknown, message: string, max = 160, code: 'invalid-connection' | 'invalid-model' = 'invalid-connection'): string {
  if (typeof value !== 'string') throw new SettingsError(code, message)
  const result = value.trim()
  if (!result || result.length > max) throw new SettingsError(code, message)
  return result
}

function validateBaseUrl(value: unknown): string {
  const baseUrl = requiredText(value, 'Base URL 不能为空且不能超过 160 个字符')
  try {
    const url = new URL(baseUrl)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported protocol')
  } catch {
    throw new SettingsError('invalid-connection', 'Base URL 需要是 http 或 https 地址')
  }
  return baseUrl.replace(/\/$/, '')
}

function validateProvider(value: unknown): ProviderType {
  if (typeof value !== 'string' || !PROVIDER_TYPES.includes(value as ProviderType)) {
    throw new SettingsError('invalid-connection', '不支持的服务商类型')
  }
  return value as ProviderType
}

function validateConcurrency(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 64) {
    throw new SettingsError('invalid-connection', '最大并发需要是 1-64 的整数')
  }
  return value
}

function mapGroup(row: GroupRow): ProviderGroup {
  return {
    id: row.id,
    name: row.name,
    providerType: validateProvider(row.provider_type),
    baseUrl: row.base_url,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapConnection(row: ConnectionRow): ProviderConnection {
  return {
    id: row.id,
    groupId: row.group_id ?? '',
    name: row.name,
    providerType: validateProvider(row.provider_type),
    baseUrl: row.base_url,
    hasApiKey: Boolean(row.encrypted_api_key),
    maxConcurrency: row.max_concurrency,
    ...(row.group_name ? { groupName: row.group_name } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapModel(row: ModelRow): ModelProfile {
  const kind = row.kind as ModelKind
  if (!MODEL_KINDS.includes(kind)) throw new SettingsError('invalid-model', `模型类型无效：${row.kind}`)
  let capabilities: string[] = []
  try {
    const parsed = JSON.parse(row.capabilities_json)
    if (Array.isArray(parsed)) capabilities = parsed.filter((value): value is string => typeof value === 'string')
  } catch {
    capabilities = []
  }
  return {
    id: row.id,
    connectionId: row.connection_id,
    modelId: row.model_id,
    name: row.name,
    kind,
    capabilities,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class SettingsStore {
  constructor(private readonly database: GlobalDatabase, private readonly credentials: EncryptedCredentialStore) {}

  get(): GlobalSettings {
    const groupRows = this.database.all<GroupRow>('SELECT * FROM provider_groups ORDER BY created_at ASC')
    const connectionRows = this.database.all<ConnectionRow>('SELECT * FROM provider_connections ORDER BY updated_at DESC')
    const modelRows = this.database.all<ModelRow>('SELECT * FROM model_profiles ORDER BY updated_at DESC')
    const settings = new Map(this.database.all<SettingsRow>('SELECT key, value FROM settings').map((row) => [row.key, row.value]))
    return {
      groups: groupRows.map(mapGroup),
      connections: connectionRows.map(mapConnection),
      models: modelRows.map(mapModel),
      ...(settings.get('defaultTextModelId') ? { defaultTextModelId: settings.get('defaultTextModelId') } : {}),
      ...(settings.get('defaultImageModelId') ? { defaultImageModelId: settings.get('defaultImageModelId') } : {}),
    }
  }

  getWindowClosePreference(): WindowClosePreference {
    const row = this.database.all<SettingsRow>('SELECT key, value FROM settings WHERE key = ?', WINDOW_CLOSE_PREFERENCE_KEY)[0]
    return WINDOW_CLOSE_PREFERENCES.includes(row?.value as WindowClosePreference)
      ? row.value as WindowClosePreference
      : 'ask'
  }

  setWindowClosePreference(preference: WindowClosePreference): void {
    if (!WINDOW_CLOSE_PREFERENCES.includes(preference)) throw new Error('窗口关闭偏好无效')
    this.database.run(`
      INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `, WINDOW_CLOSE_PREFERENCE_KEY, preference, new Date().toISOString())
  }

  /** Resolves a connection and decrypts its key inside the main process only. */
  getConnectionExecutionConfig(connectionId: string): ConnectionExecutionConfig {
    const row = this.database.all<ConnectionRow>('SELECT * FROM provider_connections WHERE id = ?', connectionId)[0]
    if (!row) throw new SettingsError('not-found', '连接不存在')
    if (!row.encrypted_api_key) throw new SettingsError('invalid-connection', '连接尚未配置 API Key')
    return { connection: mapConnection(row), apiKey: this.credentials.decryptApiKey(row.encrypted_api_key) }
  }

  /** Resolves a text/image model and its owning connection for main-process calls. */
  getModelExecutionConfig(modelProfileId: string): ModelExecutionConfig {
    const row = this.database.all<ModelRow>('SELECT * FROM model_profiles WHERE id = ?', modelProfileId)[0]
    if (!row) throw new SettingsError('not-found', '模型不存在')
    const model = mapModel(row)
    const connection = this.getConnectionExecutionConfig(model.connectionId)
    return { ...connection, model }
  }

  saveGroup(input: SaveProviderGroupInput): ProviderGroup {
    const id = input.id?.trim() || randomUUID()
    const name = requiredText(input.name, '供应商分组名称不能为空且不能超过 160 个字符')
    const providerType = validateProvider(input.providerType)
    const baseUrl = validateBaseUrl(input.baseUrl)
    const existing = this.database.all<GroupRow>('SELECT * FROM provider_groups WHERE id = ?', id)[0]
    if (input.id && !existing) throw new SettingsError('not-found', '供应商分组不存在')
    const now = new Date().toISOString()
    this.database.run(`
      INSERT INTO provider_groups (id, name, provider_type, base_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        provider_type = excluded.provider_type,
        base_url = excluded.base_url,
        updated_at = excluded.updated_at
    `, id, name, providerType, baseUrl, existing?.created_at ?? now, now)
    const saved = this.database.all<GroupRow>('SELECT * FROM provider_groups WHERE id = ?', id)[0]
    if (!saved) throw new Error('provider group was not persisted')
    return mapGroup(saved)
  }

  deleteGroup(id: string): void {
    if (!this.database.all<GroupRow>('SELECT id FROM provider_groups WHERE id = ?', id)[0]) {
      throw new SettingsError('not-found', '供应商分组不存在')
    }
    const connections = this.database.all<ConnectionRow>('SELECT id FROM provider_connections WHERE group_id = ?', id)
    for (const conn of connections) {
      this.deleteConnection(conn.id)
    }
    this.database.run('DELETE FROM provider_groups WHERE id = ?', id)
  }

  saveConnection(input: SaveProviderConnectionInput): ProviderConnection {
    const id = input.id?.trim() || randomUUID()
    const name = requiredText(input.name, '连接名称不能为空且不能超过 160 个字符')
    const providerType = validateProvider(input.providerType)
    const baseUrl = validateBaseUrl(input.baseUrl)
    const maxConcurrency = validateConcurrency(input.maxConcurrency)
    let groupId = typeof input.groupId === 'string' ? input.groupId.trim() : ''
    const groupName = typeof input.groupName === 'string' ? input.groupName.trim() : ''

    if (!groupId) {
      const existing = this.database.all<GroupRow>('SELECT id FROM provider_groups WHERE name = ? AND provider_type = ?', groupName || `${providerType} 分组`, providerType)[0]
      if (existing) {
        groupId = existing.id
      } else {
        const newGroup = this.saveGroup({
          name: groupName || `${providerType} 分组`,
          providerType,
          baseUrl,
        })
        groupId = newGroup.id
      }
    } else {
      const groupExists = this.database.all<GroupRow>('SELECT id FROM provider_groups WHERE id = ?', groupId)[0]
      if (!groupExists) throw new SettingsError('not-found', '所属供应商分组不存在')
    }

    const existing = this.database.all<ConnectionRow>('SELECT * FROM provider_connections WHERE id = ?', id)[0]
    if (input.id && !existing) throw new SettingsError('not-found', '连接不存在')
    let encryptedApiKey: string | null | undefined
    if (input.apiKey !== undefined) encryptedApiKey = this.credentials.encryptApiKey(input.apiKey)
    const now = new Date().toISOString()
    this.database.run(`
      INSERT INTO provider_connections (id, group_id, name, provider_type, base_url, encrypted_api_key, max_concurrency, group_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        group_id = excluded.group_id,
        name = excluded.name,
        provider_type = excluded.provider_type,
        base_url = excluded.base_url,
        encrypted_api_key = COALESCE(excluded.encrypted_api_key, provider_connections.encrypted_api_key),
        max_concurrency = excluded.max_concurrency,
        group_name = excluded.group_name,
        updated_at = excluded.updated_at
    `, id, groupId, name, providerType, baseUrl, encryptedApiKey ?? null, maxConcurrency, groupName, existing?.created_at ?? now, now)
    const saved = this.database.all<ConnectionRow>('SELECT * FROM provider_connections WHERE id = ?', id)[0]
    if (!saved) throw new Error('connection was not persisted')
    return mapConnection(saved)
  }

  async testConnection(input: TestConnectionInput): Promise<TestConnectionResult> {
    let providerType: ProviderType
    let baseUrl: string
    let apiKey: string

    const targetConnectionId = (input.connectionId || input.id)?.trim()
    if (targetConnectionId) {
      const config = this.getConnectionExecutionConfig(targetConnectionId)
      providerType = input.providerType ? validateProvider(input.providerType) : config.connection.providerType
      baseUrl = input.baseUrl?.trim() ? validateBaseUrl(input.baseUrl) : config.connection.baseUrl
      apiKey = input.apiKey?.trim() ? input.apiKey.trim() : config.apiKey
    } else {
      if (!input.providerType) throw new SettingsError('invalid-connection', '缺少服务商类型')
      if (!input.baseUrl) throw new SettingsError('invalid-connection', '缺少 Base URL')
      if (!input.apiKey) throw new SettingsError('invalid-connection', '缺少 API Key')
      providerType = validateProvider(input.providerType)
      baseUrl = validateBaseUrl(input.baseUrl)
      apiKey = input.apiKey.trim()
    }

    const start = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const result = await discoverModels({
        providerType: providerType as TextProvider,
        baseUrl,
        apiKey,
        signal: controller.signal,
      })
      clearTimeout(timer)
      const latencyMs = Date.now() - start
      return {
        ok: true,
        latencyMs,
        modelCount: result.models.length,
        message: `连接成功！响应耗时 ${latencyMs}ms，检测到 ${result.models.length} 个可用模型`,
      }
    } catch (error) {
      clearTimeout(timer)
      const latencyMs = Date.now() - start
      const message = error instanceof Error ? error.message : '连接失败'
      return {
        ok: false,
        latencyMs,
        message: `连接失败：${message}`,
      }
    }
  }

  deleteConnection(id: string): void {
    if (!this.database.all<ConnectionRow>('SELECT id FROM provider_connections WHERE id = ?', id)[0]) {
      throw new SettingsError('not-found', '连接不存在')
    }
    this.database.run('DELETE FROM settings WHERE value IN (SELECT id FROM model_profiles WHERE connection_id = ?)', id)
    this.database.run('DELETE FROM model_profiles WHERE connection_id = ?', id)
    this.database.run('DELETE FROM provider_connections WHERE id = ?', id)
  }

  saveModel(input: SaveModelProfileInput): ModelProfile {
    const id = input.id?.trim() || randomUUID()
    const connectionId = requiredText(input.connectionId, '模型连接不能为空', 80, 'invalid-model')
    const modelId = requiredText(input.modelId, '模型 ID 不能为空', 180, 'invalid-model')
    const name = requiredText(input.name, '模型名称不能为空', 160, 'invalid-model')
    if (!MODEL_KINDS.includes(input.kind)) throw new SettingsError('invalid-model', '不支持的模型类型')
    if (!this.database.all<ConnectionRow>('SELECT id FROM provider_connections WHERE id = ?', connectionId)[0]) {
      throw new SettingsError('not-found', '模型连接不存在')
    }
    const capabilities = [...new Set((input.capabilities ?? []).filter((value): value is string => typeof value === 'string' && value.trim().length > 0))]
    const existing = this.database.all<ModelRow>('SELECT * FROM model_profiles WHERE id = ?', id)[0]
    if (input.id && !existing) throw new SettingsError('not-found', '模型不存在')
    const duplicate = this.database.all<ModelRow>('SELECT id FROM model_profiles WHERE connection_id = ? AND model_id = ? AND id <> ?', connectionId, modelId, id)[0]
    if (duplicate) throw new SettingsError('conflict', '同一连接下的模型 ID 已存在')
    const now = new Date().toISOString()
    this.database.run(`
      INSERT INTO model_profiles (id, connection_id, model_id, name, kind, capabilities_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        connection_id = excluded.connection_id,
        model_id = excluded.model_id,
        name = excluded.name,
        kind = excluded.kind,
        capabilities_json = excluded.capabilities_json,
        updated_at = excluded.updated_at
    `, id, connectionId, modelId, name, input.kind, JSON.stringify(capabilities), existing?.created_at ?? now, now)
    const currentDefaultKey = input.kind === 'text' ? 'defaultTextModelId' : 'defaultImageModelId'
    const hasDefault = this.database.all<{ value: string }>('SELECT value FROM settings WHERE key = ?', currentDefaultKey)[0]
    if (!hasDefault) {
      this.database.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', currentDefaultKey, id, now)
    }
    const saved = this.database.all<ModelRow>('SELECT * FROM model_profiles WHERE id = ?', id)[0]
    if (!saved) throw new Error('model was not persisted')
    return mapModel(saved)
  }

  deleteModel(id: string): void {
    if (!this.database.all<ModelRow>('SELECT id FROM model_profiles WHERE id = ?', id)[0]) {
      throw new SettingsError('not-found', '模型不存在')
    }
    this.database.run('DELETE FROM settings WHERE value = ?', id)
    this.database.run('DELETE FROM model_profiles WHERE id = ?', id)
  }

  setDefaults(input: { textModelId?: string | null; imageModelId?: string | null }): GlobalSettings {
    const values: Array<[string, string | null | undefined, boolean]> = [
      ['defaultTextModelId', input.textModelId, Object.hasOwn(input, 'textModelId')],
      ['defaultImageModelId', input.imageModelId, Object.hasOwn(input, 'imageModelId')],
    ]
    for (const [key, id, provided] of values) {
      if (!provided) continue
      if (!id) {
        this.database.run('DELETE FROM settings WHERE key = ?', key)
        continue
      }
      const model = this.database.all<ModelRow>('SELECT id, kind FROM model_profiles WHERE id = ?', id)[0]
      const expectedKind = key === 'defaultTextModelId' ? 'text' : 'image'
      if (!model || model.kind !== expectedKind) throw new SettingsError('not-found', '默认模型不存在或类型不匹配')
      const now = new Date().toISOString()
      this.database.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at', key, id, now)
    }
    return this.get()
  }
}
