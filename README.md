# TwinMind — Live Suggestions (Groq)

A small web app that:
- records live mic audio in ~30s chunks
- transcribes with **Groq Whisper Large v3**
- generates **exactly 3** live suggestions on a timer (default **~30s**, configurable in Settings) with **Groq GPT-OSS 120B** (fixed model)
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
- Transcription: `whisper-large-v3` (Groq)
- Suggestions + expanded answers + chat: **`openai/gpt-oss-120b`** only (same Groq model for all; not user-configurable).

## Export format
The **Export** button downloads a JSON file:
- `transcript[]`: chunked transcript with `[startedAt, endedAt]`
- `suggestionBatches[]`: newest-first batches, each with 3 cards
- `chat[]`: continuous chat history for the session

## Deploy (submit a public URL)

This is a static **Vite** app. Set the project **root** to `twinmind-live-suggestions` if your repo contains other folders.

### Netlify
1. **New site from Git** → pick the repo.
2. **Base directory**: `twinmind-live-suggestions`.
3. Build: `npm run build`, Publish: `dist` (see `netlify.toml`).
4. Deploy — use the `*.netlify.app` URL (or your custom domain).

### Cloudflare Pages / Replit / etc.
Same idea: install deps, `npm run build`, serve the `dist` folder as static files.

## Notes / tradeoffs
- Mic segments use **stop/restart `MediaRecorder`** each `transcriptionChunkMs` so each blob is a valid file for Groq Whisper (Chrome-friendly). **Refresh** ends the current segment early (`stop`) then runs suggestions.
- Suggestions use non-streaming JSON + validation; chat / expanded answers use streaming where applicable.

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
