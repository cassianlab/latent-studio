import { describe, expect, it } from 'vitest'
import { resolveProviderSelection } from '../../src/components/ai-input-bar/ProviderModelPicker'

describe('provider model picker', () => {
  it('preserves the supplier being browsed when the selected model belongs to another supplier', () => {
    expect(resolveProviderSelection(['provider-a', 'provider-b'], 'provider-b', 'provider-a')).toBe('provider-b')
  })

  it('falls back to the selected model supplier when the browsed supplier disappears', () => {
    expect(resolveProviderSelection(['provider-a'], 'provider-b', 'provider-a')).toBe('provider-a')
  })
})
