import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createWindowCloseIntentRequester, createWindowLifecycleCoordinator } from '../../src/main/app/window-lifecycle'
import { windowLifecycleChannels, type WindowCloseDecision, type WindowClosePreference } from '../../src/shared/contracts/window-lifecycle'

class FakeApp {
  quit = vi.fn()
}

class FakeWindow extends EventEmitter {
  hide = vi.fn()
  destroyed = false

  requestClose(): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    this.emit('close', event)
    return event
  }

  isDestroyed(): boolean { return this.destroyed }
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function setup(input: {
  preference?: WindowClosePreference
  decision?: WindowCloseDecision
} = {}) {
  let preference: WindowClosePreference = input.preference ?? 'ask'
  const app = new FakeApp()
  const window = new FakeWindow()
  const requestDecision = vi.fn(async () => input.decision ?? { action: 'cancel', remember: false } satisfies WindowCloseDecision)
  const setPreference = vi.fn((next: WindowClosePreference) => { preference = next })
  const recordDiagnostic = vi.fn()
  const coordinator = createWindowLifecycleCoordinator({
    app,
    getPreference: () => preference,
    setPreference,
    requestDecision,
    recordDiagnostic,
  })
  coordinator.guardWindow(window)
  return { app, window, requestDecision, setPreference, recordDiagnostic, coordinator }
}

describe('macOS window lifecycle coordinator', () => {
  it('asks in the renderer and hides the window when the user chooses minimize', async () => {
    const subject = setup({ decision: { action: 'minimize', remember: false } })

    const event = subject.window.requestClose()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await settle()

    expect(subject.requestDecision).toHaveBeenCalledOnce()
    expect(subject.window.hide).toHaveBeenCalledOnce()
    expect(subject.app.quit).not.toHaveBeenCalled()
    subject.coordinator.dispose()
  })

  it('persists a remembered choice and skips the prompt on later closes', async () => {
    const subject = setup({ decision: { action: 'minimize', remember: true } })

    subject.window.requestClose()
    await settle()
    subject.window.requestClose()
    await settle()

    expect(subject.setPreference).toHaveBeenCalledExactlyOnceWith('minimize')
    expect(subject.requestDecision).toHaveBeenCalledOnce()
    expect(subject.window.hide).toHaveBeenCalledTimes(2)
    subject.coordinator.dispose()
  })

  it('routes both prompted and remembered quit choices through app.quit', async () => {
    const prompted = setup({ decision: { action: 'quit', remember: false } })
    prompted.window.requestClose()
    await settle()
    expect(prompted.app.quit).toHaveBeenCalledOnce()
    prompted.coordinator.dispose()

    const remembered = setup({ preference: 'quit' })
    remembered.window.requestClose()
    await settle()
    expect(remembered.requestDecision).not.toHaveBeenCalled()
    expect(remembered.app.quit).toHaveBeenCalledOnce()
    remembered.coordinator.dispose()
  })

  it('keeps the window open when the user cancels or the renderer prompt fails', async () => {
    const cancelled = setup({ decision: { action: 'cancel', remember: true } })
    cancelled.window.requestClose()
    await settle()
    expect(cancelled.window.hide).not.toHaveBeenCalled()
    expect(cancelled.app.quit).not.toHaveBeenCalled()
    expect(cancelled.setPreference).not.toHaveBeenCalled()
    cancelled.coordinator.dispose()

    const failed = setup()
    failed.requestDecision.mockRejectedValueOnce(new Error('renderer unavailable'))
    failed.window.requestClose()
    await settle()
    expect(failed.window.hide).not.toHaveBeenCalled()
    expect(failed.app.quit).not.toHaveBeenCalled()
    expect(failed.recordDiagnostic).toHaveBeenCalledWith('window-close-prompt-failed', expect.objectContaining({ errorName: 'Error' }))
    failed.coordinator.dispose()
  })

  it('accepts close decisions only from the web contents that received the request', async () => {
    const ipc = new EventEmitter()
    const sender = { isDestroyed: () => false, send: vi.fn() }
    const otherSender = { isDestroyed: () => false, send: vi.fn() }
    const requester = createWindowCloseIntentRequester(ipc as never)
    const decisionPromise = requester.request({ isDestroyed: () => false, webContents: sender } as never)
    const payload = sender.send.mock.calls[0]?.[1] as { requestId: string }
    let resolved = false
    void decisionPromise.then(() => { resolved = true })

    ipc.emit(windowLifecycleChannels.closeDecision, { sender: otherSender }, { requestId: payload.requestId, decision: { action: 'quit', remember: true } })
    await settle()
    expect(resolved).toBe(false)

    ipc.emit(windowLifecycleChannels.closeDecision, { sender }, { requestId: payload.requestId, decision: { action: 'minimize', remember: true } })
    await expect(decisionPromise).resolves.toEqual({ action: 'minimize', remember: true })
    requester.dispose()
  })
})
