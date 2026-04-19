# TwinMind — Live Suggestions (Groq)

A small web app that:
- records live mic audio in ~30s chunks
- transcribes with **Groq Whisper Large v3**
- generates **exactly 3** live suggestions every ~30s with **Groq GPT-OSS 120B**
- opens a detailed answer in the right-side chat when you click a suggestion
- supports free-form chat questions
- exports the full session (transcript + suggestion batches + chat) with timestamps

## Stack
- Vite + React + TypeScript (client-only)
- Groq OpenAI-compatible endpoints (browser fetch)

## Why client-only?
The user pastes their **own Groq API key**. This app stores it in `localStorage` and calls Groq directly from the browser. There is no persistence and no server-side key storage.

## Setup

```bash
cd twinmind-live-suggestions
npm install
npm run dev
```

Then open the app, click **Settings**, paste your Groq API key, and start the mic.

## Prompts & prompt strategy
All prompts and key parameters are editable in **Settings**:
- **Live suggestions prompt**: optimized to produce *3 distinct* suggestion types with previews that are valuable on their own.
- **Expanded answer prompt**: used when clicking a suggestion; it receives the suggestion’s `expand_prompt` + a larger transcript window.
- **Chat prompt**: general Q&A with transcript context.

The default strategy is:
- keep the *suggestions context window* relatively small for latency (defaults to chars, not tokens)
- force strict JSON for suggestions and validate it before rendering
- keep suggestions **varied by type** (question / talking point / answer / fact-check / clarify)

## Models
- Transcription: `whisper-large-v3`
- Suggestions + chat: configurable in **Settings → Chat model** (default `llama-3.3-70b-versatile` from Groq’s model list). For evals that require GPT-OSS 120B, set `openai/gpt-oss-120b` there (full id, not `gpt-oss-120b`).

## Export format
The **Export** button downloads a JSON file:
- `transcript[]`: chunked transcript with `[startedAt, endedAt]`
- `suggestionBatches[]`: newest-first batches, each with 3 cards
- `chat[]`: continuous chat history for the session

## Deploy
Any static host works (Netlify / Vercel / Cloudflare Pages):
- build command: `npm run build`
- output directory: `dist`

## Notes / tradeoffs
- Chunking uses `MediaRecorder.start(timeslice)` for simple 30s batches. The refresh button also flushes the recorder (`requestData()`) before suggestions.
- Suggestion generation uses streaming responses but buffers the full text for JSON parsing (simple + robust).

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
