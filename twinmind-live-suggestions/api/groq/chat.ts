import type { VercelRequest, VercelResponse } from '@vercel/node'

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true,
  },
}

async function readRaw(req: VercelRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed')
    return
  }

  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) {
    res.status(503).json({ error: 'GROQ_API_KEY is not set in server environment variables.' })
    return
  }

  const body = await readRaw(req)
  const upstream = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'content-type': req.headers['content-type'] ?? 'application/json',
    },
    body,
  })

  res.status(upstream.status)
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')

  // Stream through if possible (SSE for chat streaming).
  const upstreamBody = upstream.body
  if (upstreamBody) {
    // @vercel/node supports Node streams on res.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const readable = upstreamBody as any
    if (typeof readable.pipe === 'function') {
      readable.pipe(res)
      return
    }
  }

  res.send(await upstream.text())
}

