import { normalizeGroqChatModelId } from '../app/settings'

type ChatMessageParam = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

type ResponseFormat =
  | { type: 'text' }
  | {
      type: 'json_object'
    }

function compactBody(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
}

/** Matches Groq Python SDK: `max_completion_tokens` + optional `reasoning_effort` for GPT-OSS. */
export type GroqReasoningEffort = '' | 'low' | 'medium' | 'high'

function buildGroqChatPayload(args: {
  model: string
  messages: ChatMessageParam[]
  temperature: number
  maxCompletionTokens: number
  stream: boolean
  responseFormat?: ResponseFormat
  reasoningEffort?: GroqReasoningEffort
}): Record<string, unknown> {
  const modelLower = args.model.toLowerCase()
  const effort = (args.reasoningEffort ?? '').trim().toLowerCase()
  const sendReasoning =
    modelLower.includes('gpt-oss') && (effort === 'low' || effort === 'medium' || effort === 'high')

  return compactBody({
    model: args.model,
    messages: args.messages,
    temperature: args.temperature,
    max_completion_tokens: args.maxCompletionTokens,
    stream: args.stream,
    response_format: args.responseFormat,
    reasoning_effort: sendReasoning ? effort : undefined,
  })
}

function formatGroqChatError(status: number, raw: string, model?: string): string {
  let detail = raw.slice(0, 2000)
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } }
    if (j.error?.message) detail = j.error.message
  } catch {
    // keep raw snippet
  }
  if (status === 404) {
    return `Groq 404 for model "${model ?? '?'}": ${detail}. This usually means the model id is wrong or your key cannot access it yet. Open https://console.groq.com/docs/models or use Settings → List models, then paste an exact id (e.g. llama-3.3-70b-versatile or openai/gpt-oss-120b).`
  }
  if (status === 429) {
    return `Groq 429 (rate limited): ${detail}. Wait a bit, reduce how often suggestions refresh in Settings, or upgrade limits at https://console.groq.com/`
  }
  return `Groq chat error (${status}): ${detail}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function backoffMsAfter429(attemptIndex: number, retryAfterHeader: string | null): number {
  const sec = parseInt(retryAfterHeader ?? '', 10)
  if (Number.isFinite(sec) && sec > 0) return Math.min(120_000, sec * 1000)
  return Math.min(32_000, 1500 * 2 ** (attemptIndex - 1))
}

/** List model ids your key can use (GET /openai/v1/models). */
export async function groqListModelIds(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const raw = await safeReadText(res)
  if (!res.ok) {
    throw new Error(formatGroqChatError(res.status, raw))
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Groq models: invalid JSON: ${raw.slice(0, 400)}`)
  }
  const data = json as { data?: Array<{ id?: string }> }
  const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id))
  return [...new Set(ids)].sort()
}

function parseNonStreamChatCompletion(raw: string): string {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    throw new Error(`Groq chat: invalid JSON body: ${raw.slice(0, 500)}`)
  }

  const obj = json as {
    choices?: Array<{ message?: { content?: unknown; refusal?: string | null } }>
    error?: { message?: string }
  }

  if (obj.error?.message) {
    throw new Error(`Groq chat: ${obj.error.message}`)
  }

  const msg = obj.choices?.[0]?.message
  const text = messageContentToPlainText(msg?.content)
  if (text.length > 0) return text
  if (typeof msg?.refusal === 'string' && msg.refusal.length > 0) {
    throw new Error(`Model refused: ${msg.refusal}`)
  }
  return ''
}

/** Non-streaming completion — best for strict JSON (live suggestions). Retries on HTTP 429. */
export async function groqChatCompletion(args: {
  apiKey: string
  model: string
  messages: ChatMessageParam[]
  temperature: number
  maxTokens: number
  responseFormat?: ResponseFormat
  reasoningEffort?: GroqReasoningEffort
}): Promise<string> {
  const model = normalizeGroqChatModelId(args.model)
  const body = buildGroqChatPayload({
    model,
    messages: args.messages,
    temperature: args.temperature,
    maxCompletionTokens: args.maxTokens,
    stream: false,
    responseFormat: args.responseFormat,
    reasoningEffort: args.reasoningEffort,
  })
  const bodyStr = JSON.stringify(body)

  const maxAttempts = 5
  let lastStatus = 0
  let lastRaw = ''

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: bodyStr,
    })

    lastRaw = await res.text()
    lastStatus = res.status

    if (res.status === 429 && attempt < maxAttempts) {
      await sleep(backoffMsAfter429(attempt, res.headers.get('retry-after')))
      continue
    }

    if (!res.ok) {
      throw new Error(formatGroqChatError(res.status, lastRaw, model))
    }

    return parseNonStreamChatCompletion(lastRaw)
  }

  throw new Error(formatGroqChatError(lastStatus, lastRaw, model))
}

/**
 * Suggestions call: prefer JSON object mode; if the API rejects it for this model, retry without `response_format`.
 * Does not swallow real model/404 errors.
 */
export async function groqChatCompletionSuggestionsJson(args: {
  apiKey: string
  model: string
  messages: ChatMessageParam[]
  temperature: number
  maxTokens: number
  reasoningEffort?: GroqReasoningEffort
}): Promise<string> {
  try {
    return await groqChatCompletion({ ...args, responseFormat: { type: 'json_object' } })
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e)
    if (/404|does not exist|not have access/i.test(m)) throw e
    // Second request would worsen 429 bursts; JSON retry is only for non-rate-limit API errors.
    if (/429|rate limit|too many requests/i.test(m)) throw e
    return await groqChatCompletion({ ...args, responseFormat: undefined })
  }
}

export async function groqTranscribe(args: {
  apiKey: string
  audioBlob: Blob
  model: 'whisper-large-v3'
  language?: string
  prompt?: string
}): Promise<string> {
  const buildFormData = () => {
    const fd = new FormData()
    fd.append('file', args.audioBlob, 'audio.webm')
    fd.append('model', args.model)
    if (args.language) fd.append('language', args.language)
    if (args.prompt) fd.append('prompt', args.prompt)
    return fd
  }

  // Whisper endpoint is OpenAI-compatible on Groq.
  const maxAttempts = 4
  let lastStatus = 0
  let lastText = ''
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: buildFormData(),
    })

    if (res.status === 429 && attempt < maxAttempts) {
      await res.text()
      await sleep(backoffMsAfter429(attempt, res.headers.get('retry-after')))
      continue
    }

    if (!res.ok) {
      lastText = await safeReadText(res)
      lastStatus = res.status
      throw new Error(`Groq transcription error (${res.status}): ${lastText}`)
    }

    const json = (await res.json()) as { text?: string }
    return json.text ?? ''
  }

  throw new Error(`Groq transcription error (${lastStatus}): ${lastText}`)
}

export function groqCreateChatCompletionStream(args: {
  apiKey: string
  model: string
  messages: ChatMessageParam[]
  temperature: number
  maxTokens: number
  responseFormat?: ResponseFormat
  reasoningEffort?: GroqReasoningEffort
}) {
  const streamText = async (onDelta: (delta: string) => void) => {
    const model = normalizeGroqChatModelId(args.model)
    const bodyStr = JSON.stringify(
      buildGroqChatPayload({
        model,
        messages: args.messages,
        temperature: args.temperature,
        maxCompletionTokens: args.maxTokens,
        stream: true,
        responseFormat: args.responseFormat,
        reasoningEffort: args.reasoningEffort,
      }),
    )

    const maxAttempts = 5
    let res: Response | undefined
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${args.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: bodyStr,
      })
      if (r.status === 429 && attempt < maxAttempts) {
        await r.text()
        await sleep(backoffMsAfter429(attempt, r.headers.get('retry-after')))
        continue
      }
      res = r
      break
    }

    if (!res) throw new Error('Groq stream: no response')
    if (!res.ok) {
      const text = await safeReadText(res)
      throw new Error(formatGroqChatError(res.status, text, model))
    }
    if (!res.body) throw new Error('No response body.')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE format: lines like "data: {json}\n\n"
      while (true) {
        const idx = buffer.indexOf('\n')
        if (idx === -1) break
        const line = buffer.slice(0, idx).trimEnd()
        buffer = buffer.slice(idx + 1)

        if (!line.startsWith('data:')) continue
        const data = line.slice('data:'.length).trim()
        if (!data) continue
        if (data === '[DONE]') {
          return full
        }

        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: unknown }>
          }
          const piece = textFromStreamDelta(parsed.choices?.[0]?.delta, 'content_only')
          if (piece) {
            full += piece
            onDelta(piece)
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    }

    return full
  }

  const toText = async () => {
    let out = ''
    await streamText((d) => {
      out += d
    })
    return out
  }

  return { streamText, toText }
}

async function safeReadText(res: Response) {
  try {
    return await res.text()
  } catch {
    return ''
  }
}

/**
 * Groq / OpenAI-compatible streaming deltas (multipart `content`, optional `reasoning`).
 * Chat uses `content_only` so internal reasoning is not shown in the panel.
 */
function textFromStreamDelta(delta: unknown, mode: 'content_only' | 'all'): string {
  if (delta == null || typeof delta !== 'object') return ''
  const d = delta as Record<string, unknown>

  const parts: string[] = []

  const content = d.content
  if (typeof content === 'string' && content.length) parts.push(content)
  else if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (typeof b.text === 'string') parts.push(b.text)
      else if (typeof b.content === 'string') parts.push(b.content)
    }
  }

  if (mode === 'all') {
    const reasoning = d.reasoning
    if (typeof reasoning === 'string' && reasoning.length) parts.push(reasoning)
  }

  return parts.join('')
}

function messageContentToPlainText(content: unknown): string {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const out: string[] = []
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown>
      if (typeof b.text === 'string') out.push(b.text)
      else if (typeof b.content === 'string') out.push(b.content)
    }
    return out.join('')
  }
  return ''
}

