/** Assignment default: GPT-OSS 120B on Groq (`openai/gpt-oss-120b`). Override in Settings if needed. */
export const DEFAULT_GROQ_CHAT_MODEL = 'openai/gpt-oss-120b' as const

/**
 * Groq model ids are usually `vendor/model`. Short ids like `gpt-oss-120b` return model_not_found.
 */
export function normalizeGroqChatModelId(raw: string): string {
  const t = raw.trim().toLowerCase()
  if (!t) return DEFAULT_GROQ_CHAT_MODEL
  if (t === 'gpt-oss-120b' || t === 'gpt_oss_120b') return 'openai/gpt-oss-120b'
  if (t.startsWith('gpt-oss-') && !t.includes('/')) return `openai/${t}`
  return t
}

export type AppSettings = {
  groqApiKey: string
  /** Groq chat model id — default `openai/gpt-oss-120b` for suggestions + chat (same model). */
  groqChatModel: string
  /**
   * For `openai/gpt-oss-*` on Groq only — maps to API `reasoning_effort` (`low` | `medium` | `high`).
   * Empty = omit parameter (e.g. when using Llama).
   */
  groqReasoningEffort: '' | 'low' | 'medium' | 'high'

  transcriptionChunkMs: number
  transcriptionLanguage: string
  transcriptionPrompt: string

  autoRefreshEnabled: boolean
  autoRefreshMs: number

  suggestionsContextChars: number
  expandedContextChars: number
  chatContextChars: number

  suggestionsPrompt: string
  expandedPrompt: string
  chatPrompt: string

  suggestionsTemperature: number
  suggestionsMaxTokens: number

  expandedTemperature: number
  expandedMaxTokens: number

  chatTemperature: number
  chatMaxTokens: number
}

export function buildDefaultSettings(): AppSettings {
  return {
    groqApiKey: '',
    groqChatModel: DEFAULT_GROQ_CHAT_MODEL,
    groqReasoningEffort: 'medium',

    transcriptionChunkMs: 30_000,
    transcriptionLanguage: '',
    transcriptionPrompt: '',

    autoRefreshEnabled: true,
    // Slower default reduces overlap with transcript-triggered refreshes + Groq TPD on large models.
    autoRefreshMs: 60_000,

    // Keep this modest for latency. The prompt itself teaches the model to be specific.
    suggestionsContextChars: 8_000,
    expandedContextChars: 18_000,
    chatContextChars: 18_000,

    suggestionsPrompt: defaultSuggestionsPrompt,
    expandedPrompt: defaultExpandedPrompt,
    chatPrompt: defaultChatPrompt,

    suggestionsTemperature: 0.4,
    suggestionsMaxTokens: 600,

    expandedTemperature: 0.2,
    expandedMaxTokens: 900,

    chatTemperature: 0.3,
    chatMaxTokens: 900,
  }
}

const defaultSuggestionsPrompt = `You are an assistant that watches a live conversation transcript and produces exactly 3 high-value, context-aware suggestions.

The user sees ONLY the preview lines unless they click — so previews must be immediately useful, concrete, and actionable.

Requirements:
- Output MUST be valid JSON and match the provided schema.
- Return ONLY the raw JSON object (no markdown fences, no prose before or after).
- Produce EXACTLY 3 suggestions. Each suggestion must be meaningfully different in type and utility.
- Each suggestion should be grounded in the recent transcript: quote or reference specific phrases (briefly) when helpful.
- Optimize for meeting usefulness: clarify ambiguity, propose a follow-up question, summarize an emerging decision, propose a next step, answer a question just asked, or fact-check a risky claim.
- Avoid generic fluff. No "consider discussing X" unless you make it specific to what was said.

Suggestion type guidance (mix them across the 3):
- question: a crisp question to ask next (to resolve ambiguity / de-risk a decision).
- talking_point: a short talking point to say next (with phrasing the user can read out loud).
- answer: if someone asked a question, give a concise answer aligned with the transcript context.
- fact_check: if a statement seems risky/uncertain, suggest how to verify and what the likely truth is (be honest about uncertainty).
- clarify: explain a concept or translate jargon that appeared, tailored to this context.

Return schema:
{
  "suggestions": [
    {
      "id": "stable-short-id",
      "type": "question|talking_point|answer|fact_check|clarify",
      "title": "short title (<= 60 chars)",
      "preview": "2-4 sentences. Already valuable alone.",
      "expand_prompt": "A short instruction for the detailed answer, specific to THIS suggestion."
    }
  ]
}`

const defaultExpandedPrompt = `You are a helpful assistant. The user clicked a suggestion and wants a detailed, practical response.

Rules:
- Use the transcript context. Be specific and relevant to what was said.
- If the transcript is insufficient, ask 1-2 targeted questions at the end.
- Prefer: short structure, bullets, and concrete next steps.
- No filler. No long preambles.
`

export function mergeStoredAppSettings(parsed: unknown, initial: AppSettings): AppSettings {
  if (!parsed || typeof parsed !== 'object') return initial
  const merged: AppSettings = { ...initial, ...(parsed as Partial<AppSettings>) }
  const rawModel = merged.groqChatModel?.trim() || initial.groqChatModel
  merged.groqChatModel = normalizeGroqChatModelId(rawModel)
  const allowedEffort = new Set<AppSettings['groqReasoningEffort']>(['', 'low', 'medium', 'high'])
  const e = merged.groqReasoningEffort
  merged.groqReasoningEffort = allowedEffort.has(e) ? e : initial.groqReasoningEffort

  const clampCtx = (v: unknown, fallback: number) => {
    const n = Math.floor(Number(v))
    if (!Number.isFinite(n) || n <= 0) return fallback
    return Math.min(n, 500_000)
  }
  merged.suggestionsContextChars = clampCtx(merged.suggestionsContextChars, initial.suggestionsContextChars)
  merged.expandedContextChars = clampCtx(merged.expandedContextChars, initial.expandedContextChars)
  merged.chatContextChars = clampCtx(merged.chatContextChars, initial.chatContextChars)

  return merged
}

const defaultChatPrompt = `You are a meeting copilot. Answer the user's question with full transcript context.

Rules:
- Be concise but complete (aim for 6-12 bullet lines unless the question needs more).
- If needed, propose 2-3 follow-up questions.
- If the user asks for a message they can say, provide a ready-to-speak version.
`

