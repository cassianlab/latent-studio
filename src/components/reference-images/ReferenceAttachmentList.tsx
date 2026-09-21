import { useEffect, useMemo, useState } from 'react'
import { Image, X } from 'lucide-react'
import type { ReferenceAsset } from '../../shared/reference-images'
import { getLibraryApi } from '../../renderer/library/library-api'
import { HoverTip } from '../../renderer/common/HoverTip'

export function ReferenceAttachmentList({ assets, onRemove }: { assets: ReferenceAsset[]; onRemove: (id: string) => void }): React.ReactElement | null {
  const api = useMemo(() => getLibraryApi(), [])
  const [previews, setPreviews] = useState<Record<string, string>>({})

  useEffect(() => {
    let disposed = false
    void Promise.all(assets.map(async (asset) => [asset.id, asset.transientDataUrl ?? await api.getAssetPreview({ id: asset.id })] as const)).then((entries) => {
      if (!disposed) setPreviews(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))))
    }).catch(() => undefined)
    return () => { disposed = true }
  }, [api, assets])

  if (!assets.length) return null
  return (
    <div className="reference-attachments" role="list" aria-label={`已选择 ${assets.length} 张参考图`}>
      {assets.map((asset, index) => (
        <div className="reference-attachment" role="listitem" key={asset.id}>
          {previews[asset.id]
            ? <img src={previews[asset.id]} alt={`参考图 ${index + 1}：${asset.name}`} />
            : <span className="reference-attachment__empty" aria-hidden="true"><Image size={20} /></span>}
          <span className="reference-attachment__name" title={asset.name}>{asset.name}</span>
          <HoverTip label="移除参考图"><button type="button" onClick={() => onRemove(asset.id)} aria-label={`移除参考图 ${asset.name}`}><X size={13} /></button></HoverTip>
        </div>
      ))}
    </div>
  )
}
