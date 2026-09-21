type LayerableCanvasLink = {
  id: string
  manualPoints?: readonly unknown[]
}

export function isForegroundCanvasLink(link: LayerableCanvasLink, selectedLinkId: string | null) {
  return link.id === selectedLinkId || Boolean(link.manualPoints?.length)
}
