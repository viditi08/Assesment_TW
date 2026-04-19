import type { ChatMessage } from '../domain/chat'
import type { SuggestionBatch } from '../domain/suggestions'
import type { TranscriptChunk } from '../domain/transcript'

export function exportSessionJson(args: {
  startedAt: string
  transcript: TranscriptChunk[]
  suggestionBatches: SuggestionBatch[]
  chat: ChatMessage[]
}) {
  return {
    version: 1,
    startedAt: args.startedAt,
    exportedAt: new Date().toISOString(),
    transcript: args.transcript,
    suggestionBatches: args.suggestionBatches,
    chat: args.chat,
  }
}

