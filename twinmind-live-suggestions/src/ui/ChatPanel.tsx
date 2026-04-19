import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../domain/chat'

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
    const text = draft
    setDraft('')
    await props.onSend(text)
  }

  return (
    <div className="tmPanel tmPanelChat">
      <div className="tmPanelHeader">
        <div className="tmPanelTitle">Chat</div>
        <div className="tmSubtleSmall">{props.isBusy ? 'Thinking…' : ''}</div>
      </div>

      <div className="tmScroll tmChatScroll">
        {props.messages.length === 0 ? (
          <div className="tmEmpty">Click a suggestion, or type a question.</div>
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
                <div className="tmChatText">{m.content}</div>
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
          placeholder="Ask a question…"
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
          <button className="tmButton tmButtonPrimary" onClick={() => void send()} disabled={props.isBusy}>
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

