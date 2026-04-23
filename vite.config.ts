import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { groqDevProxy } from './vite/groqDevProxy'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), groqDevProxy(env.GROQ_API_KEY)],
  }
})
