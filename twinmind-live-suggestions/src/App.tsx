import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './app.css'
import {
  buildDefaultSettings,
  mergeStoredAppSettings,
  normalizeGroqChatModelId,
  type AppSettings,
} from './app/settings'
import { useLocalStorageState } from './app/useLocalStorageState'
import { type TranscriptChunk } from './domain/transcript'
import { type SuggestionBatch, type SuggestionCard } from './domain/suggestions'
import { type ChatMessage } from './domain/chat'
import { exportSessionJson } from './lib/export'
import {
  groqChatCompletionSuggestionsJson,
  groqCreateChatCompletionStream,
  groqTranscribe,
} from './lib/groq'
import { parseSuggestionsModelOutput } from './lib/suggestionsResponse'
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
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isChatBusy, setIsChatBusy] = useState(false)

  const lastRefreshedChunkIdRef = useRef<string | null>(null)
  const transcriptRef = useRef<TranscriptChunk[]>([])
  useEffect(() => {
    transcriptRef.current = transcript
  }, [transcript])

  const apiKey = settings.groqApiKey.trim()
  const hasKey = apiKey.length > 0

  const chatModel = useMemo(
    () => normalizeGroqChatModelId(settings.groqChatModel),
    [settings.groqChatModel],
  )

  const onChunk = useCallback(
    async (chunk: Blob, chunkStartedAt: string, chunkEndedAt: string) => {
      if (!hasKey) return
      try {
        setStatus('Transcribing…')
        const text = await groqTranscribe({
          apiKey,
          audioBlob: chunk,
          model: 'whisper-large-v3',
          language: settings.transcriptionLanguage || undefined,
          prompt: settings.transcriptionPrompt || undefined,
        })

        const cleaned = text.trim()
        if (!cleaned) {
          setStatus(null)
          return
        }

        const chunkId = crypto.randomUUID()
        setTranscript((prev) => [
          ...prev,
          { id: chunkId, startedAt: chunkStartedAt, endedAt: chunkEndedAt, text: cleaned },
        ])
        setStatus(null)
      } catch (e) {
        setStatus(`Transcription failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
    [apiKey, hasKey, settings.transcriptionLanguage, settings.transcriptionPrompt],
  )

  const mic = useMicRecorder({
    chunkMs: settings.transcriptionChunkMs,
    onChunk,
    enabled: hasKey,
  })

  const refreshSuggestions = useCallback(
    async (opts?: { flushFirst?: boolean; reason?: 'auto' | 'manual' }) => {
      if (!hasKey) {
        setStatus('Add a Groq API key in Settings to start.')
        return
      }
      if (isRefreshing) return

      setIsRefreshing(true)
      const reason = opts?.reason ?? 'manual'
      try {
        if (opts?.flushFirst) {
          await mic.flush()
        }

        const tNow = transcriptRef.current
        const latestChunkId = tNow.at(-1)?.id ?? null
        if (reason === 'auto' && latestChunkId && latestChunkId === lastRefreshedChunkIdRef.current) {
          return
        }

        setStatus('Generating suggestions…')
        const prompt = buildSuggestionPrompt({
          settings,
          transcript: tNow,
          nowIso: new Date().toISOString(),
        })

        const responseText = await groqChatCompletionSuggestionsJson({
          apiKey,
          model: chatModel,
          messages: prompt,
          temperature: settings.suggestionsTemperature,
          maxTokens: settings.suggestionsMaxTokens,
          reasoningEffort: settings.groqReasoningEffort,
        })

        if (!responseText.trim()) {
          throw new Error('Empty response from model for suggestions.')
        }

        const parsed = parseSuggestionsModelOutput(responseText)

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
        lastRefreshedChunkIdRef.current = latestChunkId
        setStatus(null)
      } catch (e) {
        setStatus(`Suggestion refresh failed: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setIsRefreshing(false)
      }
    },
    [apiKey, chatModel, hasKey, isRefreshing, mic, settings],
  )

  // Auto-refresh suggestions roughly every 30s (configurable).
  useEffect(() => {
    if (!hasKey) return
    if (!settings.autoRefreshEnabled) return
    const handle = window.setInterval(() => {
      void refreshSuggestions({ flushFirst: false, reason: 'auto' })
    }, settings.autoRefreshMs)
    return () => window.clearInterval(handle)
  }, [hasKey, refreshSuggestions, settings.autoRefreshEnabled, settings.autoRefreshMs])

  // After new transcript: debounce so we don't stack requests (Whisper + suggestions → 429).
  const SUGGESTIONS_AFTER_TRANSCRIPT_DEBOUNCE_MS = 5000
  useEffect(() => {
    if (!hasKey) return
    if (!settings.autoRefreshEnabled) return
    if (transcript.length === 0) return
    const t = window.setTimeout(() => {
      void refreshSuggestions({ flushFirst: false, reason: 'auto' })
    }, SUGGESTIONS_AFTER_TRANSCRIPT_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [hasKey, refreshSuggestions, settings.autoRefreshEnabled, transcript.length])

  const sendChat = useCallback(
    async (userText: string) => {
      const trimmed = userText.trim()
      if (!trimmed) return
      if (!hasKey) {
        setStatus('Add a Groq API key in Settings to chat.')
        return
      }
      if (isChatBusy) return

      setIsChatBusy(true)
      setStatus(null)
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
    [apiKey, chat, chatModel, hasKey, isChatBusy, settings, transcript],
  )

  const onSuggestionClick = useCallback(
    async (suggestion: SuggestionCard) => {
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
      setStatus(null)

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
    [apiKey, chat, chatModel, settings, transcript],
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
      <button
        className="tmButton"
        onClick={() => void refreshSuggestions({ flushFirst: true, reason: 'manual' })}
        disabled={!hasKey || isRefreshing}
        title="Refresh transcript then suggestions"
      >
        {isRefreshing ? 'Refreshing…' : 'Refresh'}
      </button>
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
      <header className="tmHeader">
        <div className="tmHeaderLeft">
          <div className="tmTitle">TwinMind — Live Suggestions (Groq)</div>
          <div className="tmSubtle">
            {hasKey ? (
              <>
                Mic: <strong>{mic.isRecording ? 'On' : 'Off'}</strong>
              </>
            ) : (
              <strong>Paste your Groq API key in Settings</strong>
            )}
            {status ? <span className="tmStatus"> · {status}</span> : null}
          </div>
        </div>
        <div className="tmHeaderCenter">
          <button
            className={mic.isRecording ? 'tmButton tmButtonPrimary' : 'tmButton'}
            onClick={() => (mic.isRecording ? void mic.stop() : void mic.start())}
            disabled={!hasKey}
            title="Start / stop microphone"
          >
            {mic.isRecording ? 'Stop Mic' : 'Start Mic'}
          </button>
        </div>
        {headerRight}
      </header>

      <main className="tmMain">
        <section className="tmCol">
          <TranscriptPanel transcript={transcript} isRecording={mic.isRecording} />
        </section>
        <section className="tmCol tmColMiddle">
          <SuggestionsPanel batches={suggestionBatches} onClickSuggestion={onSuggestionClick} />
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
