import { describe, expect, it } from 'vitest'
import { filterPromptAssets } from '../../src/renderer/library/prompt-filters'
import type { PromptAsset } from '../../src/shared/contracts/library'

const base = { content: 'prompt', kind: 'prompt', version: 1, favorite: false, createdAt: '', updatedAt: '' } as const
const items: PromptAsset[] = [
  { ...base, id: 'open', name: 'Open', scope: 'global', source: 'import', collection: 'YouMind GPT Image 2', category: '通用', tags: ['youmind-gpt-image-2', 'image'] },
  { ...base, id: 'legacy', name: 'Legacy', scope: 'global', source: 'import', collection: 'Awesome GPT Image 2', category: 'Charts & Infographics', tags: ['awesome-gpt-image-2'] },
  { ...base, id: 'mine', name: 'Mine', scope: 'global', source: 'manual', collection: '个人', category: '人像', tags: ['image'], favorite: true },
  { ...base, id: 'project', name: 'Project', scope: 'project', kind: 'template', collection: '分镜项目', category: '风景', tags: ['storyboard'] },
]

describe('prompt library filters', () => {
  it('combines source, scope, kind, category and favorite filters', () => {
    expect(filterPromptAssets(items, { scope: 'all', source: 'open-source', kind: 'all', category: '通用', favoriteOnly: false }).map((item) => item.id)).toEqual(['open'])
    expect(filterPromptAssets(items, { scope: 'global', source: 'mine', kind: 'prompt', category: '人像', favoriteOnly: true }).map((item) => item.id)).toEqual(['mine'])
    expect(filterPromptAssets(items, { scope: 'project', source: 'mine', kind: 'template', category: '风景', favoriteOnly: false }).map((item) => item.id)).toEqual(['project'])
  })

  it('matches legacy English source categories through their Chinese display name', () => {
    expect(filterPromptAssets(items, { scope: 'all', source: 'awesome-gpt-image-2', kind: 'all', category: '图表与信息图', favoriteOnly: false }).map((item) => item.id)).toEqual(['legacy'])
  })
})
