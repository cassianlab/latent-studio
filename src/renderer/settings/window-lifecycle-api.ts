import type { WindowLifecycleApi } from '../../shared/contracts/window-lifecycle'

const browserPreviewApi: WindowLifecycleApi = {
  async getPreference() { return 'ask' },
  async setPreference(preference) { return preference },
  onCloseIntent() { return () => undefined },
}

export function getWindowLifecycleApi(): WindowLifecycleApi {
  if (typeof window !== 'undefined' && window.latentStudio?.windowLifecycle) return window.latentStudio.windowLifecycle
  return browserPreviewApi
}
