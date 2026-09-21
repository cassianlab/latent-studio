import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConversationArtifacts } from '../../src/renderer/agent/ConversationArtifacts'

describe('Agent conversation artifacts', () => {
  it('renders document reading and editing actions without expanding content by default', () => {
    const markup = renderToStaticMarkup(createElement(ConversationArtifacts, {
      artifacts: [{ type: 'document', operation: 'created', relativePath: 'documents/brief.md', name: 'brief.md', extension: '.md' }],
      onArtifactUpdated: () => undefined,
    }))

    expect(markup).toContain('已创建文档')
    expect(markup).toContain('brief.md')
    expect(markup).toContain('展开阅读')
    expect(markup).toContain('独立阅读')
    expect(markup).toContain('编辑文档')
    expect(markup).not.toContain('正在读取文档内容')
  })

  it('renders prompt identity and edits the existing prompt', () => {
    const markup = renderToStaticMarkup(createElement(ConversationArtifacts, {
      artifacts: [{ type: 'prompt', operation: 'updated', id: 'prompt-1', scope: 'global', name: '雨夜人像', promptKind: 'prompt', collection: '个人', category: '人像' }],
      onArtifactUpdated: () => undefined,
    }))

    expect(markup).toContain('已更新提示词')
    expect(markup).toContain('雨夜人像')
    expect(markup).toContain('展开查看')
    expect(markup).toContain('编辑提示词')
  })
})
