import type { AppSettings } from './app/settings'
import type { ChatMessage } from './domain/chat'
import type { SuggestionCard } from './domain/suggestions'
import type { TranscriptChunk } from './domain/transcript'

type Message = { role: 'system' | 'user' | 'assistant'; content: string }

export function buildSuggestionPrompt(args: {
  settings: AppSettings
  transcript: TranscriptChunk[]
  nowIso: string
}): Message[] {
  const t = formatTranscriptWindow(args.transcript, args.settings.suggestionsContextChars)
  const last = args.transcript.slice(-3)
  const lastLines =
    last.length === 0
      ? '(empty)'
      : last
          .map((c) => `- ${c.text}`)
          .join('\n')

  return [
    { role: 'system', content: args.settings.suggestionsPrompt },
    {
      role: 'user',
      content: [
        `Now: ${args.nowIso}`,
        `Task: Produce exactly 3 fresh suggestions based on the most recent transcript context.`,
        `Recency focus: prioritize what was said most recently (last 2–3 lines; last ~10–30s in typical cadence).`,
        ``,
        `Last lines (highest weight):`,
        lastLines,
        ``,
        `Recent transcript (most recent last):`,
        t || '(empty transcript)',
      ].join('\n'),
    },
  ]
}

export function buildChatPrompt(args: {
  settings: AppSettings
  transcript: TranscriptChunk[]
  chat: ChatMessage[]
  nowIso: string
}): Message[] {
  const t = formatTranscriptWindow(args.transcript, args.settings.chatContextChars)
  const history = clipChatHistory(args.chat, 20)

  return [
    { role: 'system', content: args.settings.chatPrompt },
    {
      role: 'user',
      content: [
        `Now: ${args.nowIso}`,
        ``,
        `Transcript context:`,
        t || '(empty transcript)',
      ].join('\n'),
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ]
}

export function buildExpandedAnswerPrompt(args: {
  settings: AppSettings
  transcript: TranscriptChunk[]
  chat: ChatMessage[]
  suggestion: SuggestionCard
  nowIso: string
}): Message[] {
  const t = formatTranscriptWindow(args.transcript, args.settings.expandedContextChars)
  const history = clipChatHistory(args.chat, 20)

  const typeGuidance =
    args.suggestion.type === 'fact_check'
      ? [
          `Format:`,
          `- Start with a 1–2 sentence verdict: likely true / likely false / unclear.`,
          `- Then a checklist of what to verify + how (sources, logs, metrics).`,
          `- Call out assumptions and uncertainty explicitly.`,
        ].join('\n')
      : args.suggestion.type === 'talking_point'
        ? [
            `Format:`,
            `- Provide a ready-to-speak script (2–5 sentences).`,
            `- Then 2–4 supporting bullets (why it matters, tradeoffs, next step).`,
          ].join('\n')
        : args.suggestion.type === 'question'
          ? [
              `Format:`,
              `- Provide the exact question to ask (one sentence).`,
              `- Then why it matters + what decisions it unlocks.`,
              `- Provide 1–2 plausible answer paths and how you’d respond.`,
            ].join('\n')
          : args.suggestion.type === 'answer'
            ? [
                `Format:`,
                `- Answer directly first (2–4 sentences).`,
                `- Then short bullets for details, tradeoffs, and next steps.`,
              ].join('\n')
            : [
                `Format:`,
                `- Explain the concept plainly in this meeting’s context.`,
                `- Provide an example / analogy and a concrete next step.`,
              ].join('\n')

  return [
    { role: 'system', content: args.settings.expandedPrompt },
    {
      role: 'user',
      content: [
        `Now: ${args.nowIso}`,
        ``,
        `The user clicked this suggestion:`,
        `- type: ${args.suggestion.type}`,
        `- title: ${args.suggestion.title}`,
        `- preview: ${args.suggestion.preview}`,
        ``,
        `Instruction for expanded answer (from the suggester):`,
        args.suggestion.expandPrompt,
        ``,
        typeGuidance,
        ``,
        `Transcript context:`,
        t || '(empty transcript)',
      ].join('\n'),
    },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ]
}

function clipChatHistory(chat: ChatMessage[], maxMessages: number) {
  if (chat.length <= maxMessages) return chat
  return chat.slice(chat.length - maxMessages)
}

function formatTranscriptWindow(chunks: TranscriptChunk[], maxChars: number) {
  const cap = Math.max(0, Math.floor(Number(maxChars) || 0))
  if (cap <= 0) return ''
  const lines: string[] = []
  for (const c of chunks) {
    lines.push(`[${c.startedAt} → ${c.endedAt}] ${c.text}`)
  }
  const joined = lines.join('\n')
  if (joined.length <= cap) return joined
  return joined.slice(joined.length - cap)
}

