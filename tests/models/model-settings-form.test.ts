import { describe, expect, it } from 'vitest'
import { buildModelSaveInput } from '../../src/renderer/settings/ModelRows'

describe('model settings form', () => {
  it('preserves confirmed capabilities when editing model metadata', () => {
    expect(buildModelSaveInput({
      connectionId: 'connection-a',
      model: {
        id: 'profile-a',
        modelId: 'image-a',
        name: '旧名称',
        kind: 'image',
        capabilities: ['reference-image', 'multi-reference'],
      },
      modelId: 'image-a',
      name: '新名称',
      kind: 'image',
    })).toMatchObject({
      id: 'profile-a',
      name: '新名称',
      capabilities: ['reference-image', 'multi-reference'],
    })
  })
})
