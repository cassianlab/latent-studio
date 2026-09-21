import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function isConversationNearBottom(metrics: ScrollMetrics, threshold = 96): boolean {
  return metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight <= threshold
}

export function ConversationScrollAnchor({ version }: { version: string }): React.ReactElement {
  const endRef = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const [hasNewContent, setHasNewContent] = useState(false)
  const [overlayTarget, setOverlayTarget] = useState<HTMLElement | null>(null)

  useEffect(() => {
    const end = endRef.current
    const scroller = end?.closest<HTMLElement>('.thread-scroll')
    setOverlayTarget(end?.closest<HTMLElement>('.workspace-main') ?? null)
    if (!scroller) return
    const onScroll = () => {
      following.current = isConversationNearBottom(scroller)
      if (following.current) setHasNewContent(false)
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  const showLatest = useCallback(() => {
    following.current = true
    setHasNewContent(false)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    endRef.current?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'end' })
  }, [])

  useEffect(() => {
    if (following.current) {
      endRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      setHasNewContent(false)
    } else {
      setHasNewContent(true)
    }
  }, [version])

  return (
    <>
      {overlayTarget && hasNewContent ? createPortal(
        <button type="button" className="conversation-new-content" onClick={showLatest}>
          查看最新内容
        </button>,
        overlayTarget,
      ) : null}
      <div ref={endRef} aria-hidden="true" />
    </>
  )
}
