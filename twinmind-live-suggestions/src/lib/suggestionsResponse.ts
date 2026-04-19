import { z } from 'zod'

const SUGGESTION_TYPES = ['question', 'talking_point', 'answer', 'fact_check', 'clarify'] as const

const suggestionTypeSchema = z.preprocess((v) => {
  let s = String(v ?? '')
    .toLowerCase()
    .trim()
    .replace(/-/g, '_')
    .replace(/\s+/g, '_')
  if (s === 'factcheck') s = 'fact_check'
  if (s === 'talkingpoint') s = 'talking_point'
  if (!(SUGGESTION_TYPES as readonly string[]).includes(s)) s = 'clarify'
  return s
}, z.enum(SUGGESTION_TYPES))

const rawItemSchema = z
  .object({
    id: z.string().min(1),
    type: suggestionTypeSchema,
    title: z.string().min(1),
    preview: z.string().min(1),
    expand_prompt: z.string().optional(),
    expandPrompt: z.string().optional(),
  })
  .transform((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    preview: row.preview,
    expand_prompt: (row.expand_prompt ?? row.expandPrompt ?? '').trim(),
  }))
  .refine((row) => row.expand_prompt.length > 0, { message: 'expand_prompt / expandPrompt required' })

export const SuggestionsResponseSchema = z.object({
  suggestions: z.array(rawItemSchema).length(3),
})

export type ParsedSuggestions = z.infer<typeof SuggestionsResponseSchema>

/** Strip markdown fences and isolate a single JSON object for `JSON.parse`. */
export function extractJsonObject(text: string): string {
  let s = text.trim()
  const fence = s.indexOf('```')
  if (fence !== -1) {
    let inner = s.slice(fence + 3).replace(/^(json)?\s*/i, '')
    const close = inner.indexOf('```')
    if (close !== -1) inner = inner.slice(0, close)
    s = inner.trim()
  }

  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) s = s.slice(start, end + 1)
  return s
}

export function parseSuggestionsModelOutput(raw: string): ParsedSuggestions {
  const jsonText = extractJsonObject(raw)
  let parsed: unknown
  try {
    parsed = JSON.parse(jsonText)
  } catch (e) {
    throw new Error(
      `Suggestions JSON parse failed: ${e instanceof Error ? e.message : String(e)}. Snippet: ${jsonText.slice(0, 240)}`,
    )
  }
  const out = SuggestionsResponseSchema.safeParse(parsed)
  if (!out.success) {
    throw new Error(`Suggestions schema mismatch: ${out.error.message}`)
  }
  return out.data
}
