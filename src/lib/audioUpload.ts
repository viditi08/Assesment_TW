/**
 * Groq Whisper accepts: flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm.
 * MediaRecorder often sets `blob.type` incorrectly or empty (Safari); use `mimeTypeHint` from `MediaRecorder.mimeType` when needed.
 *
 * `requestData()` / partial WebM segments may not start with a Matroska EBML header — Groq returns 400 "valid media file?".
 * We sniff magic bytes and skip those blobs (caller treats as empty transcript).
 */

const HEAD_READ = 64

function hasFtypBox(buf: Uint8Array): boolean {
  for (let i = 0; i <= buf.length - 4; i++) {
    if (buf[i] === 0x66 && buf[i + 1] === 0x74 && buf[i + 2] === 0x79 && buf[i + 3] === 0x70) return true
  }
  return false
}

async function readHead(blob: Blob, max: number): Promise<Uint8Array> {
  const n = Math.min(blob.size, max)
  if (n <= 0) return new Uint8Array()
  return new Uint8Array(await blob.slice(0, n).arrayBuffer())
}

/** Legacy filename guess when MIME is set but magic is ambiguous. */
export function audioFileForGroqUpload(blob: Blob, mimeTypeHint?: string): File {
  const base = (blob.type || mimeTypeHint || '').split(';')[0].trim().toLowerCase()

  let ext: string
  if (base.includes('webm') || base === 'video/webm') ext = 'webm'
  else if (base === 'audio/mp4' || base === 'audio/x-m4a' || base === 'audio/m4a' || base === 'video/mp4')
    ext = 'm4a'
  else if (base.includes('ogg')) ext = 'ogg'
  else if (base.includes('wav')) ext = 'wav'
  else if (base === 'audio/mpeg' || base.includes('mp3')) ext = 'mp3'
  else if (base.includes('mp4')) ext = 'mp4'
  else ext = 'webm'

  const name = `chunk.${ext}`
  const type = blob.type || mimeTypeHint || `audio/${ext === 'm4a' ? 'mp4' : ext}`
  return new File([blob], name, { type })
}

/**
 * Build a `File` Groq can ingest, or `null` to skip upload (invalid / non-standalone fragment).
 */
export async function prepareAudioFileForGroq(blob: Blob, mimeTypeHint?: string): Promise<File | null> {
  const minBytes = 512
  if (blob.size < minBytes) return null

  const mime = (blob.type || mimeTypeHint || '').split(';')[0].trim().toLowerCase()
  const head = await readHead(blob, HEAD_READ)

  const ebml =
    head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3
  const riff =
    head.length >= 4 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
  const ogg =
    head.length >= 4 && head[0] === 0x4f && head[1] === 0x67 && head[2] === 0x67 && head[3] === 0x53

  const scanLen = Math.min(blob.size, 8192)
  const scanBuf = scanLen > HEAD_READ ? await readHead(blob, scanLen) : head
  const hasFtyp = hasFtypBox(scanBuf)

  if (ebml) {
    return new File([blob], 'chunk.webm', {
      type: blob.type || mimeTypeHint || 'audio/webm',
    })
  }
  if (riff) {
    return new File([blob], 'chunk.wav', {
      type: blob.type || mimeTypeHint || 'audio/wav',
    })
  }
  if (ogg) {
    return new File([blob], 'chunk.ogg', {
      type: blob.type || mimeTypeHint || 'audio/ogg',
    })
  }
  if (hasFtyp) {
    return new File([blob], 'chunk.m4a', {
      type: blob.type || mimeTypeHint || 'audio/mp4',
    })
  }

  // Matroska Cluster at offset 0 = continuation segment (no Segment/EBML) — not a standalone file.
  const cluster =
    head.length >= 4 && head[0] === 0x1f && head[1] === 0x43 && head[2] === 0xb6 && head[3] === 0x75
  if (cluster) {
    return null
  }

  // WebM hint but no EBML at 0 (we already returned if ebml): small = flush scrap; large = try legacy naming.
  if (mime.includes('webm') || mime.includes('matroska')) {
    if (blob.size < 16_384) return null
    return audioFileForGroqUpload(blob, mimeTypeHint)
  }

  // Unknown bytes but MIME says MP4 family (Safari often omits magic at offset 0).
  if (mime.includes('mp4') || mime.includes('m4a') || mime === 'audio/x-m4a') {
    return new File([blob], 'chunk.m4a', {
      type: blob.type || mimeTypeHint || 'audio/mp4',
    })
  }

  // Last resort: same as before (may still 400 on exotic encoders).
  return audioFileForGroqUpload(blob, mimeTypeHint)
}

