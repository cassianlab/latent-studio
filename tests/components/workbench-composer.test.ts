import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Tooltip from '@radix-ui/react-tooltip'
import { beforeEach, describe, expect, it } from 'vitest'
import { getAgentWritePermissions, isContextCompactionCommand, resolveComposerEditDraftValue, resolveComposerImageCount, submitComposerDraft, WorkbenchComposer } from '../../src/components/ai-input-bar/WorkbenchComposer'
import type { Mode } from '../../src/mock-data'

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: () => null, setItem: () => undefined },
  })
})

function render(mode: Mode, agentWriteEnabled?: boolean): string {
  return renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(WorkbenchComposer, {
    mode,
    onMode: () => undefined,
    ...(agentWriteEnabled === undefined ? {} : { agentWriteEnabled }),
  })))
}

describe('workbench composer attachment entry points', () => {
  it('defaults image-producing modes to a single image', () => {
    expect(render('image')).toContain('aria-label="生成数量：1 个；')
    expect(render('agent')).toContain('aria-label="生成数量：1 个；')
    expect(render('image')).not.toContain('生成数量：4 个')
  })

  it('keeps the shared text model control visible in image mode', () => {
    const markup = render('image')
    expect(markup).toContain('文本模型：未配置文本模型')
  })

  it('only sends an Agent image count after the user explicitly chooses one', () => {
    expect(resolveComposerImageCount('agent', '1 个', false)).toBeUndefined()
    expect(resolveComposerImageCount('agent', '4 个', true)).toBe(4)
    expect(resolveComposerImageCount('image', '1 个', false)).toBe(1)
  })

  it('clears the submitted draft before the asynchronous Agent run finishes', async () => {
    let resolveSubmit: ((accepted: boolean) => void) | undefined
    const updates: string[] = []
    const pending = submitComposerDraft('检索三视图提示词', (value) => updates.push(typeof value === 'function' ? value('检索三视图提示词') : value), () => new Promise<boolean>((resolve) => { resolveSubmit = resolve }))
    expect(updates).toEqual([''])
    resolveSubmit?.(true)
    await expect(pending).resolves.toBe(true)
  })

  it('recognizes manual context compaction without treating other slash commands as compaction', () => {
    expect(isContextCompactionCommand('/压缩')).toBe(true)
    expect(isContextCompactionCommand('  /compact  ')).toBe(true)
    expect(isContextCompactionCommand('/image-prompt')).toBe(false)
  })

  it('marks estimated usage only when the conversation contains estimated tokens', () => {
    const empty = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(WorkbenchComposer, {
      mode: 'text',
      onMode: () => undefined,
      contextUsage: { usedTokens: 0, capacityTokens: 258_000, percent: 0, estimated: true },
    })))
    const estimated = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(WorkbenchComposer, {
      mode: 'text',
      onMode: () => undefined,
      contextUsage: { usedTokens: 280, capacityTokens: 258_000, percent: 0.1, estimated: true },
    })))

    expect(empty).toContain('上下文 0%')
    expect(empty).not.toContain('上下文约 0%')
    expect(estimated).toContain('上下文约 0.1%')
  })

  it('restores a rejected draft only when the user has not started typing another message', async () => {
    let current = '检索三视图提示词'
    const accepted = await submitComposerDraft(current, (value) => { current = typeof value === 'function' ? value(current) : value }, async () => false)
    expect(accepted).toBe(false)
    expect(current).toBe('检索三视图提示词')
  })

  it('restores a cancelled message as an editable draft with cancel and resend actions', () => {
    const markup = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(WorkbenchComposer, {
      mode: 'agent',
      onMode: () => undefined,
      editDraft: { id: 'user-1', text: '刚才误发的内容' },
      onCancelEdit: () => undefined,
    })))

    expect(markup).toContain('刚才误发的内容')
    expect(markup).toContain('aria-label="取消重新编辑"')
    expect(markup).toContain('重新编辑已停止的消息')
  })

  it('clears a restored message when its edit session is dismissed externally', () => {
    expect(resolveComposerEditDraftValue('重新编辑的内容', 'edit-1', undefined)).toBe('')
    expect(resolveComposerEditDraftValue('用户自己的草稿', undefined, undefined)).toBe('用户自己的草稿')
  })
  it('defaults project context on only in Agent mode and exposes one conversation-level write toggle there', () => {
    expect(render('text')).toContain('aria-label="未关联项目上下文（点击开启）"')
    expect(render('image')).toContain('aria-label="未关联项目上下文（点击开启）"')
    const agent = render('agent')
    expect(agent).toContain('aria-label="已关联项目上下文（点击关闭）"')
    expect(agent).toContain('aria-label="Agent 写入权限已开启（点击关闭）"')
    expect(agent).toContain('aria-pressed="true"')
    expect(agent).not.toContain('本轮写入权限')
    expect(render('agent', false)).toContain('aria-label="Agent 写入权限已关闭（点击开启）"')
    expect(render('agent', false)).toContain('aria-pressed="false"')
    expect(render('text')).not.toContain('Agent 写入权限')
  })

  it('maps the single Agent write toggle to every scoped write permission', () => {
    expect(getAgentWritePermissions(true)).toEqual([
      'write-project-documents',
      'write-project-memories',
      'write-personal-prompts',
    ])
    expect(getAgentWritePermissions(false)).toEqual([])
  })

  it('keeps project-file reading in text mode and removes it from image-producing modes', () => {
    const text = render('text')
    expect(text).toContain('aria-label="上传附件"')
    expect(text).toContain('aria-label="读取项目文件"')
    expect(text).toContain('选择参考图')

    for (const mode of ['image', 'agent'] as const) {
      const markup = render(mode)
      expect(markup).toContain('aria-label="上传附件"')
      expect(markup).toContain('选择参考图')
      expect(markup).not.toContain('aria-label="读取项目文件"')
    }
  })
})
