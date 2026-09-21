import { access, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { searchWeb } from '../../src/main/search/service'

describe('web search service', () => {
  it('parses result links and persists a project-scoped snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'latent-search-'))
    const html = '<div><a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fone">第一条</a><a class="result__snippet">第一条摘要 &amp; 说明</a></div><div><a class="result__a" href="https://example.org/two">第二条</a></div>'
    const result = await searchWeb({ query: '雨夜视觉', maxResults: 2 }, { getProjectRoot: () => root, fetch: async () => new Response(html, { status: 200 }) })
    expect(result.query).toBe('雨夜视觉')
    expect(result.results).toEqual([
      { title: '第一条', url: 'https://example.com/one', snippet: '第一条摘要 & 说明', source: 'example.com' },
      { title: '第二条', url: 'https://example.org/two', snippet: '', source: 'example.org' },
    ])
    await expect(access(join(root, '.latent-studio', 'search.json'))).resolves.toBeUndefined()
    expect(JSON.parse(await readFile(join(root, '.latent-studio', 'search.json'), 'utf8')).items[0].query).toBe('雨夜视觉')
  })

  it('rejects an empty or oversized query before network access', async () => {
    let calls = 0
    const fetch = async () => { calls += 1; return new Response('') }
    await expect(searchWeb({ query: '' }, { fetch })).rejects.toThrow('搜索关键词')
    await expect(searchWeb({ query: 'x'.repeat(501) }, { fetch })).rejects.toThrow('搜索关键词')
    expect(calls).toBe(0)
  })
})
