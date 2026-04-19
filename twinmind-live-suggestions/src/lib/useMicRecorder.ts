import { useCallback, useEffect, useRef, useState } from 'react'

export function useMicRecorder(args: {
  chunkMs: number
  enabled: boolean
  onChunk: (blob: Blob, startedAt: string, endedAt: string) => Promise<void> | void
}) {
  const [isRecording, setIsRecording] = useState(false)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunkStartIsoRef = useRef<string | null>(null)
  const inflightFlushRef = useRef<Promise<void> | null>(null)

  const stopTracks = useCallback(() => {
    const stream = mediaStreamRef.current
    if (stream) {
      for (const t of stream.getTracks()) t.stop()
    }
    mediaStreamRef.current = null
  }, [])

  const stop = useCallback(async () => {
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop()
    }
    recorderRef.current = null
    stopTracks()
    setIsRecording(false)
  }, [stopTracks])

  useEffect(() => {
    if (!args.enabled && isRecording) {
      const t = window.setTimeout(() => {
        void stop()
      }, 0)
      return () => window.clearTimeout(t)
    }
  }, [args.enabled, isRecording, stop])

  const start = useCallback(async () => {
    if (!args.enabled) return
    if (isRecording) return

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
    mediaStreamRef.current = stream

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    recorderRef.current = recorder

    recorder.onstart = () => {
      setIsRecording(true)
      chunkStartIsoRef.current = new Date().toISOString()
    }

    recorder.ondataavailable = (evt) => {
      const blob = evt.data
      if (!blob || blob.size === 0) return
      const startedAt = chunkStartIsoRef.current ?? new Date().toISOString()
      const endedAt = new Date().toISOString()
      chunkStartIsoRef.current = endedAt
      void args.onChunk(blob, startedAt, endedAt)
    }

    recorder.onerror = () => {
      void stop()
    }

    recorder.start(args.chunkMs)
  }, [args, isRecording, stop])

  const flush = useCallback(async () => {
    const rec = recorderRef.current
    if (!rec) return
    if (rec.state !== 'recording') return

    // Avoid concurrent flushes.
    if (inflightFlushRef.current) return inflightFlushRef.current

    inflightFlushRef.current = new Promise<void>((resolve) => {
      const onData = () => {
        rec.removeEventListener('dataavailable', onData)
        inflightFlushRef.current = null
        resolve()
      }
      rec.addEventListener('dataavailable', onData, { once: true })
      try {
        rec.requestData()
      } catch {
        rec.removeEventListener('dataavailable', onData)
        inflightFlushRef.current = null
        resolve()
      }
    })

    return inflightFlushRef.current
  }, [])

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

