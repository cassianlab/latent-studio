import { describe, expect, it } from 'vitest'
import { parseImageVariationPlan, validateImageVariationPlan } from '../../src/main/agent/variation'

describe('image variation planning', () => {
  it('accepts distinct smart variants and strips code fences', () => {
    const result = parseImageVariationPlan('```json\n{"invariants":["same character"],"variations":[{"title":"wide","prompt":"same character, wide shot","difference":"wide shot"},{"title":"close","prompt":"same character, close up","difference":"close up"}]}\n```', 2, 'smart')
    expect(result.variations).toHaveLength(2)
  })

  it('rejects duplicate prompts in smart mode but allows explicit same mode', () => {
    const value = { invariants: ['character'], variations: [{ title: 'a', prompt: 'same', difference: 'a' }, { title: 'b', prompt: ' same ', difference: 'b' }] }
    expect(() => validateImageVariationPlan(value, 2, 'smart')).toThrow('重复提示词')
    expect(validateImageVariationPlan(value, 2, 'same').variations).toHaveLength(2)
  })

  it('gracefully provides default invariants if model omits or supplies empty array or string', () => {
    const withoutInvariants = { variations: [{ title: '1', prompt: 'prompt 1', difference: '1' }, { title: '2', prompt: 'prompt 2', difference: '2' }] }
    const res1 = validateImageVariationPlan(withoutInvariants, 2, 'smart')
    expect(res1.invariants.length).toBeGreaterThanOrEqual(1)

    const stringInvariant = { invariant: '主角外观一致', variations: [{ title: '1', prompt: 'prompt 1', difference: '1' }, { title: '2', prompt: 'prompt 2', difference: '2' }] }
    const res2 = validateImageVariationPlan(stringInvariant, 2, 'smart')
    expect(res2.invariants).toEqual(['主角外观一致'])
  })
})
