import { describe, expect, it } from 'vitest'
import { confirmModelCapabilities, discoverModels } from '../../src/main/models/discovery'
import type { FetchImplementation } from '../../src/main/models/contracts'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

function fakeFetch(response: Response, seen: Array<{ url: string; init?: RequestInit }>): FetchImplementation {
  return async (input, init) => {
    seen.push({ url: String(input), init })
    return response
  }
}

describe('model discovery', () => {
  it('discovers OpenAI-compatible candidates without guessing capabilities', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const result = await discoverModels({
      providerType: 'deepseek',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key-a',
      fetch: fakeFetch(jsonResponse({
        object: 'list',
        data: [
          { id: 'deepseek-chat', object: 'model', owned_by: 'deepseek' },
          { id: 'deepseek-chat', object: 'model' },
          { id: 'deepseek-reasoner', object: 'model' },
        ],
        has_more: true,
        last_id: 'deepseek-reasoner',
      }), seen),
    })

    expect(seen[0]?.url).toBe('https://api.example.test/v1/models')
    expect(seen[0]?.init?.method).toBe('GET')
    expect(seen[0]?.init?.headers).toMatchObject({ authorization: 'Bearer key-a' })
    expect(result.protocol).toBe('openai.models')
    expect(result.nextPageToken).toBe('deepseek-reasoner')
    expect(result.models).toEqual([
      expect.objectContaining({ id: 'deepseek-chat', displayName: 'deepseek-chat', capabilitySource: 'unconfirmed', capabilities: [] }),
      expect.objectContaining({ id: 'deepseek-reasoner' }),
    ])
  })

  it('uses the Anthropic models protocol and preserves display names', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const result = await discoverModels({
      providerType: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      apiKey: 'anthropic-key',
      pageToken: 'before-id',
      fetch: fakeFetch(jsonResponse({
        data: [{ id: 'claude-sonnet-4', display_name: 'Claude Sonnet 4', type: 'model' }],
        has_more: false,
      }), seen),
    })

    expect(seen[0]?.url).toBe('https://api.anthropic.com/v1/models?after_id=before-id')
    expect(seen[0]?.init?.headers).toMatchObject({ 'x-api-key': 'anthropic-key', 'anthropic-version': '2023-06-01' })
    expect(result.models[0]).toMatchObject({ id: 'claude-sonnet-4', displayName: 'Claude Sonnet 4', capabilitySource: 'unconfirmed' })
  })

  it('uses Gemini list pagination and keeps the provider resource name', async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = []
    const result = await discoverModels({
      providerType: 'gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKey: 'gemini-key',
      pageToken: 'next page',
      adapterCapabilities: ['streaming', 'vision'],
      fetch: fakeFetch(jsonResponse({
        models: [{
          name: 'models/gemini-2.5-pro',
          displayName: 'Gemini 2.5 Pro',
          description: '用于文本和图片理解',
          supportedGenerationMethods: ['generateContent'],
        }],
        nextPageToken: 'next-2',
      }), seen),
    })

    expect(seen[0]?.url).toBe('https://generativelanguage.googleapis.com/v1beta/models?key=gemini-key&pageToken=next+page')
    expect(seen[0]?.init?.headers).toMatchObject({ accept: 'application/json' })
    expect(result.nextPageToken).toBe('next-2')
    expect(result.models[0]).toEqual(expect.objectContaining({
      id: 'gemini-2.5-pro',
      providerModelName: 'models/gemini-2.5-pro',
      displayName: 'Gemini 2.5 Pro',
      description: '用于文本和图片理解',
      capabilitySource: 'adapter',
      capabilities: ['streaming', 'vision'],
    }))
    expect(JSON.stringify(result)).not.toContain('generateContent')
  })

  it('applies explicit user confirmation without changing the model identity', async () => {
    const [candidate] = (await discoverModels({
      providerType: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'key-a',
      fetch: async () => jsonResponse({ data: [{ id: 'gpt-5' }] }),
    })).models
    const confirmed = confirmModelCapabilities(candidate, ['streaming', 'tool-calls', 'streaming'])
    expect(confirmed).toMatchObject({ id: 'gpt-5', capabilitySource: 'user', capabilities: ['streaming', 'tool-calls'] })
  })

  it('normalizes provider errors and rejects missing credentials before fetching', async () => {
    let calls = 0
    await expect(discoverModels({
      providerType: 'openai-compatible',
      baseUrl: 'https://api.example.test',
      apiKey: ' ',
      fetch: async () => { calls += 1; return jsonResponse({ data: [] }) },
    })).rejects.toMatchObject({ code: 'invalid_request', provider: 'openai-compatible' })
    expect(calls).toBe(0)

    await expect(discoverModels({
      providerType: 'kimi',
      baseUrl: 'https://api.example.test',
      apiKey: 'key-a',
      fetch: async () => jsonResponse({ error: { message: 'bad key' } }, 401),
    })).rejects.toMatchObject({ code: 'auth', provider: 'kimi', status: 401 })
  })
})
