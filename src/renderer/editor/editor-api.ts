import type { EditorApi } from '../../shared/contracts/editor'

const mockApi: EditorApi = {
  async saveVersion() { throw new Error('浏览器预览不保存图片编辑版本') },
  async listVersions() { return [] },
  async getVersionPreview() { return null },
}

export function getEditorApi(): EditorApi {
  return typeof window !== 'undefined' && window.latentStudio?.editor ? window.latentStudio.editor : mockApi
}
