import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleReferenceStatusDismiss } from '../../src/components/reference-images/ReferenceImagePicker'

describe('reference image picker status', () => {
  afterEach(() => vi.useRealTimers())

  it('dismisses an add confirmation after a short delay', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const cleanup = scheduleReferenceStatusDismiss(dismiss)

    vi.advanceTimersByTime(1_499)
    expect(dismiss).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(dismiss).toHaveBeenCalledOnce()

    cleanup()
  })

  it('cancels a pending dismissal when the status changes or unmounts', () => {
    vi.useFakeTimers()
    const dismiss = vi.fn()
    const cleanup = scheduleReferenceStatusDismiss(dismiss)

    cleanup()
    vi.runAllTimers()
    expect(dismiss).not.toHaveBeenCalled()
  })
})
