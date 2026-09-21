import { describe, expect, it } from 'vitest'
import type { ImageTaskRecord } from '../../src/shared/contracts/images'
import type { TaskRecord } from '../../src/shared/contracts/tasks'
import {
  buildTaskRows,
  canManageTask,
  filterTaskRows,
  rowsForTaskAction,
  searchTaskRows,
  sortTaskRows,
} from '../../src/renderer/tasks/task-list-model'

const task: TaskRecord = {
  id: 'generic-1',
  title: '已完成任务',
  kind: 'generic',
  status: 'completed',
  progress: 100,
  attempts: 1,
  maxAttempts: 1,
  createdAt: '2026-09-14T08:00:00.000Z',
  updatedAt: '2026-09-14T08:01:00.000Z',
}

const image: ImageTaskRecord = {
  id: 'image-1',
  connectionId: 'connection-1',
  request: { model: 'image-model', prompt: '宽屏场景' },
  status: 'failed',
  attempts: 1,
  maxRetries: 0,
  createdAt: '2026-09-14T08:00:00.000Z',
  updatedAt: '2026-09-14T08:01:00.000Z',
  archivedAt: '2026-09-14T08:02:00.000Z',
}

describe('task list model', () => {
  it('keeps active and archived task rows in separate views', () => {
    const rows = buildTaskRows([task], [], [], [image])

    expect(filterTaskRows(rows, 'all').map((row) => row.id)).toEqual(['generic-1'])
    expect(filterTaskRows(rows, 'archived').map((row) => row.id)).toEqual(['image-1'])
    expect(rows.find((row) => row.id === 'image-1')).toMatchObject({ archived: true, image })
  })

  it('only allows terminal tasks to be archived or deleted', () => {
    expect(canManageTask('completed')).toBe(true)
    expect(canManageTask('failed')).toBe(true)
    expect(canManageTask('cancelled')).toBe(true)
    expect(canManageTask('pending')).toBe(false)
    expect(canManageTask('running')).toBe(false)
    expect(canManageTask('paused')).toBe(false)
  })

  it('prefers custom title over prompt excerpt when present', () => {
    const customImage: ImageTaskRecord = {
      ...image,
      id: 'image-custom',
      title: '用户自定义重命名标题',
    }
    const rows = buildTaskRows([], [customImage], [], [])
    expect(rows[0].title).toBe('用户自定义重命名标题')
  })

  it('searches every visible task identifier and diagnostic field', () => {
    const rows = buildTaskRows([task], [image], [], [])

    expect(searchTaskRows(rows, 'generic-1').map((row) => row.id)).toEqual(['generic-1'])
    expect(searchTaskRows(rows, '宽屏').map((row) => row.id)).toEqual(['image-1'])
    expect(searchTaskRows(rows, 'connection-1').map((row) => row.id)).toEqual(['image-1'])
    expect(searchTaskRows(rows, '不存在')).toEqual([])
  })

  it('sorts tasks deterministically by recent update, creation time, and status', () => {
    const rows = buildTaskRows([task], [{
      ...image,
      archivedAt: undefined,
      createdAt: '2026-09-14T08:02:00.000Z',
      updatedAt: '2026-09-14T08:03:00.000Z',
    }], [], [])

    expect(sortTaskRows(rows, 'updated-desc').map((row) => row.id)).toEqual(['image-1', 'generic-1'])
    expect(sortTaskRows(rows, 'created-asc').map((row) => row.id)).toEqual(['generic-1', 'image-1'])
    expect(sortTaskRows(rows, 'status').map((row) => row.status)).toEqual(['failed', 'completed'])
  })

  it('only returns selected rows eligible for each batch action', () => {
    const rows = [
      { ...buildTaskRows([task], [], [], [])[0], id: 'completed' },
      { ...buildTaskRows([task], [], [], [])[0], id: 'running', status: 'running' as const },
      { ...buildTaskRows([task], [], [], [])[0], id: 'failed', status: 'failed' as const },
      { ...buildTaskRows([], [], [task], [])[0], id: 'archived' },
    ]
    const selected = new Set(rows.map((row) => row.id))

    expect(rowsForTaskAction(rows, selected, 'cancel').map((row) => row.id)).toEqual(['running'])
    expect(rowsForTaskAction(rows, selected, 'retry').map((row) => row.id)).toEqual(['failed'])
    expect(rowsForTaskAction(rows, selected, 'archive').map((row) => row.id)).toEqual(['completed', 'failed'])
    expect(rowsForTaskAction(rows, selected, 'restore').map((row) => row.id)).toEqual(['archived'])
    expect(rowsForTaskAction(rows, selected, 'remove').map((row) => row.id)).toEqual(['completed', 'failed', 'archived'])
  })
})
