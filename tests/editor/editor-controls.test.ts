import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EditorInspector } from '../../src/renderer/editor/EditorInspector'
import { EditorToolbar } from '../../src/renderer/editor/EditorToolbar'

const noop = () => undefined

describe('image editor controls', () => {
  it('exposes the drag tool as selected and omits misleading image transform actions', () => {
    const markup = renderToStaticMarkup(createElement(EditorToolbar, {
      tool: 'select',
      onSelectTool: noop,
      canUndo: false,
      canRedo: false,
      hasItems: false,
      hasCrop: false,
      onUndo: noop,
      onRedo: noop,
      onClear: noop,
      onClearCrop: noop,
    }))

    expect(markup).toContain('aria-label="拖拽画布 (V)"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).not.toContain('旋转')
    expect(markup).not.toContain('翻转')
  })

  it('shows only controls that apply to the selected tool', () => {
    const markup = renderToStaticMarkup(createElement(EditorInspector, {
      tool: 'select',
      annotationText: '注意此区域',
      onChangeAnnotationText: noop,
      brushColor: '#df3e45',
      onChangeBrushColor: noop,
      brushSize: 24,
      onChangeBrushSize: noop,
      suggestion: '修改建议',
      onChangeSuggestion: noop,
      onOptimizeSuggestion: noop,
      optimizing: false,
      restoredVersion: null,
      versions: [],
      versionLoading: false,
      onRestoreVersion: noop,
      canSubmit: true,
      submitting: false,
      compare: false,
      submittedTaskId: null,
      submitError: null,
      exportWidth: 1024,
      exportHeight: 1024,
      onCreateChildVersion: noop,
    }))

    expect(markup).toContain('当前工具')
    expect(markup).toContain('拖拽')
    expect(markup).not.toContain('笔触粗细')
  })
})
