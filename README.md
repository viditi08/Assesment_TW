# TwinMind — Live Suggestions Meeting Copilot (Groq)

A 3‑column meeting copilot that listens to your mic, builds a **live transcript**, and continuously surfaces **exactly 3 high‑value, context-aware suggestions** you can act on during a real conversation.

- **Column 1 — Mic + transcript**: start/stop mic, transcript auto-scrolls as chunks arrive.
- **Column 2 — Live suggestions**: every refresh produces **exactly 3** actionable cards; newest batch on top; older context stays visible.
- **Column 3 — Chat**: click a suggestion for a detailed answer (separate prompt) or ask your own question; responses stream for low perceived latency.

## What this demonstrates (interview focus)
- **Prompt engineering**: structured context windows, strict JSON outputs for suggestions, and separate prompts for preview vs. expanded answers.
- **Product judgment**: suggestions are designed to be useful *even if you never click* (previews carry value).
- **Full-stack engineering**: audio chunking strategy, retries/error UX, schema validation, streaming chat, and an exportable session artifact.

## Core features (functional requirements)
- **Mic + transcript**
  - Start/stop mic button.
  - Transcript appends in chunks roughly every **~30 seconds** while recording (steady-state), but the **first line appears faster** (a short warmup segment) so users get feedback quickly.
  - Auto-scrolls to the latest line.
- **Live suggestions**
  - Auto refresh while recording (defaults to **~30 seconds**, aligned to new transcript chunks).
  - Manual **Reload suggestions** flushes the current audio segment, then regenerates suggestions.
  - Each refresh yields **exactly 3** suggestions based on the most recent transcript window.
  - Suggestions are intended to vary by context: **question**, **talking point**, **answer**, **fact-check**, **clarify**.
- **Chat**
  - Clicking a suggestion adds it to chat and returns a detailed, practical answer.
  - Users can also type questions directly.
  - Assistant messages render **Markdown** (lists, code, links); user messages stay plain text.
  - Session-only: no login required.
- **Export**
  - Export the full session (transcript + every suggestion batch + full chat history) as JSON with timestamps.

## Models (fixed for fair comparison)
- **Transcription**: Groq Whisper **`whisper-large-v3`**
- **Suggestions + expanded answers + chat**: Groq **`openai/gpt-oss-120b`**

## Prompt strategy (high-level)
- **Two-tier UX**:
  - **Preview cards**: 2–4 sentences, immediately useful, concrete, actionable.
  - **Expanded answers**: longer-form, structured response with next steps; asks 1–2 targeted questions if context is insufficient.
- **Recency + diversity**:
  - The suggestion prompt highlights the **last few transcript lines** so the model weights what people just said.
  - Server-side validation **retries** if a batch does not use **three distinct suggestion types** or if an `expand_prompt` is too generic (short / does not tie back to the card title).
- **Type-aware expansion**:
  - The expanded-answer prompt adds **type-specific** instructions (e.g. fact-check vs talking point vs question) so the long answer matches the card you clicked.
- **Context windows (chars, not tokens)**:
  - Smaller window for suggestions for lower latency.
  - Larger window for expanded answers and chat for better grounding.
- **Strict JSON for suggestions**:
  - Suggestions are requested in JSON and validated before rendering (robust parsing/retries to handle model variance).

## Architecture notes (technical choices)
- **Audio chunking**: uses *stop/restart* `MediaRecorder` per segment to ensure each blob is a valid media container (Chrome-friendly for Whisper).
- **Suggestions validation**: parse + validate, then render **exactly 3** cards; retries on invalid output (including **distinct types** and **non-generic expand prompts**).
- **Streaming chat**: chat/expanded answers stream to reduce “time to first token”.
- **UX guards**: rapid suggestion clicks do not start overlapping chat streams while a reply is already in flight.

## Export format
The **Export** button downloads JSON:
- `transcript[]`: `{ id, startedAt, endedAt, text }`
- `suggestionBatches[]`: newest-first batches, each with 3 cards + timestamps
- `chat[]`: full chat history for the session

## Run locally

```bash
npm install
npm run dev
```

Open the app, click **Settings**, paste your Groq API key, and start the mic.

## Deploy on Vercel
This repo is a standard **Vite** build.

- **Application Preset**: Vite
- **Build Command**: `npm run build`
- **Output Directory**: `dist`
- **Install Command**: `npm install`

### API key handling
This app expects the **user to paste their own Groq API key** in Settings (stored locally in the browser).

> If you want a server-side proxy (so the key never reaches the browser), the repo includes Vercel API route stubs under `api/groq/*`. Wire the frontend to call `/api/groq/*` and set `GROQ_API_KEY` in Vercel environment variables.

## 🚀 Live Demo
https://your-vercel-link.vercel.app
