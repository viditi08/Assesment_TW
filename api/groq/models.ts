import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).send('Method Not Allowed')
    return
  }

  const key = process.env.GROQ_API_KEY?.trim()
  if (!key) {
    res.status(503).json({ error: 'GROQ_API_KEY is not set in server environment variables.' })
    return
  }

  const upstream = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
  })

  const text = await upstream.text()
  res.status(upstream.status)
  res.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/json')
  res.send(text)
}

