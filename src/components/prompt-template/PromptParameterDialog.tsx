import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { applyPromptTemplate, parsePromptTemplate, type PromptTemplateParameter } from '../../shared/prompt-template'
import './PromptParameterDialog.css'

export function PromptParameterDialog({ open, template, onCancel, onApply }: {
  open: boolean
  template: string
  onCancel: () => void
  onApply: (prompt: string) => void
}): React.ReactElement | null {
  const parameters = useMemo(() => parsePromptTemplate(template), [template])
  const [values, setValues] = useState<Record<string, string>>({})
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (!open) return
    setValues(Object.fromEntries(parameters.map((parameter) => [parameter.name, parameter.defaultValue ?? (parameter.kind === 'select' ? parameter.options[0] ?? '' : '')])))
    setStep(0)
  }, [open, parameters])
  if (!open) return null
  const stepped = parameters.length >= 4
  const visibleParameters = stepped ? parameters.slice(step, step + 1) : parameters
  const missing = parameters.some((parameter) => parameter.kind === 'required' && !values[parameter.name]?.trim())
  const currentMissing = visibleParameters.some((parameter) => parameter.kind === 'required' && !values[parameter.name]?.trim())
  const update = (parameter: PromptTemplateParameter, value: string) => setValues((current) => ({ ...current, [parameter.name]: value }))
  return <div className="prompt-parameter-dialog" role="dialog" aria-modal="true" aria-label="填写提示词参数">
    <div className="prompt-parameter-dialog__card">
      <header><div><h3>填写提示词参数</h3><p>{stepped ? `${step + 1} / ${parameters.length} · 逐项确认模板参数` : '确认后将参数替换并应用到工作台'}</p></div><button type="button" className="icon-button" onClick={onCancel} aria-label="关闭"><X size={16} /></button></header>
      <div className="prompt-parameter-dialog__fields">
        {visibleParameters.map((parameter) => <label key={parameter.name}><span>{parameter.name}{parameter.kind === 'required' ? <em>必填</em> : <small>可选</small>}</span>{parameter.kind === 'select'
          ? <select value={values[parameter.name] ?? ''} onChange={(event) => update(parameter, event.target.value)}>{parameter.options.map((option) => <option value={option} key={option}>{option}</option>)}</select>
          : <input value={values[parameter.name] ?? ''} onChange={(event) => update(parameter, event.target.value)} placeholder={parameter.kind === 'required' ? '请输入内容' : '留空则移除该参数'} />}</label>)}
      </div>
      <div className="prompt-parameter-dialog__preview"><span>预览</span><p>{applyPromptTemplate(template, values) || '填写参数后显示最终提示词'}</p></div>
      <footer>
        <button type="button" className="secondary" onClick={onCancel}>取消</button>
        {stepped && step > 0 && <button type="button" className="secondary" onClick={() => setStep((value) => value - 1)}><ChevronLeft size={14} />上一项</button>}
        {stepped && step < parameters.length - 1
          ? <button type="button" className="primary" onClick={() => setStep((value) => value + 1)} disabled={currentMissing}>下一项<ChevronRight size={14} /></button>
          : <button type="button" className="primary" onClick={() => onApply(applyPromptTemplate(template, values))} disabled={missing}><Check size={14} />应用</button>}
      </footer>
    </div>
  </div>
}
