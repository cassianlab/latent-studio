import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Tooltip from '@radix-ui/react-tooltip'
import { describe, expect, it } from 'vitest'
import { ImageSettingsPopover } from '../../src/components/ai-input-bar/ImageSettingsPopover'
import { ModelDropdown } from '../../src/components/ai-input-bar/ModelDropdown'
import type { GlobalSettings, ModelProfile } from '../../src/shared/contracts/settings'

const textModel: ModelProfile = {
  id: 'text-model',
  connectionId: 'connection',
  modelId: 'gpt-5.6-sol',
  name: 'gpt-5.6-sol',
  kind: 'text',
  capabilities: ['streaming'],
  createdAt: '2026-09-19',
  updatedAt: '2026-09-19',
}

const imageModel: ModelProfile = {
  ...textModel,
  id: 'image-model',
  modelId: 'gpt-image-2.5-sunburst',
  name: 'GPT Image 2.5 Sunburst',
  kind: 'image',
}

const settings: GlobalSettings = {
  groups: [{ id: 'provider', name: 'OpenAI 官方', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', createdAt: '2026-09-19', updatedAt: '2026-09-19' }],
  connections: [{ id: 'connection', groupId: 'provider', name: '主连接', providerType: 'openai', baseUrl: 'https://api.openai.com/v1', hasApiKey: true, maxConcurrency: 2, createdAt: '2026-09-19', updatedAt: '2026-09-19' }],
  models: [textModel, imageModel],
}

function render(element: React.ReactElement): string {
  return renderToStaticMarkup(createElement(Tooltip.Provider, null, element))
}

describe('model toolbar buttons', () => {
  it('shows only the compact text model name while retaining its full accessible identity', () => {
    const markup = render(createElement(ModelDropdown, {
      kind: '文本模型',
      name: '未配置文本模型',
      models: [textModel],
      settings,
      value: textModel.id,
      onChange: () => undefined,
    }))

    expect(markup).toContain('>5.6 Sol</span>')
    expect(markup).toContain('aria-label="文本模型：gpt-5.6-sol（渠道：OpenAI 官方 · 主连接）"')
    expect(markup).not.toContain('>gpt-5.6-sol · OpenAI 官方</span>')
  })

  it('shows a compact image model name and count badge while retaining full details', () => {
    const markup = render(createElement(ImageSettingsPopover, {
      imageModelId: imageModel.id,
      imageModels: [imageModel],
      onSelectImageModel: () => undefined,
      settings,
      parameters: { ratio: '自动', resolution: '2K', quality: '自动', format: 'PNG' },
      onChangeParameters: () => undefined,
      count: '4 个',
      onSelectCount: () => undefined,
      batchMode: 'smart',
      onSelectBatchMode: () => undefined,
    }))

    expect(markup).toContain('>2.5 Sunburst</span>')
    expect(markup).toContain('class="image-count-badge" aria-hidden="true">4</span>')
    expect(markup).toContain('aria-label="生成数量：4 个；生图模型：GPT Image 2.5 Sunburst"')
  })
})
