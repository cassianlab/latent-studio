import type { ModelDiscoveryResult } from '../../shared/contracts/models'
import type { ModelDiscoveryInput, TextApi } from '../../shared/contracts/text'

const mockApi: TextApi = {
  async discoverModels(input: ModelDiscoveryInput): Promise<ModelDiscoveryResult> {
    return {
      providerType: 'openai-compatible',
      protocol: 'openai.models',
      fetchedAt: new Date().toISOString(),
      models: [
        { id: `${input.connectionId}-text`, displayName: '演示文本模型', providerType: 'openai-compatible', capabilities: [], capabilitySource: 'unconfirmed' },
        { id: `${input.connectionId}-image`, displayName: '演示图片模型', providerType: 'openai-compatible', capabilities: [], capabilitySource: 'unconfirmed' },
      ],
    }
  },
  async generate() { throw new Error('浏览器预览不执行模型请求') },
  async compact() { return { status: 'unsupported', reason: '浏览器预览不执行官方上下文压缩', capabilityCached: false } },
  async startStream() { throw new Error('浏览器预览不执行模型请求') },
  async stopStream() {},
  onStreamEvent() { return () => {} },
  onStreamComplete() { return () => {} },
}

export function getTextApi(): TextApi {
  if (typeof window !== 'undefined' && window.latentStudio?.models) return window.latentStudio.models
  return mockApi
}
