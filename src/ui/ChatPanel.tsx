import * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { ChatMessage } from '../domain/chat'

const chatMarkdownComponents: Partial<Components> = {
  a: ({ node: _node, ...props }) => (
    <React.Fragment>
      <a {...props} target="_blank" rel="noopener noreferrer" />
    </React.Fragment>
  ),
}

export function ChatPanel(props: {
  messages: ChatMessage[]
  onSend: (text: string) => Promise<void> | void
  isBusy: boolean
}) {
  const [draft, setDraft] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [props.messages.length, props.isBusy])

  const send = async () => {
    if (props.isBusy) return
    const text = draft.trim()
    if (!text) return
    setDraft('')
    await props.onSend(text)
  }

  return (
    <div className="tmPanel tmPanelChat">
      <div className="tmPanelHeader">
        <div className="tmPanelTitle tmPanelTitleCaps">3. Chat (detailed answers)</div>
        <div className="tmPill tmPillStrong">Session-only</div>
      </div>

      <div className="tmScroll tmChatScroll">
        <div className="tmCallout tmCalloutAccent">
          Clicking a suggestion adds it to this chat and streams a detailed answer (separate prompt, more context).
          User can also type questions directly. One continuous chat per session — no login, no persistence.
        </div>

        {props.messages.length === 0 ? (
          <div className="tmEmpty tmChatPlaceholder">Click a suggestion or type a question below.</div>
        ) : (
          <div className="tmChatList">
            {props.messages.map((m) => (
              <div
                key={m.id}
                className={m.role === 'user' ? 'tmChatMsg tmChatUser' : 'tmChatMsg tmChatAssistant'}
              >
                <div className="tmChatMeta">
                  <span className="tmPill">{m.role}</span>
                  <span className="tmMeta">{new Date(m.createdAt).toLocaleTimeString()}</span>
                </div>
                {m.role === 'user' ? (
                  <div className="tmChatText tmChatTextPlain">{m.content}</div>
                ) : (
                  <div className="tmChatMd">
                    <ReactMarkdown components={chatMarkdownComponents}>{m.content}</ReactMarkdown>
                  </div>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="tmChatComposer">
        <textarea
          className="tmTextarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask anything…"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="tmChatComposerRow">
          <div className="tmSubtleSmall">Send: Ctrl/⌘ + Enter</div>
          <button className="tmButton tmSendBtn" onClick={() => void send()} disabled={props.isBusy}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
