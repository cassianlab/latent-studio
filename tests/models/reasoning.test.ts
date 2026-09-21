import { describe, expect, it, vi } from 'vitest'
import {
  getSupportedReasoningEfforts,
  isReasoningEffortSupported,
  REASONING_EFFORT_LABELS,
} from '../../src/shared/models/reasoning'
import { OpenAICompatibleTextAdapter, TextModelError } from '../../src/main/models'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import { SettingsStore } from '../../src/main/settings'
import { createTextModelService } from '../../src/main/models/service'
import type { EncryptedCredentialStore } from '../../src/main/credentials'

const credentials: EncryptedCredentialStore = {
  encryptApiKey: (v) => `enc:${v}`,
  decryptApiKey: (v) => v.replace(/^enc:/, ''),
}

describe('text reasoning effort capability detection', () => {
  it('identifies OpenAI reasoning models and exposes low/medium/high', () => {
    const o3 = getSupportedReasoningEfforts({
      modelId: 'o3-mini',
      providerType: 'openai',
    })
    expect(o3.supported).toEqual(['auto', 'low', 'medium', 'high'])
    expect(o3.source).toBe('adapter')
    expect(isReasoningEffortSupported({ modelId: 'o3-mini', providerType: 'openai' }, 'high')).toBe(true)
    expect(isReasoningEffortSupported({ modelId: 'o3-mini', providerType: 'openai' }, 'xhigh')).toBe(false)
  })

  it('exposes xhigh when model explicitly supports xhigh', () => {
    const o3xhigh = getSupportedReasoningEfforts({
      modelId: 'o3-mini-xhigh',
      capabilities: ['reasoning:xhigh'],
      providerType: 'openai',
    })
    expect(o3xhigh.supported).toContain('xhigh')
  })

  it('restricts unknown compatible models to auto unless capabilities are declared', () => {
    const unknown = getSupportedReasoningEfforts({
      modelId: 'custom-llm',
      providerType: 'openai-compatible',
    })
    expect(unknown.supported).toEqual(['auto'])
    expect(unknown.source).toBe('unconfirmed')
    expect(isReasoningEffortSupported({ modelId: 'custom-llm', providerType: 'openai-compatible' }, 'high')).toBe(false)
    expect(isReasoningEffortSupported({ modelId: 'custom-llm', providerType: 'openai-compatible' }, 'auto')).toBe(true)
  })

  it('restricts Anthropic and Gemini models to auto', () => {
    const claude = getSupportedReasoningEfforts({
      modelId: 'claude-3-5-sonnet-20241022',
      providerType: 'anthropic',
    })
    expect(claude.supported).toEqual(['auto'])

    const gemini = getSupportedReasoningEfforts({
      modelId: 'gemini-1.5-pro',
      providerType: 'gemini',
    })
    expect(gemini.supported).toEqual(['auto'])
  })

  it('respects user-declared reasoning-effort capability', () => {
    const customWithCap = getSupportedReasoningEfforts({
      modelId: 'deepseek-r1',
      capabilities: ['reasoning-effort'],
      providerType: 'openai-compatible',
    })
    expect(customWithCap.supported).toEqual(['auto', 'low', 'medium', 'high'])
    expect(customWithCap.source).toBe('user')
  })

  it('identifies gpt-5 and codex models and exposes xhigh reasoning effort', () => {
    const gpt5 = getSupportedReasoningEfforts({
      modelId: 'gpt-5.6-sol',
      providerType: 'openai-compatible',
    })
    expect(gpt5.supported).toEqual(['auto', 'low', 'medium', 'high', 'xhigh'])
    expect(isReasoningEffortSupported({ modelId: 'gpt-5.6-sol', providerType: 'openai-compatible' }, 'xhigh')).toBe(true)

    const terra = getSupportedReasoningEfforts({
      modelId: 'gpt-5.6-terra',
      providerType: 'openai-compatible',
    })
    expect(terra.supported).toContain('xhigh')

    const codex = getSupportedReasoningEfforts({
      modelId: 'codex',
      providerType: 'openai-compatible',
    })
    expect(codex.supported).toContain('xhigh')
  })
})

describe('OpenAI Chat Completions reasoning_effort mapping', () => {
  it('does not send reasoning_effort when effort is auto', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const adapter = new OpenAICompatibleTextAdapter({
      baseUrl: 'https://api.openai.com',
      apiKey: 'test-key',
      providerType: 'openai',
      fetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'hello' } }],
        }))
      },
    })

    await adapter.generate({
      model: 'o3-mini',
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'auto',
    })

    expect(capturedBody).toBeDefined()
    expect(capturedBody?.reasoning_effort).toBeUndefined()
  })

  it('sends reasoning_effort when model is an OpenAI reasoning model and effort is set', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const adapter = new OpenAICompatibleTextAdapter({
      baseUrl: 'https://api.openai.com',
      apiKey: 'test-key',
      providerType: 'openai',
      fetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'reasoned' } }],
        }))
      },
    })

    await adapter.generate({
      model: 'o3-mini',
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'high',
    })

    expect(capturedBody?.reasoning_effort).toBe('high')
  })

  it('forwards explicitly selected reasoning_effort to an unknown compatible model', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const adapter = new OpenAICompatibleTextAdapter({
      baseUrl: 'https://compatible.example/v1',
      apiKey: 'test-key',
      providerType: 'openai-compatible',
      fetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'reply' } }],
        }))
      },
    })

    await adapter.generate({
      model: 'my-custom-model',
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'high',
    })

    expect(capturedBody?.reasoning_effort).toBe('high')
  })

  it('sends reasoning_effort xhigh for gpt-5.6-sol on openai-compatible provider', async () => {
    let capturedBody: Record<string, unknown> | undefined
    const adapter = new OpenAICompatibleTextAdapter({
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'test-key',
      providerType: 'openai-compatible',
      fetch: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'reasoned deeply' } }],
        }))
      },
    })

    await adapter.generate({
      model: 'gpt-5.6-sol',
      messages: [{ role: 'user', content: 'test' }],
      reasoningEffort: 'xhigh',
    })

    expect(capturedBody?.reasoning_effort).toBe('xhigh')
  })
})

describe('text model service reasoning validation', () => {
  it('rejects unsupported reasoning effort at main process layer', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const conn = store.saveConnection({
      name: 'Standard OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      maxConcurrency: 1,
    })
    // gpt-4o does not support reasoning_effort
    const model = store.saveModel({
      connectionId: conn.id,
      modelId: 'gpt-4o',
      name: 'GPT-4o',
      kind: 'text',
      capabilities: ['streaming'],
    })

    const service = createTextModelService(store, {
      fetch: async () => new Response(JSON.stringify({})),
    })

    try {
      // IPC trying to send high reasoning effort to gpt-4o should be rejected by main process
      await expect(
        service.generate({
          modelProfileId: model.id,
          request: {
            messages: [{ role: 'user', content: 'hi' }],
            reasoningEffort: 'high',
          },
        }),
      ).rejects.toThrowError(/当前模型未确认支持思考强度/)
    } finally {
      database.close?.()
    }
  })

  it('allows reasoning effort on confirmed model', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const conn = store.saveConnection({
      name: 'OpenAI',
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      maxConcurrency: 1,
    })
    const model = store.saveModel({
      connectionId: conn.id,
      modelId: 'o3-mini',
      name: 'o3-mini',
      kind: 'text',
      capabilities: ['streaming', 'tool-calls'],
    })

    let sentBody: Record<string, unknown> | undefined
    const service = createTextModelService(store, {
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'thought deeply' } }],
        }))
      },
    })

    try {
      const result = await service.generate({
        modelProfileId: model.id,
        request: {
          messages: [{ role: 'user', content: 'think' }],
          reasoningEffort: 'medium',
        },
      })
      expect(result.text).toBe('thought deeply')
      expect(sentBody?.reasoning_effort).toBe('medium')
    } finally {
      database.close?.()
    }
  })

  it('allows reasoning effort xhigh on gpt-5.6-sol without requiring manual capability flags', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const conn = store.saveConnection({
      name: 'Proxy Gateway',
      providerType: 'openai-compatible',
      baseUrl: 'https://gateway.example/v1',
      apiKey: 'sk-test',
      maxConcurrency: 1,
    })
    // Default model capabilities without manual reasoning-effort flag
    const model = store.saveModel({
      connectionId: conn.id,
      modelId: 'gpt-5.6-sol',
      name: 'GPT-5.6 SOL',
      kind: 'text',
      capabilities: ['streaming', 'tool-calls'],
    })

    let sentBody: Record<string, unknown> | undefined
    const service = createTextModelService(store, {
      fetch: async (_input, init) => {
        sentBody = JSON.parse(String(init?.body))
        return new Response(JSON.stringify({
          choices: [{ message: { role: 'assistant', content: 'xhigh reasoning completed' } }],
        }))
      },
    })

    try {
      const result = await service.generate({
        modelProfileId: model.id,
        request: {
          messages: [{ role: 'user', content: 'think' }],
          reasoningEffort: 'xhigh',
        },
      })
      expect(result.text).toBe('xhigh reasoning completed')
      expect(sentBody?.reasoning_effort).toBe('xhigh')
    } finally {
      database.close?.()
    }
  })
})
