import { describe, expect, it } from 'vitest'
import type { GlobalSettings, ModelProfile } from '../../src/shared/contracts/settings'
import {
  compactModelName,
  formatModelCapsuleLabel,
  getModelChannelInfo,
  groupModelsByChannel,
  groupModelsByProvider,
} from '../../src/renderer/settings/model-channel'

describe('model channel utilities', () => {
  it('keeps toolbar labels short without losing the model family and version', () => {
    expect(compactModelName('gpt-5.6-sol')).toBe('5.6 Sol')
    expect(compactModelName('GPT Image 2.5 Sunburst', 'image')).toBe('2.5 Sunburst')
    expect(compactModelName('Claude Sonnet 4')).toBe('Sonnet 4')
    expect(compactModelName('DeepSeek Chat')).toBe('DeepSeek Chat')
  })

  const mockSettings: GlobalSettings = {
    groups: [
      {
        id: 'group-openai',
        name: 'OpenAI 官方',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'group-siliconflow',
        name: '硅基流动',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
    connections: [
      {
        id: 'conn-openai-main',
        groupId: 'group-openai',
        name: '个人 Key',
        providerType: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        hasApiKey: true,
        maxConcurrency: 2,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'conn-silicon-prod',
        groupId: 'group-siliconflow',
        name: '生产渠道',
        providerType: 'openai-compatible',
        baseUrl: 'https://api.siliconflow.cn/v1',
        hasApiKey: true,
        maxConcurrency: 4,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
    models: [],
  }

  const modelOpenAI: ModelProfile = {
    id: 'profile-1',
    connectionId: 'conn-openai-main',
    modelId: 'gpt-4o',
    name: 'gpt-4o',
    kind: 'text',
    capabilities: ['streaming'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  const modelSilicon: ModelProfile = {
    id: 'profile-2',
    connectionId: 'conn-silicon-prod',
    modelId: 'gpt-4o',
    name: 'gpt-4o',
    kind: 'text',
    capabilities: ['streaming'],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  it('correctly extracts channel info and disambiguates identical model names', () => {
    const info1 = getModelChannelInfo(modelOpenAI, mockSettings)
    const info2 = getModelChannelInfo(modelSilicon, mockSettings)

    expect(info1.groupName).toBe('OpenAI 官方')
    expect(info1.connectionName).toBe('个人 Key')
    expect(info1.channelLabel).toBe('OpenAI 官方 · 个人 Key')
    expect(info1.displayName).toBe('gpt-4o (OpenAI 官方)')

    expect(info2.groupName).toBe('硅基流动')
    expect(info2.connectionName).toBe('生产渠道')
    expect(info2.channelLabel).toBe('硅基流动 · 生产渠道')
    expect(info2.displayName).toBe('gpt-4o (硅基流动)')
  })

  it('groups models by provider connection channel for optgroup rendering', () => {
    const grouped = groupModelsByChannel([modelOpenAI, modelSilicon], mockSettings)

    expect(grouped).toHaveLength(2)
    expect(grouped[0].channelLabel).toBe('OpenAI 官方 · 个人 Key')
    expect(grouped[0].models).toHaveLength(1)
    expect(grouped[0].models[0].id).toBe('profile-1')

    expect(grouped[1].channelLabel).toBe('硅基流动 · 生产渠道')
    expect(grouped[1].models).toHaveLength(1)
    expect(grouped[1].models[0].id).toBe('profile-2')
  })

  it('formats capsule label with group name', () => {
    const capsuleLabel = formatModelCapsuleLabel(modelSilicon, mockSettings)
    expect(capsuleLabel).toBe('gpt-4o · 硅基流动')
  })

  it('groups model choices by provider while preserving connection identity', () => {
    const grouped = groupModelsByProvider([modelOpenAI, modelSilicon], mockSettings)

    expect(grouped.map((group) => group.providerName)).toEqual(['OpenAI 官方', '硅基流动'])
    expect(grouped[0].models[0]).toMatchObject({
      id: 'profile-1',
      connectionName: '个人 Key',
    })
    expect(grouped[1].models[0]).toMatchObject({
      id: 'profile-2',
      connectionName: '生产渠道',
    })
  })
})
