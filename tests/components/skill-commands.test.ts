import { describe, expect, it } from 'vitest'
import {
  clearSkillCommandDraft,
  eligibleComposerSkills,
  parseSkillCommand,
  resolveSkillMenuKey,
  skillCommandQuery,
} from '../../src/components/ai-input-bar/skill-commands'
import type { SkillInstallation } from '../../src/shared/contracts/skills'

function skill(input: Partial<SkillInstallation> & Pick<SkillInstallation, 'id' | 'name'>): SkillInstallation {
  return {
    displayName: input.name,
    rootPath: '/tmp/skill',
    scope: 'global',
    source: 'link',
    enabled: true,
    trusted: true,
    trustMode: 'controlled',
    contentHash: 'hash',
    updatedAt: '2026-09-15T00:00:00.000Z',
    ...input,
  }
}

describe('composer Skill slash commands', () => {
  const skills = [
    skill({ id: 'image-id', name: 'image-prompt', displayName: '图片提示词' }),
    skill({ id: 'text-id', name: 'text-writer', displayName: '文本写作' }),
  ]

  it('finds a query only while the first slash command is being typed', () => {
    expect(skillCommandQuery('/')).toBe('')
    expect(skillCommandQuery('/image')).toBe('image')
    expect(skillCommandQuery('/image 帮我写')).toBeNull()
    expect(skillCommandQuery('请使用 /image')).toBeNull()
  })

  it('removes a recognized command from the prompt and resolves it for this turn only', () => {
    expect(parseSkillCommand('/image-prompt  分析这张图', skills)).toEqual({
      prompt: '分析这张图',
      skillId: 'image-id',
    })
    expect(parseSkillCommand('/text-writer 改写下一段', skills)).toEqual({
      prompt: '改写下一段',
      skillId: 'text-id',
    })
    expect(parseSkillCommand('后续不再显式选择', skills)).toEqual({ prompt: '后续不再显式选择' })
  })

  it('does not offer disabled, untrusted, or unauthorized project Skills', () => {
    const values = eligibleComposerSkills([
      ...skills,
      skill({ id: 'disabled', name: 'disabled', enabled: false }),
      skill({ id: 'untrusted', name: 'untrusted', trusted: false }),
      skill({ id: 'project', name: 'project', scope: 'project', projectAuthorized: false }),
    ])
    expect(values.map((item) => item.id)).toEqual(['image-id', 'text-id'])
  })

  it('dismisses an empty Skill menu with Escape', () => {
    expect(resolveSkillMenuKey('Escape', 0, 0)).toEqual({ type: 'dismiss' })
    expect(resolveSkillMenuKey('ArrowDown', 0, 0)).toBeNull()
    expect(resolveSkillMenuKey('ArrowDown', 3, 2)).toEqual({ type: 'move', index: 0 })
    expect(resolveSkillMenuKey('ArrowUp', 3, 0)).toEqual({ type: 'move', index: 2 })
    expect(resolveSkillMenuKey('Enter', 3, 1)).toEqual({ type: 'select', index: 1 })
    expect(resolveSkillMenuKey('Enter', 3, 1, true)).toBeNull()
  })

  it('clears an unfinished Skill command before opening another composer panel', () => {
    expect(clearSkillCommandDraft('/')).toBe('')
    expect(clearSkillCommandDraft('/image')).toBe('')
    expect(clearSkillCommandDraft('/image 继续处理')).toBe('/image 继续处理')
    expect(clearSkillCommandDraft('普通提示词')).toBe('普通提示词')
  })
})
