import type { CanvasApi } from '../../shared/contracts/canvas'

const previewApi: CanvasApi = {
  async load() { return null },
  async save(state) { return state },
}

export function getCanvasApi(): CanvasApi {
  return typeof window !== 'undefined' && window.latentStudio?.canvas ? window.latentStudio.canvas : previewApi
}
