import { useState } from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Check, ChevronDown, Images } from 'lucide-react'
import { DropdownPortal } from './DropdownPortal'

const countOptions = ['1 个', '2 个', '4 个', '8 个']

export function CountDropdown({ value, onSelect }: { value: string; onSelect: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  return <DropdownPortal open={open} onOpenChange={setOpen} className="count-dropdown__menu" width={150} trigger={ref => <div className="count-dropdown" ref={ref}>
    <Tooltip.Root delayDuration={220}><Tooltip.Trigger asChild><button type="button" className={`input-dropdown-trigger count-dropdown__trigger ${open ? 'open' : ''}`} aria-label={`生成数量：${value}`} aria-expanded={open} onClick={() => setOpen(current => !current)}><Images size={14} /><span>{value}</span><ChevronDown size={13} /></button></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip" side="top" sideOffset={7}>生成数量：{value}</Tooltip.Content></Tooltip.Portal></Tooltip.Root>
  </div>}>
    <div className="input-dropdown-header"><Images size={14} /><span>生成数量</span></div>
    <div className="input-dropdown-list" role="listbox" aria-label="选择生成数量">{countOptions.map(option => <button type="button" role="option" aria-selected={value === option} key={option} className={value === option ? 'selected' : ''} onClick={() => { onSelect(option); setOpen(false) }}><Images size={14} /><span>{option}</span>{value === option && <Check size={14} />}</button>)}</div>
  </DropdownPortal>
}
