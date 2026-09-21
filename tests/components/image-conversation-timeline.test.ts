import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { buildImageResultMessage, ImageConversation } from '../../src/renderer/image/ImageConversation'
import { SharedResultGallery } from '../../src/renderer/conversation/SharedResultGallery'

describe('image conversation shared timeline', () => {
  it('renders text and Agent turns from the shared session history', () => {
    const markup = renderToStaticMarkup(createElement(ImageConversation, {
      sessionMessages: [
        { id: 'text-user', role: 'user', text: '先分析角色设定', mode: 'text', createdAt: 1 },
        { id: 'agent-assistant', role: 'assistant', text: '已整理好角色不变量', mode: 'agent', createdAt: 2 },
      ],
    }))

    expect(markup).toContain('先分析角色设定')
    expect(markup).toContain('已整理好角色不变量')
  })

  it('creates an assistant turn that owns newly submitted image tasks', () => {
    const message = buildImageResultMessage([
      { id: 'image-1' },
      { id: 'image-2' },
    ], 100, { inputTokens: 900, outputTokens: 100, totalTokens: 1_000, contextTokens: 1_000 })

    expect(message).toMatchObject({
      role: 'assistant',
      mode: 'image',
      text: '已提交 2 个图片任务，生成结果会在本轮对话中逐张更新。',
      imageTaskIds: ['image-1', 'image-2'],
      usage: { inputTokens: 900, outputTokens: 100, totalTokens: 1_000, contextTokens: 1_000 },
      createdAt: 100,
    })
  })

  it('renders failed image tasks as a compact summary instead of empty image cards', () => {
    const now = '2026-09-16T12:00:00.000Z'
    const markup = renderToStaticMarkup(createElement(SharedResultGallery, {
      inline: true,
      results: [
        {
          id: 'completed',
          title: 'Agent 任务 1',
          status: 'completed',
          task: {
            id: 'completed', connectionId: 'image', status: 'completed', attempts: 1, maxRetries: 2, createdAt: now, updatedAt: now,
            request: { prompt: '完成图片', outputSize: '2048x1152', outputFormat: 'png' },
            result: { images: [{ b64Json: 'aA==', mimeType: 'image/png', width: 2048, height: 1152 }] },
          },
        },
        {
          id: 'failed',
          title: 'Agent 任务 2',
          status: 'failed',
          task: {
            id: 'failed', connectionId: 'image', status: 'failed', attempts: 1, maxRetries: 2, createdAt: now, updatedAt: now,
            request: { prompt: '失败图片', outputSize: '2048x1152', outputFormat: 'png' },
            error: { code: 'rate_limit', message: 'Image generation is busy, please retry later' },
          },
        },
      ],
      onChange: () => {},
      onCanvas: () => {},
      onEditor: () => {},
      onSavePrompt: () => {},
    }))

    expect(markup.match(/<article class="result-card/g)).toHaveLength(1)
    expect(markup).toContain('本轮生成 · 1 张')
    expect(markup).toContain('1 个任务生成失败 · 图片服务繁忙，可在任务中心重试')
    expect(markup).not.toContain('image-placeholder')
  })
})
