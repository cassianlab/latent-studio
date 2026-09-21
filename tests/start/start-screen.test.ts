import { describe, expect, it } from 'vitest'
import { WORKFLOW_TEMPLATES, filterRecentProjects } from '../../src/renderer/start/StartScreen'
import type { ProjectSummary } from '../../src/shared/contracts/projects'

describe('StartScreen workflow templates', () => {
  it('defines 4 cinematic workflow templates', () => {
    expect(WORKFLOW_TEMPLATES).toHaveLength(4)
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id)
    expect(ids).toEqual(['film-storyboard', 'character-concept', 'style-lab', 'hires-inpaint'])
  })

  it('has valid metadata and default configurations for each template', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(tpl.title.trim().length).toBeGreaterThan(0)
      expect(tpl.desc.trim().length).toBeGreaterThan(0)
      expect(tpl.tag.trim().length).toBeGreaterThan(0)
      expect(tpl.defaultProjectName.trim().length).toBeGreaterThan(0)
      expect(tpl.defaultProjectDesc.trim().length).toBeGreaterThan(0)
      expect(tpl.icon).toBeDefined()
    }
  })

  it('ensures meaningless "阶段 2" or "项目2" debug tokens are completely absent', () => {
    for (const tpl of WORKFLOW_TEMPLATES) {
      expect(tpl.title).not.toContain('阶段 2')
      expect(tpl.title).not.toContain('项目2')
      expect(tpl.defaultProjectName).not.toContain('阶段 2')
      expect(tpl.defaultProjectName).not.toContain('项目2')
    }
  })
})

describe('StartScreen project filtering', () => {
  const sampleProjects: RecentProjectItem[] = [
    {
      id: 'p-1',
      name: '余烬计划-分镜创作',
      path: '/Users/test/projects/ember',
      displayPath: '~/projects/ember',
      description: '电影分镜连续生成',
      openedAt: '2026-09-12T10:00:00Z',
    },
    {
      id: 'p-2',
      name: '赛博纪元-主角设计',
      path: '/Users/test/projects/cyber',
      displayPath: '~/projects/cyber',
      description: '核心主角三视图设定',
      openedAt: '2026-09-11T15:00:00Z',
    },
    {
      id: 'p-3',
      name: '水墨山水风格实验',
      path: '/Users/test/workspace/ink-style',
      displayPath: '~/workspace/ink-style',
      description: '中国传统水墨与现代胶片融合',
      openedAt: '2026-09-10T12:00:00Z',
    },
  ]

  it('returns all projects when search query is empty or whitespace', () => {
    expect(filterRecentProjects(sampleProjects, '')).toHaveLength(3)
    expect(filterRecentProjects(sampleProjects, '   ')).toHaveLength(3)
  })

  it('filters by project name (case-insensitive and partial match)', () => {
    const results = filterRecentProjects(sampleProjects, '余烬')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('p-1')
  })

  it('filters by project display path', () => {
    const results = filterRecentProjects(sampleProjects, 'workspace')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('p-3')
  })

  it('filters by project description', () => {
    const results = filterRecentProjects(sampleProjects, '主角')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('p-2')
  })

  it('returns empty array when nothing matches', () => {
    const results = filterRecentProjects(sampleProjects, '不存在的专案')
    expect(results).toHaveLength(0)
  })
})
