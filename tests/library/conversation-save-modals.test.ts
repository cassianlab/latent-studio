import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DocumentEditorModal } from '../../src/renderer/library/DocumentEditorModal'
import { MemoryEditorModal } from '../../src/renderer/library/MemoryEditorModal'
import { SavePromptModal } from '../../src/renderer/library/SavePromptModal'

vi.mock('@radix-ui/react-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@radix-ui/react-dialog')>()
  return {
    ...actual,
    Portal: ({ children }: { children: React.ReactNode }) => createElement('div', { className: 'radix-portal-mock' }, children),
  }
})

describe('Conversation Save Modals Integration', () => {
  it('renders DocumentEditorModal with initial conversation content and title', () => {
    const markup = renderToStaticMarkup(
      createElement(DocumentEditorModal, {
        open: true,
        initialTitle: '雨夜分镜设计',
        initialContent: '这是从对话中提炼出的场景设计文档内容。',
        initialFormat: 'md',
        onClose: () => undefined,
        onSaved: () => undefined,
      })
    )

    expect(markup).toContain('保存为项目文档')
    expect(markup).toContain('雨夜分镜设计')
    expect(markup).toContain('这是从对话中提炼出的场景设计文档内容。')
    expect(markup).toContain('Markdown (.md)')
    expect(markup).toContain('纯文本 (.txt)')
    expect(markup).toContain('JSON 数据 (.json)')
    expect(markup).toContain('保存文档')
  })

  it('renders MemoryEditorModal with initial conversation content and title', () => {
    const markup = renderToStaticMarkup(
      createElement(MemoryEditorModal, {
        open: true,
        initialTitle: '胶片调色视觉规范',
        initialContent: '强调青蓝与琥珀双色温对比，高光柔化。',
        initialScope: 'project',
        initialSource: '从对话提炼',
        onClose: () => undefined,
        onSaved: () => undefined,
      })
    )

    expect(markup).toContain('保存为项目记忆')
    expect(markup).toContain('胶片调色视觉规范')
    expect(markup).toContain('强调青蓝与琥珀双色温对比，高光柔化。')
    expect(markup).toContain('从对话提炼')
    expect(markup).toContain('确认创建')
  })

  it('renders SavePromptModal with initial prompt content and extracted name', () => {
    const promptText = 'cinematic photo of neo tokyo at dusk, neon reflections, anamorphic lens flare'
    const markup = renderToStaticMarkup(
      createElement(SavePromptModal, {
        open: true,
        initialContent: promptText,
        onOpenChange: () => undefined,
      })
    )

    expect(markup).toContain('保存提示词')
    expect(markup).toContain('保留原始、优化和实际执行版本')
    expect(markup).toContain('当前项目')
    expect(markup).toContain('全局')
    expect(markup).toContain('提示词')
    expect(markup).toContain('模板')
    expect(markup).toContain('风格')
    expect(markup).toContain('保存到提示词库')
    expect(markup).toContain(promptText)
  })

  it('extracts clean title candidate from conversation markdown and plain text', () => {
    const extractTitle = (text: string, maxLen = 40): string => {
      const firstHeading = text.match(/^#+\s*(.+)$/m)?.[1]?.trim()
      const firstLine = text.split(/\n+/)[0]?.replace(/^#+\s*/, '').trim()
      const candidate = firstHeading || firstLine || '关键对话记忆'
      return candidate.length > maxLen ? `${candidate.slice(0, maxLen)}…` : candidate
    }

    expect(extractTitle('# 赛博朋克镜头构图方案\n\n1. 广角远景')).toBe('赛博朋克镜头构图方案')
    expect(extractTitle('### 光学景深设定\n详细参数如下')).toBe('光学景深设定')
    const longText = '这是一段非常非常非常非常非常非常非常非常非常非常非常非常非常非常长的第一行文本内容描述'
    expect(extractTitle(longText, 20)).toBe('这是一段非常非常非常非常非常非常非常非常…')
  })
})
