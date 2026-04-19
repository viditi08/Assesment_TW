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

  return [
    { role: 'system', content: args.settings.suggestionsPrompt },
    {
      role: 'user',
      content: [
        `Now: ${args.nowIso}`,
        `Task: Produce exactly 3 fresh suggestions based on the most recent transcript context.`,
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
  if (maxChars <= 0) return ''
  const lines: string[] = []
  for (const c of chunks) {
    lines.push(`[${c.startedAt} → ${c.endedAt}] ${c.text}`)
  }
  const joined = lines.join('\n')
  if (joined.length <= maxChars) return joined
  return joined.slice(joined.length - maxChars)
}

