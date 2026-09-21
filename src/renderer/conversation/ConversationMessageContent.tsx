import { MarkdownViewer } from '../library/MarkdownViewer'

export function ConversationMessageContent({
  content,
  pending = false,
}: {
  content: string
  pending?: boolean
}): React.ReactElement {
  return (
    <div className="message-content-paragraphs message-markdown">
      {content ? <MarkdownViewer content={content} /> : null}
      {pending && content ? <span className="text-stream-caret message-stream-tail" aria-hidden="true" /> : null}
    </div>
  )
}
