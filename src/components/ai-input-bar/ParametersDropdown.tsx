import { useEffect, useMemo, useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Settings2 } from 'lucide-react'
import { DropdownPortal } from './DropdownPortal'

export interface ImageParameters {
  ratio: string
  resolution: string
  quality: string
  format?: string
  background?: string
}

const parameterGroups = [
  { id: 'ratio', label: '图片尺寸', options: ['自动', '1:1 方形', '2:3 竖版', '3:2 横版', '3:4 竖版', '4:3 横版', '4:5 竖版', '5:4 横版', '9:16 竖版', '16:9 横版', '21:9 超宽'] },
  { id: 'resolution', label: '图片分辨率', options: ['1K', '2K', '4K'] },
  { id: 'quality', label: '质量', options: ['自动', '低', '中', '高', '超高', '最高'] },
] as const

export function ParametersDropdown({ value, onChange, agent = false }: { value: ImageParameters; onChange: (value: ImageParameters) => void; agent?: boolean }) {
  const [open, setOpen] = useState(false)
  const [highlightedGroup, setHighlightedGroup] = useState(0)
  const [highlightedOption, setHighlightedOption] = useState(0)
  const summary = useMemo(() => `${value.ratio}, ${value.resolution}, ${value.quality}`, [value])

  useEffect(() => {
    if (!open) return
    const options = parameterGroups[0].options as readonly string[]
    setHighlightedGroup(0)
    setHighlightedOption(Math.max(0, options.indexOf(value.ratio)))
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyboard = (event: KeyboardEvent) => {
      const group = parameterGroups[highlightedGroup]
      const options = group.options as readonly string[]
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const direction = event.key === 'ArrowDown' ? 1 : -1
        const nextGroup = (highlightedGroup + direction + parameterGroups.length) % parameterGroups.length
        const next = parameterGroups[nextGroup]
        const nextOptions = next.options as readonly string[]
        setHighlightedGroup(nextGroup)
        setHighlightedOption(Math.max(0, nextOptions.indexOf(value[next.id])))
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const direction = event.key === 'ArrowRight' ? 1 : -1
        setHighlightedOption(current => (current + direction + options.length) % options.length)
      }
      if (event.key === 'Tab' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onChange({ ...value, [group.id]: options[highlightedOption] })
        if (event.key === 'Tab') {
          const nextGroup = (highlightedGroup + 1) % parameterGroups.length
          const next = parameterGroups[nextGroup]
          const nextOptions = next.options as readonly string[]
          setHighlightedGroup(nextGroup)
          setHighlightedOption(Math.max(0, nextOptions.indexOf(value[next.id])))
        }
      }
    }
    document.addEventListener('keydown', handleKeyboard)
    return () => document.removeEventListener('keydown', handleKeyboard)
  }, [highlightedGroup, highlightedOption, onChange, open, value])

  return <DropdownPortal open={open} onOpenChange={setOpen} className="parameters-dropdown__menu" width={430} trigger={ref => <div className="parameters-dropdown" ref={ref}>
    <Tooltip.Root delayDuration={250}><Tooltip.Trigger asChild><button type="button" className={`input-dropdown-trigger parameters-dropdown__trigger ${open ? 'open' : ''}`} aria-label={`图片参数：${summary}`} aria-expanded={open} onClick={() => setOpen(current => !current)} onKeyDown={event => { if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); setOpen(true) } }}><Settings2 size={14} /><span>{summary}</span><ChevronDown size={13} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={7}>{agent ? 'Agent 图片输出参数' : '图片生成参数'}：{summary}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
  </div>}>
    <div className="input-dropdown-header parameters-dropdown__header"><Settings2 size={15} /><span>{agent ? '设置 Agent 图片输出参数' : '设置生成参数'} · ↑↓ 分组 · ←→ 选择 · Tab 应用</span></div>
    <div className="parameters-dropdown__sections">{parameterGroups.map((group, groupIndex) => <section key={group.id}><div>{group.label}</div><div>{group.options.map((option, optionIndex) => <button type="button" key={option} className={`${value[group.id] === option ? 'selected' : ''} ${highlightedGroup === groupIndex && highlightedOption === optionIndex ? 'highlighted' : ''}`} onMouseEnter={() => { setHighlightedGroup(groupIndex); setHighlightedOption(optionIndex) }} onClick={() => onChange({ ...value, [group.id]: option })}><span>{option}</span>{value[group.id] === option && <Check size={12} />}</button>)}</div></section>)}</div>
  </DropdownPortal>
}
