export type WindowClosePreference = 'ask' | 'minimize' | 'quit'
export type WindowCloseAction = 'minimize' | 'quit' | 'cancel'

export const windowLifecycleChannels = {
  closeIntent: 'window-lifecycle:close-intent',
  closeDecision: 'window-lifecycle:close-decision',
  getPreference: 'window-lifecycle:get-preference',
  setPreference: 'window-lifecycle:set-preference',
} as const

export interface WindowCloseDecision {
  action: WindowCloseAction
  remember: boolean
}

export interface WindowLifecycleApi {
  getPreference(): Promise<WindowClosePreference>
  setPreference(preference: WindowClosePreference): Promise<WindowClosePreference>
  onCloseIntent(listener: () => WindowCloseDecision | Promise<WindowCloseDecision>): () => void
}
