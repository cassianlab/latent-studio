import { describe, expect, it } from 'vitest'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { MarkdownViewer } from '../../src/renderer/library/MarkdownViewer'

describe('MarkdownViewer', () => {
  it('renders markdown headings, lists, blockquotes, code blocks, and tables', () => {
    const md = [
      '# 标题一',
      '## 标题二',
      '> 这是一段引用',
      '- 列表项 1',
      '- 列表项 2',
      '```python',
      'print("hello")',
      '```',
      '| 角色 | 年龄 |',
      '| --- | --- |',
      '| 主角 | 24 |',
    ].join('\n')

    const html = renderToString(React.createElement(MarkdownViewer, { content: md, format: 'markdown' }))
    expect(html).toContain('md-h1')
    expect(html).toContain('标题一')
    expect(html).toContain('md-h2')
    expect(html).toContain('标题二')
    expect(html).toContain('md-blockquote')
    expect(html).toContain('这是一段引用')
    expect(html).toContain('md-ul')
    expect(html).toContain('列表项 1')
    expect(html).toContain('md-code-block')
    expect(html).toContain('print(&quot;hello&quot;)')
    expect(html).toContain('md-table')
    expect(html).toContain('主角')
  })

  it('renders JSON in formatted code view', () => {
    const jsonStr = JSON.stringify({ name: '导演生图工作站', version: '0.5.0' })
    const html = renderToString(React.createElement(MarkdownViewer, { content: jsonStr, format: 'json' }))
    expect(html).toContain('md-code-block')
    expect(html).toContain('导演生图工作站')
    expect(html).toContain('0.5.0')
  })

  it('renders plain text gracefully', () => {
    const text = '这是纯文本记录。'
    const html = renderToString(React.createElement(MarkdownViewer, { content: text, format: 'text' }))
    expect(html).toContain('md-plain-text')
    expect(html).toContain('这是纯文本记录。')
  })

  it('does not create executable links from unsafe markdown URLs', () => {
    const html = renderToString(React.createElement(MarkdownViewer, {
      content: '[正常链接](https://example.com) [危险链接](javascript:alert(1))',
      format: 'markdown',
    }))

    expect(html).toContain('href="https://example.com"')
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain('危险链接')
  })
})
