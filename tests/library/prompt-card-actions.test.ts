import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { PromptCard } from '../../src/renderer/library/PromptCard'
import { promptApplyAction } from '../../src/renderer/agent/PromptSearchCards'
import { PromptParameterDialog } from '../../src/components/prompt-template/PromptParameterDialog'
import type { PromptAsset } from '../../src/shared/contracts/library'

vi.mock('@radix-ui/react-tooltip', () => ({
  Root: ({ children }: { children: React.ReactNode }) => createElement('span', null, children),
  Trigger: ({ children }: { children: React.ReactNode }) => createElement('span', null, children),
  Portal: ({ children }: { children: React.ReactNode }) => createElement('span', null, children),
  Content: ({ children }: { children: React.ReactNode }) => createElement('span', null, children),
}))

const prompt = (source: PromptAsset['source']): PromptAsset => ({
  id: `prompt-${source}`,
  name: source === 'import' ? '开源模板' : '我的模板',
  content: '为{主体}创作画面',
  kind: 'template',
  scope: 'global',
  version: 1,
  tags: [],
  favorite: false,
  source,
  collection: source === 'import' ? '开源仓库' : '个人',
  category: '通用',
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
})

describe('prompt card actions', () => {
  it('uses a numbered step for templates with four or more parameters', () => {
    const markup = renderToStaticMarkup(createElement(PromptParameterDialog, {
      open: true,
      template: '{主体}{动作}{场景}{光线}',
      onCancel: () => undefined,
      onApply: () => undefined,
    }))

    expect(markup).toContain('1 / 4')
    expect(markup).toContain('主体')
    expect(markup).not.toContain('光线')
  })

  it('routes template apply through the parameter dialog', () => {
    expect(promptApplyAction({
      id: 'template-1',
      title: '人像模板',
      content: '为{主体}创作[风格：写实/插画]人像',
      category: '人像',
      type: 'template',
      score: 0.9,
      reason: '标题命中',
      retrievalMode: 'lexical',
    })).toBe('parameters')
  })

  it('routes imported prompts with YouMind arguments through the parameter dialog regardless of asset kind', () => {
    expect(promptApplyAction({
      id: 'youmind-1',
      title: '产品海报',
      content: '背景为 {argument name="background color" default="柔和蓝色"}',
      category: '产品',
      type: 'prompt',
      score: 0.9,
      reason: '语义命中',
      retrievalMode: 'hybrid',
    })).toBe('parameters')
  })

  it('does not offer deletion for read-only imported prompts', () => {
    const markup = renderToStaticMarkup(createElement(PromptCard, {
      item: prompt('import'),
      copied: false,
      onCopy: () => undefined,
      onApply: () => undefined,
      onEdit: () => undefined,
      onToggleFavorite: () => undefined,
      onRemove: () => undefined,
    }))

    expect(markup).toContain('另存 开源模板')
    expect(markup).not.toContain('删除 开源模板')
  })

  it('keeps deletion available for personal prompts', () => {
    const markup = renderToStaticMarkup(createElement(PromptCard, {
      item: prompt('manual'),
      copied: false,
      onCopy: () => undefined,
      onApply: () => undefined,
      onEdit: () => undefined,
      onToggleFavorite: () => undefined,
      onRemove: () => undefined,
    }))

    expect(markup).toContain('删除 我的模板')
  })
})
