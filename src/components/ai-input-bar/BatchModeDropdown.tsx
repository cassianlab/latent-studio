import { useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Shuffle } from 'lucide-react'
import { DropdownPortal } from './DropdownPortal'

export type BatchMode = 'smart' | 'same'

const options: Array<{ value: BatchMode; label: string; description: string }> = [
  { value: 'smart', label: '智能变体', description: '文本模型为每张图分发不同镜头' },
  { value: 'same', label: '相同提示词', description: '明确允许重复提示词批量生成' },
]

export function BatchModeDropdown({ value, onSelect }: { value: BatchMode; onSelect: (value: BatchMode) => void }): React.ReactElement {
  const [open, setOpen] = useState(false)
  const selected = options.find((item) => item.value === value) ?? options[0]
  return <DropdownPortal open={open} onOpenChange={setOpen} className="batch-mode-dropdown__menu" width={238} trigger={(ref) => <div ref={ref}>
    <Tooltip.Root delayDuration={220}><Tooltip.Trigger asChild><button type="button" className={`input-dropdown-trigger ${open ? 'open' : ''}`} aria-label={`批量模式：${selected.label}`} aria-expanded={open} onClick={() => setOpen((current) => !current)}><Shuffle size={14} /><span>{selected.label}</span><ChevronDown size={13} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={7}>批量模式：{selected.label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
  </div>}>
    <div className="input-dropdown-header"><Shuffle size={14} /><span>批量模式</span></div>
    <div className="input-dropdown-list">{options.map((item) => <button type="button" key={item.value} className={item.value === value ? 'selected' : ''} onClick={() => { onSelect(item.value); setOpen(false) }}><Shuffle size={14} /><span><strong>{item.label}</strong><small>{item.description}</small></span>{item.value === value && <Check size={14} />}</button>)}</div>
  </DropdownPortal>
}
