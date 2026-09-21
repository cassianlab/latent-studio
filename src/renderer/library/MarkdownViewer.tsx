import React, { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import './MarkdownViewer.css'

export interface MarkdownViewerProps {
  content: string
  format?: 'markdown' | 'json' | 'text'
}

function safeMarkdownHref(value: string): string | undefined {
  const href = value.trim()
  if (href.startsWith('#')) return href
  try {
    const protocol = new URL(href).protocol
    return protocol === 'https:' || protocol === 'http:' || protocol === 'mailto:' ? href : undefined
  } catch {
    return undefined
  }
}

function renderInline(text: string): React.ReactNode[] {
  // Parse inline elements: `code`, **bold**, *italic*, ~~del~~, [link](url)
  const tokens: React.ReactNode[] = []
  // Regex to match inline tokens
  const inlineRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|\[([^\]]+)\]\(([^)]+)\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = inlineRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index))
    }
    const raw = match[0]
    if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push(
        <code key={`code-${match.index}`} className="md-inline-code">
          {raw.slice(1, -1)}
        </code>
      )
    } else if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push(<strong key={`bold-${match.index}`}>{raw.slice(2, -2)}</strong>)
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push(<em key={`italic-${match.index}`}>{raw.slice(1, -1)}</em>)
    } else if (raw.startsWith('~~') && raw.endsWith('~~')) {
      tokens.push(<del key={`del-${match.index}`}>{raw.slice(2, -2)}</del>)
    } else if (match[2] && match[3]) {
      const href = safeMarkdownHref(match[3])
      tokens.push(href ? (
        <a key={`link-${match.index}`} href={href} target="_blank" rel="noopener noreferrer" className="md-link">
          {match[2]}
        </a>
      ) : <span key={`link-${match.index}`} className="md-link-disabled">{match[2]}</span>)
    }
    lastIndex = inlineRegex.lastIndex
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex))
  }

  return tokens.length > 0 ? tokens : [text]
}

function CodeBlock({ code, lang }: { code: string; lang?: string }): React.ReactElement {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="md-code-block">
      <div className="md-code-header">
        <span className="md-code-lang">{lang || 'text'}</span>
        <button
          type="button"
          className="md-code-copy-btn"
          onClick={() => void handleCopy()}
          aria-label="复制代码"
        >
          {copied ? <Check size={13} className="text-green" /> : <Copy size={13} />}
          <span>{copied ? '已复制' : '复制'}</span>
        </button>
      </div>
      <pre className="md-code-pre">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function TableBlock({ rows }: { rows: string[] }): React.ReactElement | null {
  if (rows.length < 2) return null
  const parseRow = (line: string) =>
    line
      .trim()
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.trim())

  const headers = parseRow(rows[0])
  const isSeparator = (line: string) => /^\|?(\s*:?-+:?\s*\|?)+$/.test(line.trim())
  const contentRows = rows.slice(1).filter((r) => !isSeparator(r)).map(parseRow)

  return (
    <div className="md-table-wrap">
      <table className="md-table">
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i}>{renderInline(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {contentRows.map((cells, rowIndex) => (
            <tr key={rowIndex}>
              {cells.map((cell, cellIndex) => (
                <td key={cellIndex}>{renderInline(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function JsonViewer({ json }: { json: string }): React.ReactElement {
  let parsed: unknown
  let pretty = json
  try {
    parsed = JSON.parse(json)
    pretty = JSON.stringify(parsed, null, 2)
  } catch {
    return <CodeBlock code={json} lang="json" />
  }

  return <CodeBlock code={pretty} lang="json" />
}

export function MarkdownViewer({ content, format = 'markdown' }: MarkdownViewerProps): React.ReactElement {
  if (format === 'json') {
    return <JsonViewer json={content} />
  }

  if (format === 'text') {
    return (
      <div className="md-rendered md-plain-text">
        <pre>{content}</pre>
      </div>
    )
  }

  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    // 1. Fenced code block
    if (line.trim().startsWith('```')) {
      const lang = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      elements.push(
        <CodeBlock key={`code-${i}`} code={codeLines.join('\n')} lang={lang} />
      )
      i++
      continue
    }

    // 2. Table
    if (line.trim().startsWith('|') && line.includes('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('|') && lines[i].includes('|')) {
        tableLines.push(lines[i])
        i++
      }
      elements.push(<TableBlock key={`table-${i}`} rows={tableLines} />)
      continue
    }

    // 3. Headings
    if (line.startsWith('# ')) {
      elements.push(<h1 key={`h1-${i}`} className="md-h1">{renderInline(line.slice(2))}</h1>)
      i++
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(<h2 key={`h2-${i}`} className="md-h2">{renderInline(line.slice(3))}</h2>)
      i++
      continue
    }
    if (line.startsWith('### ')) {
      elements.push(<h3 key={`h3-${i}`} className="md-h3">{renderInline(line.slice(4))}</h3>)
      i++
      continue
    }
    if (line.startsWith('#### ')) {
      elements.push(<h4 key={`h4-${i}`} className="md-h4">{renderInline(line.slice(5))}</h4>)
      i++
      continue
    }

    // 4. Horizontal rule
    if (/^(---|___|\*\*\*)\s*$/.test(line.trim())) {
      elements.push(<hr key={`hr-${i}`} className="md-hr" />)
      i++
      continue
    }

    // 5. Blockquote
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      elements.push(
        <blockquote key={`quote-${i}`} className="md-blockquote">
          {quoteLines.map((ql, qi) => (
            <p key={qi}>{renderInline(ql)}</p>
          ))}
        </blockquote>
      )
      continue
    }

    // 6. Unordered list
    if (/^(\s*)[-*+]\s+/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^(\s*)[-*+]\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^(\s*)[-*+]\s+/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${i}`} className="md-ul">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ul>
      )
      continue
    }

    // 7. Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const listItems: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        listItems.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${i}`} className="md-ol">
          {listItems.map((item, idx) => (
            <li key={idx}>{renderInline(item)}</li>
          ))}
        </ol>
      )
      continue
    }

    // 8. Empty line
    if (!line.trim()) {
      i++
      continue
    }

    // 9. Standard paragraph
    const pLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith('```') &&
      !lines[i].trim().startsWith('#') &&
      !lines[i].trim().startsWith('>') &&
      !/^(\s*)[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i]) &&
      !lines[i].trim().startsWith('|') &&
      !/^(---|___|\*\*\*)\s*$/.test(lines[i].trim())
    ) {
      pLines.push(lines[i])
      i++
    }
    if (pLines.length > 0) {
      elements.push(
        <p key={`p-${i}`} className="md-p">
          {renderInline(pLines.join(' '))}
        </p>
      )
    }
  }

  return <div className="md-rendered">{elements}</div>
}
