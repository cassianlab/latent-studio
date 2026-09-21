import { useEffect } from 'react'
import { AlertCircle, ChevronDown } from 'lucide-react'

function friendlyMessage(error: string): string {
  const normalized = error.toLocaleLowerCase()
  if (normalized.includes('all available accounts exhausted')) return '当前渠道的可用账号额度已耗尽，请切换渠道或稍后重试。'
  if (normalized.includes('rate limit') || normalized.includes('too many requests') || normalized.includes('429')) return '请求过于频繁，请稍后重试或切换渠道。'
  if (normalized.includes('unauthorized') || normalized.includes('invalid api key') || normalized.includes('401')) return '当前渠道认证失败，请检查 API Key。'
  if (normalized.includes('timeout') || normalized.includes('timed out')) return '模型响应超时，请稍后重试。'
  return error
}

export function ConversationError({ error }: { error: string }): React.ReactElement {
  const summary = friendlyMessage(error)
  useEffect(() => {
    void window.latentStudio?.logs?.recordError({ message: error, area: 'conversation' }).catch(() => undefined)
  }, [error])
  return (
    <div className="conversation-error" role="alert">
      <AlertCircle size={16} />
      <div>
        <strong>{summary}</strong>
        {summary !== error && (
          <details>
            <summary><ChevronDown size={12} />技术详情</summary>
            <code>{error}</code>
          </details>
        )}
      </div>
    </div>
  )
}
