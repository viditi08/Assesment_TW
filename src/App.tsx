import * as React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import './App.css'
import {
  buildDefaultSettings,
  DEFAULT_GROQ_CHAT_MODEL,
  mergeStoredAppSettings,
  type AppSettings,
} from './app/settings'
import { useLocalStorageState } from './app/useLocalStorageState'
import { type TranscriptChunk } from './domain/transcript'
import { type SuggestionBatch, type SuggestionCard } from './domain/suggestions'
import { type ChatMessage } from './domain/chat'
import { exportSessionJson } from './lib/export'
import {
  groqCreateChatCompletionStream,
  groqErrorMessageLooksLikeDailyTokenLimit,
  groqSuggestionsWithRetries,
  groqTranscribe,
  summarizeSuggestionRefreshError,
} from './lib/groq'
import { useMicRecorder } from './lib/useMicRecorder'
import { buildSuggestionPrompt, buildChatPrompt, buildExpandedAnswerPrompt } from './prompts'
import { SettingsModal } from './ui/SettingsModal'
import { ChatPanel } from './ui/ChatPanel'
import { SuggestionsPanel } from './ui/SuggestionsPanel'
import { TranscriptPanel } from './ui/TranscriptPanel'

export default function App() {
  const sessionStartedAt = useRef<string>(new Date().toISOString())
  const defaultSettings = useMemo(() => buildDefaultSettings(), [])
  const [settings, setSettings] = useLocalStorageState<AppSettings>(
    'tm_settings_v1',
    defaultSettings,
    mergeStoredAppSettings,
  )

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [transcript, setTranscript] = useState<TranscriptChunk[]>([])
  const [suggestionBatches, setSuggestionBatches] = useState<SuggestionBatch[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])

  const [status, setStatus] = useState<string | null>(null)
  /** Full message for `title` tooltip when the line is shortened (e.g. Groq errors). */
  const [statusTitle, setStatusTitle] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isChatBusy, setIsChatBusy] = useState(false)
  /** Resets the “auto-refresh in Ns” countdown after each successful suggestion run. */
  const [lastSuggestionSuccessAt, setLastSuggestionSuccessAt] = useState(() => Date.now())
  const [suggestionCountdownTick, setSuggestionCountdownTick] = useState(0)
  /** Used to avoid regenerating suggestions when transcript hasn't advanced. */
  const lastSuggestedChunkIdRef = useRef<string | null>(null)

  /** Skip auto suggestion refresh after daily-token (TPD) errors — manual Refresh still runs. */
  const pauseAutoSuggestionsUntilRef = useRef(0)
  const transcriptRef = useRef<TranscriptChunk[]>([])
  /** Set after `refreshSuggestions` exists; used from `onChunk` for immediate post-transcript refresh. */
  const refreshSuggestionsRef = useRef<(opts?: { flushFirst?: boolean; reason?: 'auto' | 'manual' }) => void>(
    () => {},
  )
  /** Prevents overlapping suggestion requests without re-creating `refreshSuggestions` every tick. */
  const isRefreshingRef = useRef(false)
  /** True while a mic segment is in flight (capture + Whisper). */
  const [segmentPipelineBusy, setSegmentPipelineBusy] = useState(false)

  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  const apiKey = settings.groqApiKey.trim()
  const hasKey = apiKey.length > 0

  /** Assignment: fixed model for fair comparison across submissions. */
  const chatModel = DEFAULT_GROQ_CHAT_MODEL

  useEffect(() => {
    if (!hasKey || !settings.autoRefreshEnabled) return
    const id = window.setInterval(() => setSuggestionCountdownTick((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [hasKey, settings.autoRefreshEnabled])

  const autoRefreshCountdownSec = useMemo(() => {
    if (!hasKey || !settings.autoRefreshEnabled) return null
    void suggestionCountdownTick
    const elapsed = Date.now() - lastSuggestionSuccessAt
    return Math.max(0, Math.ceil((settings.autoRefreshMs - elapsed) / 1000))
  }, [hasKey, settings.autoRefreshEnabled, settings.autoRefreshMs, lastSuggestionSuccessAt, suggestionCountdownTick])

  const showStatus = useCallback((line: string, detail?: string) => {
    setStatus(line)
    setStatusTitle(detail ?? line)
  }, [])

  const clearStatus = useCallback(() => {
    setStatus(null)
    setStatusTitle(null)
  }, [])

  const onSegmentStart = useCallback(() => setSegmentPipelineBusy(true), [])
  const onSegmentEnd = useCallback(() => setSegmentPipelineBusy(false), [])

  const onChunk = useCallback(
    async (chunk: Blob, chunkStartedAt: string, chunkEndedAt: string, recorderMimeType: string) => {
      if (!hasKey) return
      try {
        showStatus('Transcribing…')
        const text = await groqTranscribe({
          apiKey,
          audioBlob: chunk,
          model: 'whisper-large-v3',
          language: settings.transcriptionLanguage || undefined,
          prompt: settings.transcriptionPrompt || undefined,
          mimeTypeHint: recorderMimeType,
        })

        const cleaned = text.trim()
        if (!cleaned) {
          clearStatus()
          return
        }

        const chunkId = crypto.randomUUID()
        const newChunk = {
          id: chunkId,
          startedAt: chunkStartedAt,
          endedAt: chunkEndedAt,
          text: cleaned,
        }
        // Commit before returning to the recorder so `await mic.flush()` + suggestion refresh see latest text.
        flushSync(() => {
          setTranscript((prev) => {
            const next = [...prev, newChunk]
            transcriptRef.current = next
            return next
          })
        })
        clearStatus()

        if (settings.autoRefreshEnabled) {
          queueMicrotask(() => {
            void refreshSuggestionsRef.current({ flushFirst: false, reason: 'auto' })
          })
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        showStatus(`Transcription failed: ${msg}`, `Transcription failed: ${msg}`)
      }
    },
    [
      apiKey,
      clearStatus,
      hasKey,
      settings.autoRefreshEnabled,
      settings.transcriptionLanguage,
      settings.transcriptionPrompt,
      showStatus,
    ],
  )

  const mic = useMicRecorder({
    chunkMs: settings.transcriptionChunkMs,
    warmupChunkMs: 10_000,
    warmupSegments: 1,
    onChunk,
    enabled: hasKey,
    onSegmentStart,
    onSegmentEnd,
  })

  const refreshSuggestions = useCallback(
    async (opts?: { flushFirst?: boolean; reason?: 'auto' | 'manual' }) => {
      if (!hasKey) {
        showStatus('Add a Groq API key in Settings to start.')
        return
      }
      if (isRefreshingRef.current) return

      const reason = opts?.reason ?? 'manual'
      if (reason === 'auto' && Date.now() < pauseAutoSuggestionsUntilRef.current) {
        return
      }

      isRefreshingRef.current = true
      setIsRefreshing(true)
      try {
        if (opts?.flushFirst) {
          await mic.flush()
        }

        const tNow = transcriptRef.current
        if (reason === 'auto' && tNow.length === 0) {
          clearStatus()
          setLastSuggestionSuccessAt(Date.now())
          return
        }

        const latestChunkId = tNow.at(-1)?.id ?? null
        if (reason === 'auto' && latestChunkId && latestChunkId === lastSuggestedChunkIdRef.current) {
          clearStatus()
          setLastSuggestionSuccessAt(Date.now())
          return
        }

        showStatus('Generating suggestions…')
        const prompt = buildSuggestionPrompt({
          settings,
          transcript: tNow,
          nowIso: new Date().toISOString(),
        })

        const parsed = await groqSuggestionsWithRetries({
          apiKey,
          model: chatModel,
          messages: prompt,
          temperature: settings.suggestionsTemperature,
          maxTokens: settings.suggestionsMaxTokens,
          reasoningEffort: settings.groqReasoningEffort,
        })

        const cards: SuggestionCard[] = parsed.suggestions.map((s) => ({
          id: s.id,
          type: s.type,
          title: s.title,
          preview: s.preview,
          expandPrompt: s.expand_prompt,
        }))

        const batch: SuggestionBatch = {
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          basedOnChunkId: latestChunkId,
          suggestions: cards,
        }

        setSuggestionBatches((prev) => [batch, ...prev])
        lastSuggestedChunkIdRef.current = latestChunkId
        pauseAutoSuggestionsUntilRef.current = 0
        setLastSuggestionSuccessAt(Date.now())
        clearStatus()
      } catch (e) {
        const { line, full } = summarizeSuggestionRefreshError(e)
        showStatus(line, full)
        const inner = e instanceof Error ? e.message : String(e)
        if (groqErrorMessageLooksLikeDailyTokenLimit(inner)) {
          pauseAutoSuggestionsUntilRef.current = Date.now() + 7 * 60 * 1000
        }
      } finally {
        isRefreshingRef.current = false
        setIsRefreshing(false)
      }
    },
    [apiKey, chatModel, clearStatus, hasKey, mic, settings, showStatus, setLastSuggestionSuccessAt],
  )

  refreshSuggestionsRef.current = refreshSuggestions

  // While the mic is on: periodic backup refresh (defaults near chunk length) if a transcript-fired run was skipped.
  useEffect(() => {
    if (!hasKey) return
    if (!settings.autoRefreshEnabled) return
    if (!mic.isRecording) return
    const handle = window.setInterval(() => {
      void refreshSuggestions({ flushFirst: false, reason: 'auto' })
    }, settings.autoRefreshMs)
    return () => window.clearInterval(handle)
  }, [hasKey, mic.isRecording, refreshSuggestions, settings.autoRefreshEnabled, settings.autoRefreshMs])

  const sendChat = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim()
      if (!trimmed) return
      if (!hasKey) {
        showStatus('Add a Groq API key in Settings to chat.')
        return
      }
      if (isChatBusy) return

      setIsChatBusy(true)
      clearStatus()
      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        createdAt: new Date().toISOString(),
        content: trimmed,
      }

      const assistantId = crypto.randomUUID()
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content: '',
      }

      setChat((prev) => [...prev, userMsg, assistantMsg])

      try {
        const messages = buildChatPrompt({
          settings,
          transcript,
          chat: [...chat, userMsg],
          nowIso: new Date().toISOString(),
        })

        await groqCreateChatCompletionStream({
          apiKey,
          model: chatModel,
          messages,
          temperature: settings.chatTemperature,
          maxTokens: settings.chatMaxTokens,
          reasoningEffort: settings.groqReasoningEffort,
        }).streamText((delta) => {
          if (!delta) return
          setChat((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          )
        })
      } catch (e) {
        setChat((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: `Error: ${e instanceof Error ? e.message : String(e)}`,
                }
              : m,
          ),
        )
      } finally {
        setIsChatBusy(false)
      }
    },
    [apiKey, chat, chatModel, clearStatus, hasKey, isChatBusy, settings, transcript, showStatus],
  )

  const onSuggestionClick = useCallback(
    async (suggestion: SuggestionCard) => {
      if (isChatBusy) return
      const userText = suggestion.title
      const trimmed = userText.trim()
      if (!trimmed) return

      const userMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        createdAt: new Date().toISOString(),
        content: trimmed,
      }

      const assistantId = crypto.randomUUID()
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        createdAt: new Date().toISOString(),
        content: '',
      }

      setChat((prev) => [...prev, userMsg, assistantMsg])
      setIsChatBusy(true)
      clearStatus()

      try {
        const messages = buildExpandedAnswerPrompt({
          settings,
          transcript,
          chat: [...chat, userMsg],
          suggestion,
          nowIso: new Date().toISOString(),
        })

        await groqCreateChatCompletionStream({
          apiKey,
          model: chatModel,
          messages,
          temperature: settings.expandedTemperature,
          maxTokens: settings.expandedMaxTokens,
          reasoningEffort: settings.groqReasoningEffort,
        }).streamText((delta) => {
          if (!delta) return
          setChat((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, content: m.content + delta } : m)),
          )
        })
      } catch (e) {
        setChat((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: `Error: ${e instanceof Error ? e.message : String(e)}` }
              : m,
          ),
        )
      } finally {
        setIsChatBusy(false)
      }
    },
    [apiKey, chat, chatModel, clearStatus, isChatBusy, settings, transcript],
  )

  const onExport = useCallback(() => {
    const json = exportSessionJson({
      startedAt: sessionStartedAt.current,
      transcript,
      suggestionBatches,
      chat,
    })
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `twinmind-session-${new Date().toISOString()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [chat, suggestionBatches, transcript])

  const headerRight = (
    <div className="tmHeaderRight">
      <button className="tmButton" onClick={onExport} disabled={!transcript.length && !chat.length}>
        Export
      </button>
      <button className="tmButton" onClick={() => setIsSettingsOpen(true)}>
        Settings
      </button>
    </div>
  )

  return (
    <div className="tmApp">
      <header className="tmHeader tmHeaderTwoCol">
        <div className="tmHeaderLeft">
          <div className="tmTitle">TwinMind — Live Suggestions Web App</div>
          <div className="tmSubtle tmSubtleWrap">
            3-column layout · Transcript · Live suggestions · Chat
          </div>
          <div className="tmSubtle">
            {hasKey ? (
              <React.Fragment>
                Groq key set · Mic: <strong>{mic.isRecording ? 'on' : 'off'}</strong>
              </React.Fragment>
            ) : (
              <strong>Paste your Groq API key in Settings</strong>
            )}
          </div>
          {status ? (
            <div
              className={
                status.includes('failed') ? 'tmStatusRow tmStatusRowErr' : 'tmStatusRow tmStatusRowInfo'
              }
              title={statusTitle ?? status}
            >
              {status}
            </div>
          ) : null}
        </div>
        {headerRight}
      </header>

      <main className="tmMain">
        <section className="tmCol">
          <TranscriptPanel
            transcript={transcript}
            isRecording={mic.isRecording}
            segmentPipelineBusy={segmentPipelineBusy}
            hasKey={hasKey}
            chunkMs={settings.transcriptionChunkMs}
            warmupChunkMs={10_000}
            onToggleMic={() => (mic.isRecording ? void mic.stop() : void mic.start())}
          />
        </section>
        <section className="tmCol tmColMiddle">
          <SuggestionsPanel
            batches={suggestionBatches}
            hasTranscript={transcript.length > 0}
            onClickSuggestion={onSuggestionClick}
            onReload={() => void refreshSuggestions({ flushFirst: true, reason: 'manual' })}
            isReloading={isRefreshing}
            autoRefreshCountdownSec={autoRefreshCountdownSec}
            autoRefreshIntervalSec={Math.max(1, Math.round(settings.autoRefreshMs / 1000))}
            hasKey={hasKey}
          />
        </section>
        <section className="tmCol tmColRight">
          <ChatPanel messages={chat} onSend={sendChat} isBusy={isChatBusy} />
        </section>
      </main>

      <SettingsModal
        open={isSettingsOpen}
        settings={settings}
        defaults={defaultSettings}
        onClose={() => setIsSettingsOpen(false)}
        onChange={setSettings}
      />
    </div>
  )
}
