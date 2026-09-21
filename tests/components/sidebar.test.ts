import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Tooltip from '@radix-ui/react-tooltip'
import { describe, expect, it } from 'vitest'
import { Sidebar } from '../../src/renderer/common/Sidebar'

describe('Sidebar', () => {
  it('places runtime logs above prototype feedback', () => {
    const markup = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(Sidebar, {
      page: 'workspace',
      onPage: () => undefined,
      collapsed: false,
      onCollapse: () => undefined,
      project: { id: 'project-1', name: '测试项目', rootPath: '/tmp/project', createdAt: '', updatedAt: '' },
      onOpenProjectSwitcher: () => undefined,
      onOpenLogs: () => undefined,
      onOpenFeedback: () => undefined,
    })))

    expect(markup.indexOf('运行日志')).toBeGreaterThan(-1)
    expect(markup.indexOf('运行日志')).toBeLessThan(markup.indexOf('原型反馈'))
  })
})
