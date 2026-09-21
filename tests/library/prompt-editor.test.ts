import { describe, expect, it } from 'vitest'
import { createPromptEditorDraft, derivePromptTitle, normalizePromptEditorDraft, validatePromptEditorDraft } from '../../src/renderer/library/prompt-editor'

describe('prompt editor draft', () => {
  it('normalizes metadata and removes duplicate tags', () => {
    const normalized = normalizePromptEditorDraft({
      ...createPromptEditorDraft(),
      name: '  雨夜 人像  ',
      content: '  cinematic portrait  ',
      collection: '  个人灵感  ',
      category: '  人像  ',
      tagsText: '电影感，雨夜, 人像，电影感',
      previewUrl: '  https://example.com/preview.jpg  ',
      sourceUrl: '   ',
    })

    expect(normalized).toMatchObject({
      name: '雨夜 人像',
      content: 'cinematic portrait',
      collection: '个人灵感',
      category: '人像',
      tags: ['电影感', '雨夜', '人像'],
      previewUrl: 'https://example.com/preview.jpg',
    })
    expect(normalized).not.toHaveProperty('sourceUrl')
  })

  it('derives a bounded title and reports invalid source links', () => {
    expect(derivePromptTitle('一位年轻女子站在雨夜街头，手持相机，电影感侧光。')).toBe('一位年轻女子站在雨夜街头')
    expect(derivePromptTitle('A cinematic {subject} in [setting:rainy street/studio], soft light.')).toBe('A cinematic subject in setti')
    expect(validatePromptEditorDraft({
      ...createPromptEditorDraft(),
      name: '雨夜人像',
      content: '一位年轻女子站在雨夜街头。',
      sourceUrl: 'ftp://example.com/prompt',
    })).toMatchObject({ sourceUrl: '请输入 http 或 https 地址' })
  })
})
