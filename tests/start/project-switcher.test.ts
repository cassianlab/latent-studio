import { describe, expect, it, vi } from 'vitest'
import { openProjectForSwitch } from '../../src/renderer/common/ProjectSwitcherDropdown'
import type { ProjectSummary } from '../../src/shared/contracts/projects'

describe('project switcher', () => {
  it('flushes the current conversation before opening a recent project', async () => {
    const events: string[] = []
    const target: ProjectSummary = {
      id: 'project-2',
      name: '项目二',
      path: '/tmp/project-2',
      displayPath: '/tmp/project-2',
      openedAt: '2026-09-15T00:00:00.000Z',
    }
    const flush = vi.fn(async () => { events.push('flush') })
    const open = vi.fn(async () => { events.push('open'); return target })

    await expect(openProjectForSwitch('project-1', target, { flush, open })).resolves.toEqual(target)

    expect(events).toEqual(['flush', 'open'])
    expect(flush).toHaveBeenCalledWith('project-1')
    expect(open).toHaveBeenCalledWith({ projectRoot: target.path })
  })
})
