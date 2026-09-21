import type { SearchApi } from '../../shared/contracts/search'

const mockApi: SearchApi = {
  async search() { throw new Error('浏览器预览不执行联网搜索') },
}

export function getSearchApi(): SearchApi {
  if (typeof window !== 'undefined' && window.latentStudio?.search) return window.latentStudio.search
  return mockApi
}
