import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function forwardToGroq(
  key: string,
  upstreamPath: string,
  req: IncomingMessage,
  res: ServerResponse,
  options: { jsonBody?: string; rawBody?: Buffer; contentType?: string },
) {
  const url = `https://api.groq.com/openai/v1${upstreamPath}`
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key.trim()}`,
  }
  if (options.jsonBody !== undefined) {
    headers['content-type'] = 'application/json'
  } else if (options.contentType) {
    headers['content-type'] = options.contentType
  }

  const upstream = await fetch(url, {
    method: req.method ?? 'GET',
    headers,
    body:
      options.jsonBody !== undefined
        ? options.jsonBody
        : options.rawBody !== undefined
          ? new Uint8Array(options.rawBody)
          : undefined,
  })

  const ct = upstream.headers.get('content-type') ?? 'application/json'
  res.statusCode = upstream.status
  res.setHeader('content-type', ct)
  const buf = Buffer.from(await upstream.arrayBuffer())
  res.end(buf)
}

export function groqDevProxy(groqApiKey: string | undefined): Plugin {
  return {
    name: 'twinmind-groq-dev-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/groq/')) {
          next()
          return
        }

        const key = groqApiKey?.trim()
        if (!key) {
          res.statusCode = 503
          res.setHeader('content-type', 'application/json')
          res.end(
            JSON.stringify({
              error: 'Set GROQ_API_KEY in a root .env file (not VITE_) for local dev, or run with Netlify dev.',
            }),
          )
          return
        }

        try {
          if (url.startsWith('/api/groq/models') && req.method === 'GET') {
            await forwardToGroq(key, '/models', req, res, {})
            return
          }
          if (url.startsWith('/api/groq/chat') && req.method === 'POST') {
            const raw = await readBody(req as IncomingMessage)
            await forwardToGroq(key, '/chat/completions', req, res, { jsonBody: raw.toString('utf8') })
            return
          }
          if (url.startsWith('/api/groq/transcribe') && req.method === 'POST') {
            const raw = await readBody(req as IncomingMessage)
            const ct = req.headers['content-type'] ?? 'application/octet-stream'
            await forwardToGroq(key, '/audio/transcriptions', req, res, { rawBody: raw, contentType: ct })
            return
          }
        } catch (e) {
          res.statusCode = 502
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
          return
        }

        res.statusCode = 404
        res.end()
      })
    },
  }
}
