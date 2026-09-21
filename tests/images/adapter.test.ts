import { describe, expect, it } from 'vitest'
import { ImageModelError, OpenAICompatibleImageAdapter } from '../../src/main/images'

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

describe('OpenAI-compatible image adapter', () => {
  it('sends a generation request to the versioned endpoint and maps safe metadata', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    const adapter = new OpenAICompatibleImageAdapter({
      baseUrl: 'https://images.example.test/v1/',
      apiKey: 'secret-key',
      providerType: 'openai',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init })
        return jsonResponse({ id: 'img-1', model: 'image-test', created: 1_700_000_000, data: [{ b64_json: 'aGVsbG8=', revised_prompt: 'expanded' }] })
      },
    })

    const result = await adapter.generate({ model: 'image-test', prompt: '一只猫', size: '1024x1024', n: 1 })
    expect(calls[0]?.url).toBe('https://images.example.test/v1/images/generations')
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer secret-key', 'content-type': 'application/json' })
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ model: 'image-test', prompt: '一只猫', n: 1, size: '1024x1024' })
    expect(result).toMatchObject({ id: 'img-1', model: 'image-test', images: [{ b64Json: 'aGVsbG8=', revisedPrompt: 'expanded' }] })
    expect(JSON.stringify(result)).not.toContain('secret-key')
    expect((result as unknown as { raw?: unknown }).raw).toBeUndefined()
  })

  it('uses multipart edits and reads file references through the injected port', async () => {
    let body: FormData | undefined
    const adapter = new OpenAICompatibleImageAdapter({
      baseUrl: 'https://gateway.example.test',
      apiKey: 'key',
      fetch: async (_url, init) => {
        body = init?.body as FormData
        return jsonResponse({ data: [{ url: 'https://cdn.example.test/out.png' }] })
      },
      readFile: async (filePath) => {
        expect(filePath).toBe('/project/reference.png')
        return { bytes: Uint8Array.from([1, 2, 3]), mimeType: 'image/png', filename: 'hero.png' }
      },
    })

    const result = await adapter.edit({
      operation: 'edit',
      model: 'image-edit',
      prompt: '移除右侧路人',
      references: [
        { type: 'data', data: 'aGVsbG8=', mimeType: 'image/png', filename: 'original.png' },
        { type: 'file', path: '/project/reference.png' },
      ],
      background: 'transparent',
      outputFormat: 'png',
      mask: { type: 'data', data: 'aGVsbG8=', mimeType: 'image/png', filename: 'mask.png' },
    })
    expect(result.images[0]?.url).toBe('https://cdn.example.test/out.png')
    expect(body).toBeInstanceOf(FormData)
    expect(body?.get('model')).toBe('image-edit')
    expect(body?.get('prompt')).toBe('移除右侧路人')
    expect(body?.get('background')).toBe('transparent')
    expect(body?.get('output_format')).toBe('png')
    expect(body?.getAll('image[]')).toHaveLength(2)
    expect(body?.get('mask')).toBeInstanceOf(Blob)
  })

  it('classifies provider errors and preserves cancellation', async () => {
    const adapter = new OpenAICompatibleImageAdapter({
      baseUrl: 'https://images.example.test/v1',
      apiKey: 'key',
      fetch: async () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 429, headers: { 'retry-after': '2' } }),
    })
    await expect(adapter.generate({ model: 'image-test', prompt: 'x' })).rejects.toMatchObject({ code: 'rate_limit', status: 429, retryAfterMs: 2000 })

    const controller = new AbortController()
    controller.abort()
    await expect(adapter.generate({ model: 'image-test', prompt: 'x', signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' })
    expect(() => new ImageModelError('auth', 'x')).not.toThrow()
  })

  it('contracts: GPT Image 2 maps supported quality to the provider values', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = []
    const adapter = new OpenAICompatibleImageAdapter({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-gpt-img-2',
      providerType: 'openai',
      fetch: async (url, init) => {
        calls.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return jsonResponse({ data: [{ url: 'https://cdn.openai.com/gptimage.png' }] })
      },
    })

    await adapter.generate({ model: 'gpt-image-2', prompt: 'a landscape', quality: 'high' })
    expect(calls[0]?.body.quality).toBe('high')
  })

  it('contracts: GPT Image 2.5 forwards xhigh and max quality values', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    const adapter = new OpenAICompatibleImageAdapter({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-gpt-img-25',
      providerType: 'openai',
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
      },
    })

    await adapter.generate({ model: 'gpt-image-2.5-sunburst', prompt: 'a landscape', size: '3840x2160', quality: 'xhigh' })
    await adapter.generate({ model: 'gpt-image-2.5-flare', prompt: 'a landscape', size: '2048x1152', quality: 'max' })
    expect(calls).toEqual([
      { body: expect.objectContaining({ model: 'gpt-image-2.5-sunburst', size: '3840x2160', quality: 'xhigh' }) },
      { body: expect.objectContaining({ model: 'gpt-image-2.5-flare', size: '2048x1152', quality: 'max' }) },
    ])
  })

  it('contracts: GPT Image 2.5 requests a transparent PNG background', async () => {
    const calls: Array<{ body: Record<string, unknown> }> = []
    const adapter = new OpenAICompatibleImageAdapter({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test-gpt-img-25',
      providerType: 'openai',
      fetch: async (_url, init) => {
        calls.push({ body: JSON.parse(String(init?.body)) })
        return jsonResponse({ data: [{ b64_json: 'aGVsbG8=' }] })
      },
    })

    await adapter.generate({
      model: 'gpt-image-2.5-sunburst',
      prompt: 'isolated red chair',
      background: 'transparent',
      outputFormat: 'png',
    })

    expect(calls[0]?.body).toMatchObject({ background: 'transparent', output_format: 'png' })
    await expect(adapter.generate({
      model: 'gpt-image-2.5-sunburst',
      prompt: 'isolated red chair',
      background: 'transparent',
      outputFormat: 'jpeg',
    })).rejects.toMatchObject({ code: 'invalid_request' })
  })

})
