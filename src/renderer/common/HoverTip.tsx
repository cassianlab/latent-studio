import React from 'react'
import * as Tooltip from '@radix-ui/react-tooltip'

export interface HoverTipProps {
  label: string
  children: React.ReactElement
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
  delayDuration?: number
}

export function HoverTip({
  label,
  children,
  side = 'top',
  sideOffset = 6,
  delayDuration = 150,
}: HoverTipProps): React.ReactElement {
  return (
    <Tooltip.Root delayDuration={delayDuration}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" side={side} sideOffset={sideOffset}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

export default HoverTip
