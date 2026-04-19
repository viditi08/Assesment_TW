import { useEffect, useMemo, useRef } from 'react'
import type { TranscriptChunk } from '../domain/transcript'

export function TranscriptPanel(props: { transcript: TranscriptChunk[]; isRecording: boolean }) {
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const items = useMemo(() => props.transcript, [props.transcript])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items.length])

  return (
    <div className="tmPanel">
      <div className="tmPanelHeader">
        <div className="tmPanelTitle">Transcript</div>
        <div className="tmPill">{props.isRecording ? 'Recording' : 'Idle'}</div>
      </div>

      <div className="tmScroll">
        {items.length === 0 ? (
          <div className="tmEmpty">
            Start the mic. Transcript will append roughly every 30 seconds.
          </div>
        ) : (
          <div className="tmList">
            {items.map((c) => (
              <div key={c.id} className="tmTranscriptChunk">
                <div className="tmMeta">
                  {new Date(c.startedAt).toLocaleTimeString()} –{' '}
                  {new Date(c.endedAt).toLocaleTimeString()}
                </div>
                <div className="tmText">{c.text}</div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}

