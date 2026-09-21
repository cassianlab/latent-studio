interface StreamingStatusProps {
  label: string
  className?: string
}

export function StreamingStatus({ label, className = '' }: StreamingStatusProps): React.ReactElement {
  return (
    <div className={`text-streaming streaming-status ${className}`.trim()} role="status" aria-live="polite">
      <span className="streaming-status-dots" aria-hidden="true"><i /><i /><i /></span>
      <span>{label}</span>
    </div>
  )
}
