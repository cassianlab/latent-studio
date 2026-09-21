import { describe, expect, it } from 'vitest'
import { resolveOptimizerModelId } from '../../src/components/prompt-optimizer/PromptOptimizeWindow'
import type { GlobalSettings } from '../../src/shared/contracts/settings'

const settings: GlobalSettings = {
  groups: [],
  connections: [],
  models: [
    { id: 'text-a', connectionId: 'connection-a', modelId: 'shared-name', name: '模型 A', kind: 'text', capabilities: [], createdAt: '', updatedAt: '' },
    { id: 'text-b', connectionId: 'connection-b', modelId: 'shared-name', name: '模型 B', kind: 'text', capabilities: [], createdAt: '', updatedAt: '' },
  ],
  defaultTextModelId: 'text-a',
}

describe('prompt optimizer model selection', () => {
  it('follows the current workbench text model when it is available', () => {
    expect(resolveOptimizerModelId(settings, 'text-b')).toBe('text-b')
  })

  it('does not silently replace an invalid workbench model with the first model', () => {
    expect(resolveOptimizerModelId(settings, 'removed-model')).toBeNull()
  })
})
