import { describe, expect, it } from 'vitest'
import { createNodeSqliteDatabase, initializeGlobalDatabase } from '../../src/main/config'
import type { EncryptedCredentialStore } from '../../src/main/credentials'
import { SettingsStore } from '../../src/main/settings'
import { createTextModelService } from '../../src/main/models/service'
import type { FetchImplementation } from '../../src/main/models/contracts'

const credentials: EncryptedCredentialStore = {
  encryptApiKey: (value) => `encrypted:${value}`,
  decryptApiKey: (value) => value.replace(/^encrypted:/, ''),
}

async function makeService(fetch?: FetchImplementation, baseUrl = 'https://provider.example/v1') {
  const database = await createNodeSqliteDatabase(':memory:')
  initializeGlobalDatabase(database)
  const store = new SettingsStore(database, credentials)
  const connection = store.saveConnection({ name: '测试连接', providerType: 'openai', baseUrl, apiKey: 'secret-key', maxConcurrency: 2 })
  const model = store.saveModel({ connectionId: connection.id, modelId: 'gpt-test', name: '测试文本', kind: 'text', capabilities: ['streaming', 'tool-calls', 'native-search', 'vision'] })
  return { service: createTextModelService(store, fetch ? { fetch } : {}), modelId: model.id, close: () => database.close?.() }
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function sseResponse(events: string[]): Response {
  return new Response(events.map((event) => `data: ${event}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

describe('text model service', () => {
  it('probes official compaction once and caches an unsupported capability', async () => {
    let calls = 0
    const { service, modelId, close } = await makeService(async () => {
      calls += 1
      return jsonResponse({ error: { message: 'unsupported endpoint' } }, 404)
    }, 'https://api.openai.com/v1')
    try {
      const input = { modelProfileId: modelId, messages: [{ role: 'user' as const, content: '历史对话' }] }
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'unsupported', capabilityCached: false })
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'unsupported', capabilityCached: true })
      expect(calls).toBe(1)
    } finally { service.dispose(); close() }
  })

  it('retries official compaction after a transient network failure', async () => {
    let calls = 0
    const { service, modelId, close } = await makeService(async () => {
      calls += 1
      if (calls === 1) throw new TypeError('offline')
      return jsonResponse({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] })
    }, 'https://api.openai.com/v1')
    const input = { modelProfileId: modelId, messages: [{ role: 'user' as const, content: '历史对话' }] }
    try {
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'failed', capabilityCached: false })
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'compacted' })
      expect(calls).toBe(2)
    } finally { service.dispose(); close() }
  })

  it('retries official compaction after a malformed transient response', async () => {
    let calls = 0
    const { service, modelId, close } = await makeService(async () => {
      calls += 1
      return calls === 1
        ? jsonResponse({ status: 'temporarily-incomplete' })
        : jsonResponse({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] })
    }, 'https://api.openai.com/v1')
    const input = { modelProfileId: modelId, messages: [{ role: 'user' as const, content: '历史对话' }] }
    try {
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'failed', capabilityCached: false })
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'compacted' })
      expect(calls).toBe(2)
    } finally { service.dispose(); close() }
  })

  it('retries official compaction after an input-specific 400 response', async () => {
    let calls = 0
    const { service, modelId, close } = await makeService(async () => {
      calls += 1
      return calls === 1
        ? jsonResponse({ error: { message: 'input exceeds the current request limit' } }, 400)
        : jsonResponse({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] })
    }, 'https://api.openai.com/v1')
    const input = { modelProfileId: modelId, messages: [{ role: 'user' as const, content: '历史对话' }] }
    try {
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'failed', capabilityCached: false })
      await expect(service.compact(input)).resolves.toMatchObject({ status: 'compacted' })
      expect(calls).toBe(2)
    } finally { service.dispose(); close() }
  })

  it('does not infer official compaction support from a non-OpenAI model name', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const connection = store.saveConnection({ name: '其他连接', providerType: 'anthropic', baseUrl: 'https://provider.example', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = store.saveModel({ connectionId: connection.id, modelId: 'claude-test', name: 'Claude', kind: 'text' })
    let calls = 0
    const service = createTextModelService(store, { fetch: async () => { calls += 1; return jsonResponse({}) } })
    try {
      await expect(service.compact({ modelProfileId: model.id, messages: [{ role: 'user', content: '历史对话' }] })).resolves.toMatchObject({ status: 'unsupported' })
      expect(calls).toBe(0)
    } finally { service.dispose(); database.close?.() }
  })

  it('does not call the official compaction endpoint through an OpenAI relay', async () => {
    let calls = 0
    const { service, modelId, close } = await makeService(async () => {
      calls += 1
      return jsonResponse({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] })
    })
    try {
      await expect(service.compact({ modelProfileId: modelId, messages: [{ role: 'user', content: '历史对话' }] })).resolves.toMatchObject({ status: 'unsupported' })
      expect(calls).toBe(0)
    } finally { service.dispose(); close() }
  })

  it('routes gpt-5.6-terra through its compatible connection with xhigh reasoning', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const connection = store.saveConnection({ name: 'Terra 网关', providerType: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = store.saveModel({ connectionId: connection.id, modelId: 'gpt-5.6-terra', name: 'Terra', kind: 'text' })
    let body: Record<string, unknown> | undefined
    const service = createTextModelService(store, { fetch: async (_input, init) => {
      body = JSON.parse(String(init?.body))
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: 'ok' } }] })
    } })
    try {
      const result = await service.generate({ modelProfileId: model.id, request: { messages: [{ role: 'user', content: '测试' }], reasoningEffort: 'xhigh' } })
      expect(result.text).toBe('ok')
      expect(body).toMatchObject({ model: 'gpt-5.6-terra', reasoning_effort: 'xhigh' })
    } finally { service.dispose(); database.close?.() }
  })

  it('streams through a text adapter when a legacy profile only records reasoning capability', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const connection = store.saveConnection({ name: '旧兼容连接', providerType: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = store.saveModel({ connectionId: connection.id, modelId: 'legacy-model', name: '旧模型', kind: 'text', capabilities: ['reasoning-effort'] })
    let calls = 0
    const service = createTextModelService(store, { fetch: async () => {
      calls += 1
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '开始输出' }, finish_reason: 'stop' }] })])
    } })
    try {
      const completed = new Promise<unknown>((resolve) => {
        void service.startStream({ modelProfileId: model.id, request: { messages: [{ role: 'user', content: '你好' }], reasoningEffort: 'high' } }, (payload) => {
          if ('result' in payload || 'error' in payload) resolve(payload)
        })
      })
      expect(await completed).toMatchObject({ result: { text: '开始输出' } })
      expect(calls).toBe(1)
    } finally { service.dispose(); database.close?.() }
  })

  it('sends a user-selected effort for an unclassified compatible model instead of rejecting before fetch', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const connection = store.saveConnection({ name: '兼容网关', providerType: 'openai-compatible', baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = store.saveModel({ connectionId: connection.id, modelId: 'custom-longform', name: '思考模型', kind: 'text', capabilities: ['streaming'] })
    const bodies: Record<string, unknown>[] = []
    const service = createTextModelService(store, { fetch: async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)))
      return sseResponse([JSON.stringify({ choices: [{ delta: { content: '逐段输出' }, finish_reason: 'stop' }] })])
    } })
    try {
      const completed = new Promise<unknown>((resolve) => {
        void service.startStream({ modelProfileId: model.id, request: { messages: [{ role: 'user', content: '思考' }], reasoningEffort: 'high' } }, (payload) => {
          if ('result' in payload || 'error' in payload) resolve(payload)
        })
      })
      expect(await completed).toMatchObject({ result: { text: '逐段输出' } })
      expect(bodies).toHaveLength(1)
      expect(bodies[0]).toMatchObject({ stream: true, reasoning_effort: 'high' })
    } finally { service.dispose(); database.close?.() }
  })

  it('uses the renderer request id for every event, including events before start acknowledgement', async () => {
    const { service, modelId, close } = await makeService(async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '第一段' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }] }),
    ]))
    const requestId = 'b991e565-77bf-426c-8ee7-06c1185de287'
    const received: unknown[] = []
    try {
      const completed = new Promise<void>((resolve) => {
        void service.startStream({ requestId, modelProfileId: modelId, request: { messages: [{ role: 'user', content: '你好' }] } }, (payload) => {
          received.push(payload)
          if ('result' in payload || 'error' in payload) resolve()
        })
      })
      await completed
      expect(received).toEqual(expect.arrayContaining([
        { requestId, event: { type: 'text_delta', text: '第一段' } },
        { requestId, event: { type: 'text_delta', text: '第二段' } },
        { requestId, result: expect.objectContaining({ text: '第一段第二段' }) },
      ]))
    } finally { service.dispose(); close() }
  })

  it('merges partial stream usage and records the current request window', async () => {
    const { service, modelId, close } = await makeService(async () => sseResponse([
      JSON.stringify({ choices: [], usage: { prompt_tokens: 120 } }),
      JSON.stringify({ choices: [{ delta: { content: '完成' }, finish_reason: 'stop' }], usage: { completion_tokens: 30, total_tokens: 150 } }),
    ]))
    try {
      const completed = new Promise<unknown>((resolve) => {
        void service.startStream({ modelProfileId: modelId, request: { messages: [{ role: 'user', content: '你好' }], includeUsage: true } }, (payload) => {
          if ('result' in payload) resolve(payload.result)
        })
      })

      await expect(completed).resolves.toMatchObject({
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150, contextTokens: 150 },
      })
    } finally { service.dispose(); close() }
  })

  it('delivers the first text delta before the provider finishes the stream', async () => {
    let sendSecond!: () => void
    const firstFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: '第一段' } }] })}\n\n`
    const secondFrame = `data: ${JSON.stringify({ choices: [{ delta: { content: '第二段' }, finish_reason: 'stop' }] })}\n\n`
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(firstFrame))
        sendSecond = () => {
          controller.enqueue(new TextEncoder().encode(secondFrame))
          controller.close()
        }
      },
    })
    const { service, modelId, close } = await makeService(async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }))
    let onFirst!: () => void
    let onComplete!: (text: string) => void
    const first = new Promise<void>((resolve) => { onFirst = resolve })
    const completed = new Promise<string>((resolve) => { onComplete = resolve })
    try {
      await service.startStream({ modelProfileId: modelId, request: { messages: [{ role: 'user', content: '你好' }] } }, (payload) => {
        if ('event' in payload && payload.event.type === 'text_delta' && payload.event.text === '第一段') onFirst()
        if ('result' in payload) onComplete(payload.result.text)
      })
      await first
      sendSecond()
      expect(await completed).toBe('第一段第二段')
    } finally { service.dispose(); close() }
  })

  it('resolves the configured model and keeps API keys out of the result', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const fetch: FetchImplementation = async (input, init) => {
      calls.push({ input, init })
      return jsonResponse({ id: 'response-1', model: 'gpt-test', choices: [{ message: { role: 'assistant', content: '完成' }, finish_reason: 'stop' }] })
    }
    const { service, modelId, close } = await makeService(fetch)
    try {
      const result = await service.generate({
        modelProfileId: modelId,
        request: { messages: [{ role: 'user', content: '你好' }] },
      })
      expect(result).toMatchObject({ id: 'response-1', model: 'gpt-test', text: '完成', toolCalls: [] })
      expect(JSON.stringify(result)).not.toContain('secret-key')
      expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer secret-key' })
    } finally { close() }
  })

  it('emits stream events and an aggregated renderer-safe result', async () => {
    const { service, modelId, close } = await makeService(async () => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '流式' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ]))
    const events: unknown[] = []
    try {
      const started = await service.startStream({
        modelProfileId: modelId,
        request: { messages: [{ role: 'user', content: '你好' }] },
      }, (payload) => events.push(payload))
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (events.some((payload) => payload && typeof payload === 'object' && 'result' in payload)) { clearInterval(timer); resolve() }
        }, 5)
      })
      expect(started.requestId).toEqual(expect.any(String))
      expect(events).toEqual(expect.arrayContaining([
        { requestId: started.requestId, event: { type: 'text_delta', text: '流式' } },
        { requestId: started.requestId, event: { type: 'finish', reason: 'stop' } },
        { requestId: started.requestId, result: expect.objectContaining({ text: '流式', finishReason: 'stop' }) },
      ]))
    } finally { close() }
  }, 3000)

  it('rejects unconfirmed capabilities before making a provider request', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const connection = store.saveConnection({ name: '未确认连接', providerType: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const model = store.saveModel({ connectionId: connection.id, modelId: 'unknown', name: '未确认文本', kind: 'text' })
    let calls = 0
    const service = createTextModelService(store, { fetch: async () => { calls += 1; return jsonResponse({}) } })
    try {
      await expect(service.generate({ modelProfileId: model.id, request: { messages: [{ role: 'user', content: '搜索资料' }], search: true } })).rejects.toMatchObject({ code: 'invalid_request' })
      expect(calls).toBe(0)
    } finally { database.close?.() }
  })

  it('redacts a provider error that echoes the configured API key', async () => {
    const { service, modelId, close } = await makeService(async () => new Response(JSON.stringify({ error: { message: 'invalid secret-key' } }), { status: 401 }))
    try {
      await expect(service.generate({ modelProfileId: modelId, request: { messages: [{ role: 'user', content: '你好' }] } })).rejects.toMatchObject({ code: 'auth', message: 'invalid [已隐藏]' })
    } finally { close() }
  })

  it('routes search requests to a confirmed search-capable fallback model', async () => {
    const database = await createNodeSqliteDatabase(':memory:')
    initializeGlobalDatabase(database)
    const store = new SettingsStore(database, credentials)
    const connection = store.saveConnection({ name: '搜索连接', providerType: 'openai', baseUrl: 'https://provider.example/v1', apiKey: 'secret-key', maxConcurrency: 1 })
    const plain = store.saveModel({ connectionId: connection.id, modelId: 'plain-model', name: '普通模型', kind: 'text', capabilities: ['streaming'] })
    store.saveModel({ connectionId: connection.id, modelId: 'search-model', name: '搜索模型', kind: 'text', capabilities: ['streaming', 'native-search'] })
    const calls: string[] = []
    const service = createTextModelService(store, { fetch: async (input, init) => {
      calls.push(String(input))
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: 'search-model', web_search_options: {} })
      return jsonResponse({ choices: [{ message: { role: 'assistant', content: '搜索完成' }, finish_reason: 'stop' }] })
    } })
    try {
      const result = await service.generate({ modelProfileId: plain.id, request: { messages: [{ role: 'user', content: '搜索资料' }], search: true } })
      expect(result.text).toBe('搜索完成')
      expect(calls).toHaveLength(1)
    } finally { database.close?.() }
  })
})
