import { FileText, X } from 'lucide-react'
import type { ProjectContextDocument } from '../../shared/contracts/context'
import './context-attachments.css'

export function ContextAttachmentList({ documents, onRemove }: {
  documents: ProjectContextDocument[]
  onRemove: (index: number) => void
}): React.ReactElement | null {
  if (!documents.length) return null
  return (
    <div className="context-file-attachments" role="list" aria-label={`已上传 ${documents.length} 个附件`}>
      {documents.map((document, index) => (
        <div className="context-file-attachment" role="listitem" key={`${document.summary.fileName}-${document.summary.byteLength}-${index}`}>
          <span className="context-file-attachment__icon" aria-hidden="true"><FileText size={17} /></span>
          <span className="context-file-attachment__text">
            <strong title={document.summary.fileName}>{document.summary.fileName}</strong>
            <small>{document.summary.kind === 'plain-text' ? '文本' : document.summary.kind.toUpperCase()} · {Math.max(1, Math.round(document.summary.byteLength / 1024))} KB</small>
          </span>
          <button type="button" onClick={() => onRemove(index)} aria-label={`移除附件 ${document.summary.fileName}`} title="移除附件"><X size={13} /></button>
        </div>
      ))}
    </div>
  )
}
