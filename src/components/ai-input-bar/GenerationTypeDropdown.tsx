import { useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Sparkles } from 'lucide-react'
import { modes, type Mode } from '../../mock-data'
import { DropdownPortal } from './DropdownPortal'

export function GenerationTypeDropdown({ value, onSelect }: { value: Mode; onSelect: (mode: Mode) => void }) {
  const [open, setOpen] = useState(false)
  const selected = modes.find(item => item.key === value) ?? modes[0]
  return <DropdownPortal open={open} onOpenChange={setOpen} className="generation-type-dropdown__menu" trigger={ref => <div className="generation-type-dropdown" ref={ref}>
    <Tooltip.Root delayDuration={250}><Tooltip.Trigger asChild><button type="button" className={`composer-model-capsule ${open ? 'open' : ''}`} aria-label={`生成类型：${selected.label}`} aria-expanded={open} onClick={() => setOpen(current => !current)}><selected.icon size={13} className="capsule-icon" /><span className="capsule-label">{selected.label}</span><ChevronDown size={11} className="capsule-chevron" /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={7}>生成类型：{selected.label}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
  </div>}>
    <div className="input-dropdown-header"><Sparkles size={14} /><span>生成类型</span></div>
    <div className="input-dropdown-list" role="listbox" aria-label="选择生成类型">{modes.map(item => <button type="button" role="option" aria-selected={value === item.key} key={item.key} className={value === item.key ? 'selected' : ''} onClick={() => { onSelect(item.key); setOpen(false) }}><item.icon size={15} /><span>{item.label}</span>{value === item.key && <Check size={14} />}</button>)}</div>
  </DropdownPortal>
}
