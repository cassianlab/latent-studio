import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SessionHeader } from '../../src/renderer/conversation/SessionHeader'
import type { WorkspaceSession } from '../../src/renderer/conversation/types'

const session: WorkspaceSession = {
  id: 'session-1',
  projectId: 'project-1',
  title: '雨夜重逢视觉探索',
  mode: 'image',
  messages: [],
  createdAt: '2026-09-16T00:00:00.000Z',
  updatedAt: '2026-09-16T00:00:00.000Z',
}

describe('session header', () => {
  it('gives its icon-only title action an accessible name', () => {
    const markup = renderToStaticMarkup(createElement(SessionHeader, {
      projectId: session.projectId,
      session,
      sessions: [session],
      mode: 'image',
      onSessionChange: () => undefined,
      onModeChange: () => undefined,
    }))

    expect(markup).toContain('aria-label="修改标题"')
    expect(markup).toContain('class="session-title-button"')
  })
})
