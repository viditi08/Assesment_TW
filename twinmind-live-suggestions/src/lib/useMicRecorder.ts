import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Records the mic in repeating segments of `chunkMs`.
 *
 * Chrome often emits **non-standalone** WebM fragments with `MediaRecorder.start(timeslice)`,
 * which makes Groq Whisper return 400 "valid media file?". We **stop and start a new
 * MediaRecorder** on the same stream each segment so every blob is a complete file (EBML header).
 */
export function useMicRecorder(args: {
  chunkMs: number
  enabled: boolean
  onChunk: (
    blob: Blob,
    startedAt: string,
    endedAt: string,
    recorderMimeType: string,
  ) => Promise<void> | void
  /** Fires when a new capture segment begins (after `MediaRecorder.start`). */
  onSegmentStart?: () => void
  /** Fires when the segment pipeline ends (after `onChunk` when audio was non-empty, or immediately if empty). */
  onSegmentEnd?: () => void
}) {
  const argsRef = useRef(args)
  argsRef.current = args

  const [isRecording, setIsRecording] = useState(false)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingActiveRef = useRef(false)
  const segmentTimerRef = useRef<number | null>(null)
  const currentRecorderRef = useRef<MediaRecorder | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  /** Resolves when the **current** segment's `onstop` has run (for `flush`). */
  const segmentStoppedRef = useRef<Promise<void> | null>(null)
  const resolveSegmentStoppedRef = useRef<(() => void) | null>(null)
  const inflightFlushRef = useRef<Promise<void> | null>(null)

  const stopTracks = useCallback(() => {
    const stream = mediaStreamRef.current
    if (stream) {
      for (const t of stream.getTracks()) t.stop()
    }
    mediaStreamRef.current = null
  }, [])

  const clearSegmentTimer = useCallback(() => {
    if (segmentTimerRef.current !== null) {
      window.clearTimeout(segmentTimerRef.current)
      segmentTimerRef.current = null
    }
  }, [])

  const beginSegmentWait = useCallback(() => {
    segmentStoppedRef.current = new Promise<void>((resolve) => {
      resolveSegmentStoppedRef.current = resolve
    })
  }, [])

  const endSegmentWait = useCallback(() => {
    resolveSegmentStoppedRef.current?.()
    resolveSegmentStoppedRef.current = null
  }, [])

  const runSegmentLoop = useCallback(
    async (stream: MediaStream) => {
      while (recordingActiveRef.current && stream.active) {
        const { chunkMs, onChunk } = argsRef.current
        const mimeType = pickMimeType()
        const chunks: Blob[] = []

        let rec: MediaRecorder
        try {
          rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
        } catch {
          break
        }

        currentRecorderRef.current = rec
        recorderRef.current = rec

        const startedAt = new Date().toISOString()
        const mime = rec.mimeType || mimeType || 'audio/webm'

        beginSegmentWait()

        await new Promise<void>((resolveLoop) => {
          let settled = false
          let segmentLifecycleOpen = false
          const closeSegmentLifecycle = () => {
            if (!segmentLifecycleOpen) return
            segmentLifecycleOpen = false
            argsRef.current.onSegmentEnd?.()
          }

          const done = () => {
            if (settled) return
            settled = true
            endSegmentWait()
            resolveLoop()
          }

          rec.ondataavailable = (e) => {
            if (e.data?.size) chunks.push(e.data)
          }

          rec.onerror = () => {
            clearSegmentTimer()
            closeSegmentLifecycle()
            done()
          }

          rec.onstop = () => {
            clearSegmentTimer()
            const endedAt = new Date().toISOString()
            const blob = new Blob(chunks, { type: mime })
            ;(async () => {
              try {
                if (blob.size > 0) {
                  // Await so `flush()` / segment boundaries wait for Whisper + React state (see App `onChunk`).
                  await Promise.resolve(onChunk(blob, startedAt, endedAt, mime))
                }
              } finally {
                closeSegmentLifecycle()
                currentRecorderRef.current = null
                recorderRef.current = null
                done()
              }
            })()
          }

          try {
            rec.start()
            argsRef.current.onSegmentStart?.()
            segmentLifecycleOpen = true
          } catch {
            done()
            return
          }

          segmentTimerRef.current = window.setTimeout(() => {
            try {
              if (rec.state === 'recording') rec.stop()
            } catch {
              done()
            }
          }, chunkMs)
        })
      }

      recordingActiveRef.current = false
      clearSegmentTimer()
      currentRecorderRef.current = null
      recorderRef.current = null
      stopTracks()
      setIsRecording(false)
    },
    [beginSegmentWait, clearSegmentTimer, endSegmentWait, stopTracks],
  )

  const stop = useCallback(() => {
    recordingActiveRef.current = false
    clearSegmentTimer()
    const rec = currentRecorderRef.current
    if (rec && rec.state === 'recording') {
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
    }
  }, [clearSegmentTimer])

  useEffect(() => {
    if (!argsRef.current.enabled && isRecording) {
      const t = window.setTimeout(() => {
        stop()
      }, 0)
      return () => window.clearTimeout(t)
    }
  }, [args.enabled, isRecording, stop])

  const start = useCallback(async () => {
    if (!argsRef.current.enabled) return
    if (recordingActiveRef.current) return

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch {
      return
    }

    mediaStreamRef.current = stream
    recordingActiveRef.current = true
    setIsRecording(true)
    void runSegmentLoop(stream)
  }, [runSegmentLoop])

  const flush = useCallback(async () => {
    if (inflightFlushRef.current) return inflightFlushRef.current

    inflightFlushRef.current = (async () => {
      clearSegmentTimer()
      const rec = currentRecorderRef.current
      const wait = segmentStoppedRef.current
      if (!rec || rec.state !== 'recording') {
        return
      }
      try {
        rec.stop()
      } catch {
        return
      }
      if (wait) {
        await wait
      }
    })().finally(() => {
      inflightFlushRef.current = null
    })

    return inflightFlushRef.current
  }, [clearSegmentTimer])

  return { isRecording, start, stop, flush }
}

function pickMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ]
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c
  }
  return ''
}
