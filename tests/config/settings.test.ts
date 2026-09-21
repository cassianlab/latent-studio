import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { SettingsError, SettingsStore } from '../../src/main/settings'
import type { EncryptedCredentialStore } from '../../src/main/credentials'

const credentials: EncryptedCredentialStore = {
  encryptApiKey: (value) => `encrypted:${value}`,
  decryptApiKey: (value) => value.replace(/^encrypted:/, ''),
}

async function makeStore(): Promise<{ store: SettingsStore; close: () => void }> {
  const database = await createNodeSqliteDatabase(':memory:')
  initializeGlobalDatabase(database)
  return { store: new SettingsStore(database, credentials), close: () => database.close?.() }
}

describe('settings store', () => {
  it('persists and resets the macOS window close preference', async () => {
    const { store, close } = await makeStore()
    try {
      expect(store.getWindowClosePreference()).toBe('ask')
      store.setWindowClosePreference('minimize')
      expect(store.getWindowClosePreference()).toBe('minimize')
      store.setWindowClosePreference('quit')
      expect(store.getWindowClosePreference()).toBe('quit')
      store.setWindowClosePreference('ask')
      expect(store.getWindowClosePreference()).toBe('ask')
      expect(() => store.setWindowClosePreference('invalid' as never)).toThrowError('窗口关闭偏好无效')
    } finally { close() }
  })

  it('requires the stable model profile id when resolving an execution config', async () => {
    const { store, close } = await makeStore()
    try {
      const connection = store.saveConnection({ name: '兼容网关', providerType: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKey: 'key', maxConcurrency: 1 })
      const model = store.saveModel({ connectionId: connection.id, modelId: 'gpt-5.6-terra', name: 'Terra', kind: 'text' })
      expect(store.getModelExecutionConfig(model.id).model.id).toBe(model.id)
      expect(() => store.getModelExecutionConfig('gpt-5.6-terra')).toThrowError(
        expect.objectContaining({ code: 'not-found' }),
      )
    } finally { close() }
  })

  it('persists multiple connections without returning API keys', async () => {
    const { store, close } = await makeStore()
    try {
      const first = store.saveConnection({ name: 'OpenAI 主账号', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: ' key-a ', maxConcurrency: 2 })
      const second = store.saveConnection({ name: 'OpenAI 备用', providerType: 'openai', baseUrl: 'https://proxy.example/v1', apiKey: 'key-b', maxConcurrency: 1 })
      expect(first.id).not.toBe(second.id)
      expect(store.get().connections).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: second.id, hasApiKey: true, maxConcurrency: 1 }),
        expect.objectContaining({ id: first.id, hasApiKey: true, maxConcurrency: 2 }),
      ]))
      expect(JSON.stringify(store.get())).not.toContain('key-a')
    } finally { close() }
  })

  it('separates text and image models and validates defaults', async () => {
    const { store, close } = await makeStore()
    try {
      const connection = store.saveConnection({ name: '兼容服务', providerType: 'openai-compatible', baseUrl: 'http://localhost:8000/v1', maxConcurrency: 4 })
      const text = store.saveModel({ connectionId: connection.id, modelId: 'deepseek-chat', name: 'DeepSeek Chat', kind: 'text', capabilities: ['streaming', 'search'] })
      const image = store.saveModel({ connectionId: connection.id, modelId: 'gpt-image-2', name: 'GPT Image 2', kind: 'image', capabilities: ['reference-image'] })
      expect(store.setDefaults({ textModelId: text.id, imageModelId: image.id })).toMatchObject({ defaultTextModelId: text.id, defaultImageModelId: image.id })
      expect(store.setDefaults({ textModelId: null })).toMatchObject({ defaultImageModelId: image.id })
      expect(() => store.setDefaults({ textModelId: image.id })).toThrowError(expect.objectContaining({ code: 'not-found' }))
      expect(() => store.saveModel({ connectionId: connection.id, modelId: 'deepseek-chat', name: '重复', kind: 'text' })).toThrowError(SettingsError)
      store.deleteModel(image.id)
      expect(store.get().defaultImageModelId).toBeUndefined()
    } finally { close() }
  })

  it('rejects invalid connection input before writing', async () => {
    const { store, close } = await makeStore()
    try {
      expect(() => store.saveConnection({ name: '', providerType: 'openai', baseUrl: 'file:///tmp/key', maxConcurrency: 1 })).toThrowError(expect.objectContaining({ code: 'invalid-connection' }))
      expect(() => store.saveConnection({ name: 'Bad', providerType: 'openai', baseUrl: 'https://example.com', maxConcurrency: 0 })).toThrowError(expect.objectContaining({ code: 'invalid-connection' }))
    } finally { close() }
  })

  it('supports provider grouping with groupName and connection testing', async () => {
    const { store, close } = await makeStore()
    try {
      const groupA = store.saveConnection({
        name: '文本系列 Key',
        groupName: '文本组',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-text-key',
        maxConcurrency: 2,
      })
      const groupB = store.saveConnection({
        name: '生图系列 Key',
        groupName: '图像组',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-image-key',
        maxConcurrency: 1,
      })

      expect(groupA.groupName).toBe('文本组')
      expect(groupB.groupName).toBe('图像组')

      const connections = store.get().connections
      expect(connections.find((c) => c.id === groupA.id)?.groupName).toBe('文本组')
      expect(connections.find((c) => c.id === groupB.id)?.groupName).toBe('图像组')

      // Test connection with unreachable endpoint returns failure gracefully
      const testFailed = await store.testConnection({
        providerType: 'openai',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'sk-test',
      })
      expect(testFailed.ok).toBe(false)
      expect(testFailed.message).toContain('连接失败')
    } finally { close() }
  })

  it('supports a single provider group containing multiple different Keys, each binding separate models', async () => {
    const { store, close } = await makeStore()
    try {
      // 1. Create a provider group (e.g. 硅基流动)
      const group = store.saveGroup({
        name: '硅基流动',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
      })
      expect(group.id).toBeDefined()
      expect(group.name).toBe('硅基流动')

      // 2. Add Key 1: 文本专用 Key under this group
      const textKey = store.saveConnection({
        groupId: group.id,
        name: '文本专用 Key',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-text-secret-1',
        maxConcurrency: 4,
      })

      // 3. Add Key 2: 生图专用 Key under the SAME group
      const imageKey = store.saveConnection({
        groupId: group.id,
        name: '生图专用 Key',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        apiKey: 'sk-image-secret-2',
        maxConcurrency: 2,
      })

      expect(textKey.groupId).toBe(group.id)
      expect(imageKey.groupId).toBe(group.id)
      expect(textKey.id).not.toBe(imageKey.id)

      // 4. Bind text models to Key 1
      const textModel = store.saveModel({
        connectionId: textKey.id,
        modelId: 'deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3',
        kind: 'text',
      })

      // 5. Bind image models to Key 2
      const imageModel = store.saveModel({
        connectionId: imageKey.id,
        modelId: 'black-forest-labs/FLUX.1-schnell',
        name: 'FLUX.1 Schnell',
        kind: 'image',
      })

      // 6. Verify global settings structure
      const current = store.get()
      expect(current.groups).toEqual(expect.arrayContaining([expect.objectContaining({ id: group.id, name: '硅基流动' })]))
      const groupConnections = current.connections.filter((c) => c.groupId === group.id)
      expect(groupConnections).toHaveLength(2)

      const textKeyModels = current.models.filter((m) => m.connectionId === textKey.id)
      const imageKeyModels = current.models.filter((m) => m.connectionId === imageKey.id)
      expect(textKeyModels).toHaveLength(1)
      expect(textKeyModels[0].id).toBe(textModel.id)
      expect(imageKeyModels).toHaveLength(1)
      expect(imageKeyModels[0].id).toBe(imageModel.id)

      // 7. Verify deleting Key 1 removes only Key 1 and its models, keeping Key 2 intact, and cleans up default model pointer
      store.setDefaults({ textModelId: textModel.id })
      expect(store.get().defaultTextModelId).toBe(textModel.id)
      store.deleteConnection(textKey.id)
      const afterDeleteKey = store.get()
      expect(afterDeleteKey.defaultTextModelId).toBeUndefined()
      expect(afterDeleteKey.connections.find((c) => c.id === textKey.id)).toBeUndefined()
      expect(afterDeleteKey.connections.find((c) => c.id === imageKey.id)).toBeDefined()
      expect(afterDeleteKey.models.find((m) => m.id === textModel.id)).toBeUndefined()
      expect(afterDeleteKey.models.find((m) => m.id === imageModel.id)).toBeDefined()

      // 8. Verify deleting the Group cascades and removes remaining keys and models
      store.deleteGroup(group.id)
      const afterDeleteGroup = store.get()
      expect(afterDeleteGroup.groups.find((g) => g.id === group.id)).toBeUndefined()
      expect(afterDeleteGroup.connections.find((c) => c.id === imageKey.id)).toBeUndefined()
      expect(afterDeleteGroup.models.find((m) => m.id === imageModel.id)).toBeUndefined()
    } finally { close() }
  })

  it('reproduces and fixes: testing existing connection by id or connectionId reads saved key and allows draft overrides', async () => {
    const { store, close } = await makeStore()
    try {
      const conn = store.saveConnection({
        name: 'OpenAI 测试连接',
        providerType: 'openai',
        baseUrl: 'http://127.0.0.1:9/v1',
        apiKey: 'sk-saved-valid-key',
        maxConcurrency: 1,
      })

      // Test 1: passing the ProviderConnection object as returned by store.get().connections (has .id, no .connectionId and no .apiKey)
      // Current buggy code throws SettingsError: 缺少 API Key
      const testByConnObj = await store.testConnection(conn as unknown as import('../../shared/contracts/settings').TestConnectionInput)
      expect(testByConnObj.ok).toBe(false)
      expect(testByConnObj.message).not.toContain('缺少 API Key')

      // Test 2: passing connectionId with a draft baseUrl or draft apiKey overrides the saved values
      let interceptedUrl: string | undefined
      // When draft apiKey or baseUrl is provided, it should be respected
      const testWithDraft = await store.testConnection({
        connectionId: conn.id,
        baseUrl: 'http://127.0.0.1:9/v2',
        apiKey: 'sk-new-draft-key',
      })
      expect(testWithDraft.ok).toBe(false)
      expect(testWithDraft.message).not.toContain('缺少 API Key')
    } finally { close() }
  })
})
