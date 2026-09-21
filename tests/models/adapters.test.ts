import { describe, expect, it } from 'vitest'
import {
  AnthropicTextAdapter,
  GeminiTextAdapter,
  OpenAICompatibleTextAdapter,
  TextModelError,
  createTextModelAdapter,
  type FetchImplementation,
  type TextModelRequest,
} from '../../src/main/models'

const request: TextModelRequest = {
  model: 'model-test',
  system: '你是一个严谨的助手。',
  messages: [
    { role: 'user', content: '请描述这张图。' },
  ],
  temperature: 0.2,
  maxTokens: 120,
  tools: [{ name: 'search', description: '搜索资料', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } }],
  toolChoice: { mode: 'auto' },
  search: true,
}

function fixtureFetch(response: Response, calls: Array<{ input: RequestInfo | URL; init?: RequestInit }>): FetchImplementation {
  return async (input, init) => {
    calls.push({ input, init })
    return response.clone()
  }
}

function jsonResponse(value: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function sseResponse(events: string[]): Response {
  const body = events.map((event) => `data: ${event}\n\n`).join('')
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } })
}

function bodyOf(call: { init?: RequestInit }): Record<string, unknown> {
  return JSON.parse(String(call.init?.body)) as Record<string, unknown>
}

describe('text model adapters', () => {
  it('uses the official Responses compact endpoint and preserves opaque output items', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new OpenAICompatibleTextAdapter({
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key-test',
      fetch: fixtureFetch(jsonResponse({ output: [{ type: 'compaction', encrypted_content: 'opaque' }] }), calls),
    })

    const result = await adapter.compact({
      model: 'gpt-test',
      input: [{ role: 'user', content: '历史要求' }],
    })

    expect(result.output).toEqual([{ type: 'compaction', encrypted_content: 'opaque' }])
    expect(String(calls[0]?.input)).toBe('https://api.openai.com/v1/responses/compact')
    expect(bodyOf(calls[0])).toEqual({ model: 'gpt-test', input: [{ role: 'user', content: '历史要求' }] })
  })

  it('continues from official compaction items through the Responses API', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new OpenAICompatibleTextAdapter({
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key-test',
      fetch: fixtureFetch(jsonResponse({
        id: 'resp-1',
        model: 'gpt-test',
        status: 'completed',
        output: [
          { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '继续完成' }] },
          { type: 'function_call', call_id: 'call-1', name: 'search', arguments: '{"query":"x"}' },
        ],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
      }), calls),
    })

    const result = await adapter.generate({
      ...request,
      model: 'gpt-test',
      messages: [{ role: 'user', content: [{ type: 'text', text: '继续分析' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }],
      officialCompactionItems: [{ type: 'compaction', encrypted_content: 'opaque' }],
    })

    expect(result).toMatchObject({ text: '继续完成', toolCalls: [{ id: 'call-1', name: 'search', arguments: '{"query":"x"}' }] })
    expect(String(calls[0]?.input)).toBe('https://api.openai.com/v1/responses')
    expect(bodyOf(calls[0])).toMatchObject({
      model: 'gpt-test',
      store: false,
      input: [
        { type: 'compaction', encrypted_content: 'opaque' },
        { role: 'user', content: [
          { type: 'input_text', text: '继续分析' },
          { type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' },
        ] },
      ],
    })
  })

  it('keeps official compaction items when the caller uses the streaming interface', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new OpenAICompatibleTextAdapter({
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key-test',
      fetch: fixtureFetch(jsonResponse({
        status: 'completed',
        output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '延续压缩上下文' }] }],
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      }), calls),
    })

    const events = []
    for await (const event of adapter.stream({
      ...request,
      model: 'gpt-test',
      officialCompactionItems: [{ type: 'compaction', encrypted_content: 'opaque' }],
    })) events.push(event)

    expect(String(calls[0]?.input)).toBe('https://api.openai.com/v1/responses')
    expect(bodyOf(calls[0])).toMatchObject({ input: [
      { type: 'compaction', encrypted_content: 'opaque' },
      expect.objectContaining({ role: 'user' }),
    ] })
    expect(events).toEqual(expect.arrayContaining([
      { type: 'text_delta', text: '延续压缩上下文' },
      { type: 'usage', usage: { inputTokens: 8, outputTokens: 3, totalTokens: 11 } },
      { type: 'finish', reason: 'completed' },
    ]))
  })

  it.each([
    ['openai', 'openai'],
    ['deepseek', 'deepseek'],
    ['glm', 'glm'],
    ['kimi', 'kimi'],
  ] as const)('maps %s to the OpenAI Chat Completions contract', async (provider, expectedProvider) => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = createTextModelAdapter({
      providerType: provider,
      baseUrl: 'https://provider.example/v1',
      apiKey: 'key-test',
      fetch: fixtureFetch(jsonResponse({
        id: 'chat-1',
        model: 'model-test',
        choices: [{ message: { role: 'assistant', content: '完成。', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search', arguments: '{"query":"x"}' } }] }, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 4, completion_tokens: 6, total_tokens: 10, completion_tokens_details: { reasoning_tokens: 3 } },
      }), calls),
    })

    expect(adapter).toBeInstanceOf(OpenAICompatibleTextAdapter)
    expect(adapter.providerType).toBe(expectedProvider)
    const result = await adapter.generate(request)
    expect(result).toMatchObject({ id: 'chat-1', model: 'model-test', text: '完成。', finishReason: 'tool_calls', usage: { inputTokens: 4, outputTokens: 6, totalTokens: 10, reasoningTokens: 3 } })
    expect(result.toolCalls).toEqual([{ id: 'call-1', name: 'search', arguments: '{"query":"x"}' }])
    expect(String(calls[0].input)).toBe('https://provider.example/v1/chat/completions')
    expect(calls[0].init?.headers).toMatchObject({ authorization: 'Bearer key-test', 'content-type': 'application/json' })
    expect(bodyOf(calls[0])).toMatchObject({ model: 'model-test', stream: false, web_search_options: {}, tools: [{ type: 'function', function: expect.objectContaining({ name: 'search' }) }] })
  })

  it('normalizes OpenAI SSE text, tool-call deltas, usage, and finish events', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new OpenAICompatibleTextAdapter({ baseUrl: 'https://api.openai.com', apiKey: 'key-test', fetch: fixtureFetch(sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '你好' }, index: 0 }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'search', arguments: '{"q":' } }] } }] }),
      JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } } }),
      '[DONE]',
    ]), calls) })
    const events = []
    for await (const event of adapter.stream({ ...request, tools: undefined })) events.push(event)
    expect(events).toEqual([
      { type: 'text_delta', text: '你好' },
      { type: 'tool_call_delta', index: 0, id: 'call-1', name: 'search', argumentsDelta: '{"q":' },
      { type: 'tool_call_delta', index: 0, argumentsDelta: '"x"}' },
      { type: 'usage', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5, reasoningTokens: 1 } },
      { type: 'finish', reason: 'stop' },
    ])
    expect(bodyOf(calls[0])).toMatchObject({ stream: true })
  })

  it('maps Anthropic Messages, system instructions, vision, tools and web search', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new AnthropicTextAdapter({ baseUrl: 'https://api.anthropic.com', apiKey: 'anthropic-key', fetch: fixtureFetch(jsonResponse({
      id: 'msg-1', model: 'claude-test', role: 'assistant',
      content: [{ type: 'text', text: '已完成' }, { type: 'tool_use', id: 'tool-1', name: 'search', input: { query: 'x' } }],
      stop_reason: 'tool_use', usage: { input_tokens: 7, output_tokens: 8 },
    }), calls) })
    const result = await adapter.generate({ ...request, model: 'claude-test', messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image', data: 'aGVsbG8=', mimeType: 'image/png' }] }] })
    expect(result).toMatchObject({ id: 'msg-1', text: '已完成', finishReason: 'tool_use', usage: { inputTokens: 7, outputTokens: 8, totalTokens: 15 } })
    expect(result.toolCalls).toEqual([{ id: 'tool-1', name: 'search', arguments: '{"query":"x"}' }])
    expect(String(calls[0].input)).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].init?.headers).toMatchObject({ 'x-api-key': 'anthropic-key', 'anthropic-version': '2023-06-01' })
    const body = bodyOf(calls[0])
    expect(body).toMatchObject({ model: 'claude-test', max_tokens: 120, system: '你是一个严谨的助手。' })
    expect(body.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'search', input_schema: request.tools?.[0].inputSchema }),
      expect.objectContaining({ type: 'web_search_20250305', name: 'web_search' }),
    ]))
    expect((body.messages as Array<Record<string, unknown>>)[0].content).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } },
    ])
  })

  it('maps tool results to provider-native tool response messages', async () => {
    const anthropicCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const anthropic = new AnthropicTextAdapter({ baseUrl: 'https://api.anthropic.com', apiKey: 'key', fetch: fixtureFetch(jsonResponse({ content: [{ type: 'text', text: 'ok' }] }), anthropicCalls) })
    await anthropic.generate({ ...request, messages: [{ role: 'tool', toolCallId: 'tool-1', content: '搜索结果' }] })
    expect((bodyOf(anthropicCalls[0]).messages as Array<Record<string, unknown>>)[0]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: '搜索结果' }] })

    const geminiCalls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const gemini = new GeminiTextAdapter({ baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'key', fetch: fixtureFetch(jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), geminiCalls) })
    await gemini.generate({ ...request, messages: [{ role: 'tool', name: 'search', content: '搜索结果' }] })
    expect((bodyOf(geminiCalls[0]).contents as Array<Record<string, unknown>>)[0]).toEqual({ role: 'user', parts: [{ functionResponse: { name: 'search', response: { result: '搜索结果' } } }] })
  })

  it('normalizes Anthropic SSE content and message events', async () => {
    const adapter = new AnthropicTextAdapter({ baseUrl: 'https://api.anthropic.com', apiKey: 'key', fetch: async () => sseResponse([
      JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 3 } } }),
      JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: '流式' } }),
      JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tool-1', name: 'search' } }),
      JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"q":' } }),
      JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }),
    ]) })
    const events = []
    for await (const event of adapter.stream({ ...request, model: 'claude-test' })) events.push(event)
    expect(events).toEqual([
      { type: 'usage', usage: { inputTokens: 3 } },
      { type: 'text_delta', text: '流式' },
      { type: 'tool_call_delta', index: 1, id: 'tool-1', name: 'search', argumentsDelta: '{"q":' },
      { type: 'usage', usage: { outputTokens: 4 } },
      { type: 'finish', reason: 'end_turn' },
    ])
  })

  it('maps Gemini GenerateContent and native Google Search', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = []
    const adapter = new GeminiTextAdapter({ baseUrl: 'https://generativelanguage.googleapis.com', apiKey: 'gemini-key', fetch: fixtureFetch(jsonResponse({
      responseId: 'resp-1', modelVersion: 'gemini-test', candidates: [{ content: { parts: [{ text: 'Gemini 完成' }, { functionCall: { name: 'search', args: { query: 'x' } } }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 6, thoughtsTokenCount: 2, totalTokenCount: 13 },
    }), calls) })
    const result = await adapter.generate({ ...request, model: 'gemini-test' })
    expect(result).toMatchObject({ id: 'resp-1', model: 'gemini-test', text: 'Gemini 完成', finishReason: 'STOP', usage: { inputTokens: 5, outputTokens: 6, totalTokens: 13, reasoningTokens: 2 } })
    expect(result.toolCalls).toEqual([{ id: 'search', name: 'search', arguments: '{"query":"x"}' }])
    expect(String(calls[0].input)).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent')
    expect(String(calls[0].input)).not.toContain('gemini-key')
    expect(calls[0].init?.headers).toMatchObject({ 'x-goog-api-key': 'gemini-key' })
    const body = bodyOf(calls[0])
    expect(body.tools).toEqual(expect.arrayContaining([{ googleSearch: {} }, expect.objectContaining({ functionDeclarations: expect.any(Array) })]))
    expect(body.systemInstruction).toEqual({ parts: [{ text: '你是一个严谨的助手。' }] })
  })

  it('normalizes Gemini SSE/JSON stream parts and finish metadata', async () => {
    const adapter = new GeminiTextAdapter({ baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: 'key', fetch: async () => sseResponse([
      '{"candidates":[{"content":{"parts":[{"text":"你好"}]}}]}',
      '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"search","args":{"query":"x"}}}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":1,"candidatesTokenCount":2,"thoughtsTokenCount":1,"totalTokenCount":4}}',
    ]) })
    const events = []
    for await (const event of adapter.stream({ ...request, model: 'gemini-test' })) events.push(event)
    expect(events).toEqual([
      { type: 'text_delta', text: '你好' },
      { type: 'tool_call_delta', name: 'search', argumentsDelta: '{"query":"x"}' },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 4, reasoningTokens: 1 } },
      { type: 'finish', reason: 'STOP' },
    ])
  })

  it('classifies authentication and rate-limit responses with retry hints', async () => {
    const auth = new OpenAICompatibleTextAdapter({ baseUrl: 'https://provider.example', apiKey: 'bad', fetch: async () => jsonResponse({ error: { message: '密钥无效' } }, 401, { 'x-request-id': 'req-auth' }) })
    await expect(auth.generate(request)).rejects.toMatchObject({ code: 'auth', status: 401, provider: 'openai-compatible', requestId: 'req-auth', message: '密钥无效' })

    const authFallback = new OpenAICompatibleTextAdapter({ baseUrl: 'https://provider.example', apiKey: 'bad', fetch: async () => new Response('', { status: 401, headers: { 'x-request-id': 'req-fallback' } }) })
    await expect(authFallback.generate(request)).rejects.toMatchObject({ code: 'auth', status: 401, message: 'API Key 无效或已过期' })

    const limited = new OpenAICompatibleTextAdapter({ baseUrl: 'https://provider.example', apiKey: 'key', fetch: async () => jsonResponse({ error: { message: '稍后重试' } }, 429, { 'retry-after': '2' }) })
    await expect(limited.generate(request)).rejects.toMatchObject({ code: 'rate_limit', status: 429, retryAfterMs: 2000 })
  })

  it('propagates cancellation to fetch and exposes a transport-neutral cancelled error', async () => {
    const controller = new AbortController()
    let receivedSignal: AbortSignal | undefined
    const adapter = new OpenAICompatibleTextAdapter({ baseUrl: 'https://provider.example', apiKey: 'key', fetch: async (_input, init) => {
      receivedSignal = init?.signal
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) reject(new DOMException('Aborted', 'AbortError'))
        else init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
      })
    } })
    const pending = adapter.generate({ ...request, signal: controller.signal })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled', provider: 'openai-compatible' })
    expect(receivedSignal).toBe(controller.signal)
  })

  it('supports newline-delimited JSON when a compatible server does not use SSE', async () => {
    const adapter = new OpenAICompatibleTextAdapter({ baseUrl: 'https://provider.example', apiKey: 'key', fetch: async () => new Response('{"choices":[{"delta":{"content":"a"}}]}\n{"choices":[{"delta":{"content":"b"}}]}\n') })
    const text: string[] = []
    for await (const event of adapter.stream({ ...request, tools: undefined, search: undefined })) if (event.type === 'text_delta') text.push(event.text)
    expect(text).toEqual(['a', 'b'])
  })

  it('safely handles SSE streams with event, id, comment lines and [DONE]', async () => {
    const rawSse = [
      ': ping comment',
      'event: message_start',
      'id: 101',
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'hello ' } }] })}`,
      '',
      'event: content_block_delta',
      'id: 102',
      `data: ${JSON.stringify({ choices: [{ delta: { content: 'world' }, finish_reason: 'stop' }] })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const adapter = new OpenAICompatibleTextAdapter({ baseUrl: 'https://provider.example', apiKey: 'key', fetch: async () => new Response(rawSse, { headers: { 'content-type': 'text/event-stream' } }) })
    const text: string[] = []
    for await (const event of adapter.stream({ ...request, tools: undefined, search: undefined })) if (event.type === 'text_delta') text.push(event.text)
    expect(text).toEqual(['hello ', 'world'])
  })
})
