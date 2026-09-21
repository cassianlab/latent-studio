import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as Tooltip from '@radix-ui/react-tooltip'
import { describe, expect, it } from 'vitest'
import { TaskListTable } from '../../src/renderer/tasks/TaskListTable'
import { TaskSelectionToolbar } from '../../src/renderer/tasks/TaskSelectionToolbar'
import type { TaskListRow } from '../../src/renderer/tasks/task-list-model'

const rows: TaskListRow[] = [
  {
    id: 'task-running',
    title: '正在生成主视觉',
    status: 'running',
    progress: 50,
    model: 'gpt-image',
    route: '图片连接 main',
    createdAt: '2026-09-16T12:00:00.000Z',
    updatedAt: '2026-09-16T12:01:00.000Z',
    archived: false,
  },
  {
    id: 'task-completed',
    title: '已完成封面',
    status: 'completed',
    progress: 100,
    model: 'gpt-image',
    route: '图片连接 main',
    createdAt: '2026-09-16T11:00:00.000Z',
    updatedAt: '2026-09-16T11:01:00.000Z',
    archived: false,
  },
]

describe('task center selection UI', () => {
  it('renders native row selection controls and exposes the selected row state', () => {
    const markup = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(TaskListTable, {
      rows,
      selectedIds: new Set(['task-running']),
      pendingAction: null,
      onToggleAll: () => undefined,
      onToggle: () => undefined,
      onOpen: () => undefined,
      onRename: () => undefined,
      onAction: () => undefined,
      onManage: () => undefined,
      onDelete: () => undefined,
    })))

    expect(markup).toContain('aria-label="选择当前列表全部 2 个任务"')
    expect(markup).toContain('aria-label="选择任务：正在生成主视觉"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('class="task-cell-title"')
  })

  it('only shows batch actions that apply to the current selection', () => {
    const markup = renderToStaticMarkup(createElement(Tooltip.Provider, null, createElement(TaskSelectionToolbar, {
      selectedCount: 2,
      actionCounts: { cancel: 0, retry: 1, archive: 0, restore: 0, remove: 2 },
      pendingAction: null,
      onAction: () => undefined,
      onClear: () => undefined,
    })))

    expect(markup).toContain('重试')
    expect(markup).toContain('删除记录')
    expect(markup).not.toContain('取消任务')
    expect(markup).not.toContain('>归档<')
  })
})
