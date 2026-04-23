import { useEffect, useMemo, useRef } from 'react'
import type { TranscriptChunk } from '../domain/transcript'

function formatChunkSeconds(ms: number): string {
  const sec = ms / 1000
  const rounded = Math.round(sec * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

export function TranscriptPanel(props: {
  transcript: TranscriptChunk[]
  isRecording: boolean
  /** Mic segment in progress (capture and/or Whisper) — show progress before first line exists. */
  segmentPipelineBusy?: boolean
  hasKey: boolean
  chunkMs: number
  warmupChunkMs?: number
  onToggleMic: () => void
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const items = useMemo(() => props.transcript, [props.transcript])
  const chunkSec = formatChunkSeconds(props.chunkMs)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items.length])

  return (
    <div className="tmPanel">
      <div className="tmPanelHeader">
        <div className="tmPanelTitle tmPanelTitleCaps">1. Mic &amp; transcript</div>
        <div
          className={
            props.isRecording
              ? 'tmPill tmPillStrong tmPillStatus tmPillStatusLive'
              : 'tmPill tmPillStrong tmPillStatus tmPillStatusIdle'
          }
        >
          {props.isRecording ? '● Recording' : '● Idle'}
        </div>
      </div>

      <div className="tmScroll">
        <div className="tmMicRow">
          <button
            type="button"
            className={props.isRecording ? 'tmMicOrb tmMicOrbOn' : 'tmMicOrb'}
            onClick={props.onToggleMic}
            disabled={!props.hasKey}
            title={props.isRecording ? 'Stop microphone' : 'Start microphone'}
            aria-label={props.isRecording ? 'Stop microphone' : 'Start microphone'}
          >
            <span className="tmMicOrbInner" />
          </button>
          <div className="tmMicHint">
            {!props.hasKey ? (
              <>Add your Groq API key in Settings to use the mic.</>
            ) : props.isRecording ? (
              <>
                Listening… transcript updates every ~{chunkSec}s.
              </>
            ) : (
              <>Click mic to start. Transcript appends every ~{chunkSec}s of audio.</>
            )}
          </div>
        </div>

        <div className="tmCallout tmCalloutAccent">
          The transcript scrolls and appends new chunks every ~{chunkSec}s of audio while recording. Use the mic button to
          start/stop. Include an export button (not shown) so we can pull the full session.
        </div>

        {items.length === 0 ? (
          <div className="tmEmpty">
            {!props.hasKey ? (
              <>Add your Groq API key in Settings to use the mic.</>
            ) : props.isRecording && props.segmentPipelineBusy ? (
              <>Capturing and transcribing this audio segment… the first line appears here when Whisper finishes.</>
            ) : props.isRecording ? (
              <>Listening… the next line appears when the current segment ends (~{chunkSec}s of audio).</>
            ) : (
              <>No transcript yet — start the mic.</>
            )}
          </div>
        ) : (
          <div className="tmList">
            {items.map((c) => (
              <div key={c.id} className="tmTranscriptChunk">
                <div className="tmTranscriptLine">
                  <span className="tmTranscriptTime">{new Date(c.startedAt).toLocaleTimeString()}</span>
                  <span className="tmTranscriptBody">{c.text}</span>
                </div>
              </div>
            ))}
            {props.isRecording && props.segmentPipelineBusy ? (
              <div className="tmTranscriptPending" aria-live="polite">
                Transcribing next segment…
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  )
}
