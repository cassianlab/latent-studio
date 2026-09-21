import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface DropdownPortalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: (ref: React.RefObject<HTMLDivElement | null>) => ReactNode
  children: ReactNode
  className: string
  width?: number
}

export function DropdownPortal({ open, onOpenChange, trigger, children, className, width }: DropdownPortalProps) {
  const anchorRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ position: 'fixed', left: 0, bottom: 0 })

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const update = () => {
      const rect = anchorRef.current?.getBoundingClientRect()
      if (!rect) return
      const menuWidth = width ?? Math.max(rect.width, 168)
      const left = Math.min(rect.left, window.innerWidth - menuWidth - 10)
      setStyle({ position: 'fixed', left: Math.max(10, left), bottom: window.innerHeight - rect.top + 8, width: menuWidth, maxHeight: Math.max(160, rect.top - 20) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true) }
  }, [open, width])

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (!anchorRef.current?.contains(target) && !menuRef.current?.contains(target)) onOpenChange(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') onOpenChange(false) }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { document.removeEventListener('mousedown', closeOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [open, onOpenChange])

  return <>
    {trigger(anchorRef)}
    {open && createPortal(<div ref={menuRef} className={className} style={style}>{children}</div>, document.querySelector('.app') ?? document.body)}
  </>
}
