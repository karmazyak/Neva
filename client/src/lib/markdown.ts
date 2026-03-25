import React from 'react'

// Lightweight markdown parser for chat messages
// Supports: **bold**, *italic*, ~~strikethrough~~, `code`, ```code blocks```, @mentions

interface Token {
  type: 'text' | 'bold' | 'italic' | 'strike' | 'code' | 'codeblock' | 'mention'
  content: string
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < text.length) {
    // Code block: ```...```
    if (text.startsWith('```', i)) {
      const end = text.indexOf('```', i + 3)
      if (end !== -1) {
        tokens.push({ type: 'codeblock', content: text.slice(i + 3, end).replace(/^\n/, '') })
        i = end + 3
        continue
      }
    }

    // Inline code: `...`
    if (text[i] === '`') {
      const end = text.indexOf('`', i + 1)
      if (end !== -1 && end > i + 1) {
        tokens.push({ type: 'code', content: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    // Bold: **...**
    if (text.startsWith('**', i)) {
      const end = text.indexOf('**', i + 2)
      if (end !== -1 && end > i + 2) {
        tokens.push({ type: 'bold', content: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }

    // Strikethrough: ~~...~~
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2)
      if (end !== -1 && end > i + 2) {
        tokens.push({ type: 'strike', content: text.slice(i + 2, end) })
        i = end + 2
        continue
      }
    }

    // Italic: *...* (but not **)
    if (text[i] === '*' && text[i + 1] !== '*') {
      const end = text.indexOf('*', i + 1)
      if (end !== -1 && end > i + 1 && text[end + 1] !== '*') {
        tokens.push({ type: 'italic', content: text.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    // @mention
    if (text[i] === '@' && (i === 0 || /\s/.test(text[i - 1]))) {
      const match = text.slice(i).match(/^@(\w{2,30})/)
      if (match) {
        tokens.push({ type: 'mention', content: match[1] })
        i += match[0].length
        continue
      }
    }

    // Plain text — collect until next special char
    let end = i + 1
    while (end < text.length && !'*`~@'.includes(text[end])) {
      end++
    }
    tokens.push({ type: 'text', content: text.slice(i, end) })
    i = end
  }

  return tokens
}

export function renderMarkdown(text: string): React.ReactNode[] {
  const tokens = tokenize(text)
  return tokens.map((token, i) => {
    switch (token.type) {
      case 'bold':
        return React.createElement('strong', { key: i, className: 'font-bold' }, token.content)
      case 'italic':
        return React.createElement('em', { key: i, className: 'italic' }, token.content)
      case 'strike':
        return React.createElement('s', { key: i, className: 'line-through opacity-70' }, token.content)
      case 'code':
        return React.createElement('code', {
          key: i,
          className: 'bg-white/10 rounded px-1 py-0.5 font-mono text-[13px]'
        }, token.content)
      case 'codeblock':
        return React.createElement('pre', {
          key: i,
          className: 'bg-black/30 rounded-lg p-3 my-1 overflow-x-auto font-mono text-[13px] whitespace-pre'
        }, React.createElement('code', null, token.content))
      case 'mention':
        return React.createElement('span', {
          key: i,
          className: 'text-accent font-semibold cursor-pointer hover:underline'
        }, `@${token.content}`)
      default:
        return React.createElement(React.Fragment, { key: i }, token.content)
    }
  })
}
