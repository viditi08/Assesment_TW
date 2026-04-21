import { z } from 'zod'

const SUGGESTION_TYPES = ['question', 'talking_point', 'answer', 'fact_check', 'clarify'] as const

export type ParsedSuggestion = {
  id: string
  type: (typeof SUGGESTION_TYPES)[number]
  title: string
  preview: string
  expand_prompt: string
}

export type ParsedSuggestions = { suggestions: ParsedSuggestion[] }

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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v.trim()
  if (typeof v === 'number' || typeof v === 'boolean') return String(v).trim()
  return ''
}

function pickFirst(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const t = str(obj[k])
    if (t) return t
  }
  return ''
}

/** Pull the suggestions array from common model wrapper shapes. */
function extractSuggestionRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (!isRecord(parsed)) return []
  const direct = parsed.suggestions
  if (Array.isArray(direct)) return direct
  // { "0": {...}, "1": {...}, "2": {...} }
  const numericKeys = Object.keys(parsed).filter((k) => /^\d+$/.test(k))
  if (numericKeys.length >= 3) {
    return numericKeys
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => (parsed as Record<string, unknown>)[k])
  }
  for (const alt of ['cards', 'items', 'results'] as const) {
    const a = parsed[alt]
    if (Array.isArray(a) && a.length > 0) return a
  }
  for (const key of ['data', 'result', 'response', 'output'] as const) {
    const inner = parsed[key]
    if (isRecord(inner) && Array.isArray(inner.suggestions)) return inner.suggestions
  }
  for (const v of Object.values(parsed)) {
    if (!Array.isArray(v) || v.length < 3) continue
    if (!v.every(isRecord)) continue
    const rowOk = (x: Record<string, unknown>) =>
      Boolean(
        pickFirst(x, ['preview', 'body', 'text', 'content', 'summary', 'value', 'message']) ||
          pickFirst(x, ['title', 'label', 'headline', 'question']),
      )
    if (v.every((x) => rowOk(x as Record<string, unknown>))) return v
  }
  return []
}

function defaultExpandPrompt(title: string, preview: string): string {
  const head = title.trim() || preview.slice(0, 120)
  return `Give a detailed, transcript-grounded answer. Focus on: ${head}. Expand the preview with bullets and concrete next steps; if the transcript is thin, end with 1–2 targeted questions.`
}

/**
 * Normalize one model row into a card. Accepts common key aliases and fills
 * `expand_prompt` / `id` when the model omits them (a frequent cause of
 * "fewer than 3 valid cards" with strict JSON mode).
 */
function unwrapSuggestionRecord(row: unknown): unknown {
  if (!isRecord(row)) return row
  const inner = row.suggestion ?? row.item ?? row.card
  if (isRecord(inner)) return inner
  return row
}

function parseSuggestionRow(row: unknown, index: number): ParsedSuggestion | null {
  row = unwrapSuggestionRecord(row)
  if (!isRecord(row)) return null

  const idRaw = pickFirst(row, ['id', 'uuid', 'key', 'suggestion_id', 'suggestionId'])
  const id = idRaw || `suggestion-${index + 1}`

  const typeParsed = suggestionTypeSchema.safeParse(row.type)
  const type = typeParsed.success ? typeParsed.data : 'clarify'

  let title = pickFirst(row, ['title', 'label', 'heading', 'name', 'topic', 'headline', 'question', 'prompt'])
  let preview = pickFirst(row, [
    'preview',
    'summary',
    'body',
    'text',
    'content',
    'description',
    'message',
    'value',
    'detail',
  ])
  let expand_prompt = pickFirst(row, [
    'expand_prompt',
    'expandPrompt',
    'expand',
    'instruction',
    'instructions',
    'detail',
    'follow_up',
    'followUp',
  ])

  if (!preview && title) preview = title
  if (!title && preview) {
    const first = preview.split(/[.!?\n]/)[0]?.trim() ?? ''
    title = (first.length > 0 ? first : preview).slice(0, 72)
  }
  if (!title) title = 'Suggestion'
  if (!preview) return null

  if (!expand_prompt) expand_prompt = defaultExpandPrompt(title, preview)

  return { id, type, title, preview, expand_prompt }
}

/** First top-level `{ ... }` slice with string-aware brace matching (avoids truncating on `}` inside strings). */
function sliceBalancedJsonObject(s: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (ch === '\\') {
        esc = true
        continue
      }
      if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') {
      inStr = true
      continue
    }
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

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
  if (start < 0) return s
  const balanced = sliceBalancedJsonObject(s, start)
  if (balanced) return balanced
  const end = s.lastIndexOf('}')
  if (end > start) return s.slice(start, end + 1)
  return s
}

/**
 * Parse model JSON: keep up to **3** well-formed items (models often return 4+ or 1–2).
 * Returns exactly 3 when possible; throws if fewer than 3 valid cards (caller may retry).
 */
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

  const rows = extractSuggestionRows(parsed)
  const items: ParsedSuggestion[] = []
  for (let i = 0; i < rows.length; i++) {
    const card = parseSuggestionRow(rows[i], i)
    if (card) items.push(card)
  }

  if (items.length < 3) {
    throw new Error(
      `Suggestions need 3 valid cards; only ${items.length} passed validation (need type + title/preview; expand_prompt is optional and can be filled in).`,
    )
  }

  return { suggestions: items.slice(0, 3) }
}
