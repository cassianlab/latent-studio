import React from 'react'
import { ArrowRight, Sparkles, WandSparkles } from 'lucide-react'
import type { ImageEditorVersion } from '../../shared/contracts/editor'
import type { AnnotationTool } from './editor-model'

const TOOL_LABELS: Record<AnnotationTool, string> = {
  select: '拖拽',
  pen: '画笔',
  rect: '矩形',
  arrow: '箭头',
  text: '文字',
  crop: '裁剪',
  'object-eraser': '擦除',
  'pixel-eraser': '擦除笔迹',
}

export interface EditorInspectorProps {
  tool: AnnotationTool
  annotationText: string
  onChangeAnnotationText: (text: string) => void
  brushColor: string
  onChangeBrushColor: (color: string) => void
  brushSize: number
  onChangeBrushSize: (size: number) => void
  suggestion: string
  onChangeSuggestion: (suggestion: string) => void
  onOptimizeSuggestion: () => void
  optimizing: boolean
  restoredVersion: ImageEditorVersion | null
  versions: ImageEditorVersion[]
  versionLoading: boolean
  onRestoreVersion: (version: ImageEditorVersion) => void
  canSubmit: boolean
  submitting: boolean
  compare: boolean
  submittedTaskId: string | null
  submitError: string | null
  exportWidth: number
  exportHeight: number
  onCreateChildVersion: () => void
}

export function EditorInspector({
  tool,
  annotationText,
  onChangeAnnotationText,
  brushColor,
  onChangeBrushColor,
  brushSize,
  onChangeBrushSize,
  suggestion,
  onChangeSuggestion,
  onOptimizeSuggestion,
  optimizing,
  restoredVersion,
  versions,
  versionLoading,
  onRestoreVersion,
  canSubmit,
  submitting,
  compare,
  submittedTaskId,
  submitError,
  exportWidth,
  exportHeight,
  onCreateChildVersion,
}: EditorInspectorProps): React.ReactElement {
  const usesColor = tool === 'pen' || tool === 'rect' || tool === 'arrow' || tool === 'text'
  const usesSize = tool === 'pen' || tool === 'rect' || tool === 'arrow' || tool === 'text'
  return (
    <aside className="edit-inspector">
      <section className="editor-tool-section">
        <label>当前工具</label>
        <strong className="editor-tool-name">{TOOL_LABELS[tool]}</strong>
        {tool === 'text' && <label className="editor-inline-field">标注文字<input value={annotationText} onChange={(event) => onChangeAnnotationText(event.target.value)} maxLength={200} /></label>}
        {usesColor && <div className="swatches" aria-label="标记颜色">
          <button
            type="button"
            className="red"
            aria-label="红色标记"
            aria-pressed={brushColor === '#df3e45'}
            onClick={() => onChangeBrushColor('#df3e45')}
          />
          <button
            type="button"
            className="white"
            aria-label="白色标记"
            aria-pressed={brushColor === '#f2eee8'}
            onClick={() => onChangeBrushColor('#f2eee8')}
          />
          <button
            type="button"
            className="yellow"
            aria-label="黄色标记"
            aria-pressed={brushColor === '#efc74f'}
            onClick={() => onChangeBrushColor('#efc74f')}
          />
          <button
            type="button"
            className="black"
            aria-label="黑色标记"
            aria-pressed={brushColor === '#222222'}
            onClick={() => onChangeBrushColor('#222222')}
          />
        </div>}
        {usesSize && <div className="range-row">
          <span>笔触粗细</span>
          <input
            type="range"
            min="6"
            max="64"
            value={brushSize}
            onChange={(event) => onChangeBrushSize(Number(event.target.value))}
            aria-label="笔触粗细"
          />
          <b>{brushSize}px</b>
        </div>}
      </section>

      <section>
        <label>修改建议</label>
        <textarea
          value={suggestion}
          onChange={(event) => onChangeSuggestion(event.target.value)}
          aria-label="修改建议描述"
        />
        <button
          type="button"
          className="secondary"
          onClick={onOptimizeSuggestion}
          disabled={optimizing}
        >
          <WandSparkles size={15} />
          {optimizing ? '优化中…' : '智能润色描述'}
        </button>
      </section>

      <section>
        <label>版本关系</label>
        <div className="version-chain">
          <span className="current">
            {restoredVersion ? `v${restoredVersion.id.slice(0, 6)} 已恢复` : 'v1 原图'}
          </span>
          <ArrowRight size={14} />
          <span>待生成子版本</span>
        </div>
      </section>

      <section>
        <label>编辑历史</label>
        {versionLoading ? (
          <small>读取中…</small>
        ) : versions.length ? (
          <div className="version-list">
            {versions.map((version) => (
              <button
                type="button"
                key={version.id}
                className={restoredVersion?.id === version.id ? 'selected' : ''}
                onClick={() => onRestoreVersion(version)}
              >
                <span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span>
                <small>{version.suggestion}</small>
              </button>
            ))}
          </div>
        ) : (
          <small>暂无已保存版本</small>
        )}
      </section>

      <div className="edit-footer">
        <p>
          {canSubmit
            ? `输出规格：${exportWidth}×${exportHeight} · 原图+标注图`
            : '原型素材没有可用的项目原图'}
        </p>
        {submittedTaskId && (
          <p className="editor-success">已创建任务 {submittedTaskId.slice(0, 8)}，可在任务中心查看。</p>
        )}
        {submitError && <p className="dialog-error">{submitError}</p>}
        <button
          type="button"
          className="primary"
          onClick={onCreateChildVersion}
          disabled={!canSubmit || submitting || compare}
        >
          <Sparkles size={16} />
          {submitting ? '提交中…' : compare ? '退出对比后创建' : canSubmit ? '创建子版本' : '需要项目原图'}
        </button>
      </div>
    </aside>
  )
}
