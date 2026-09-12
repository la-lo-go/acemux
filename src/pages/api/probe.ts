import type { APIRoute } from 'astro'
import { parseAceId } from '../../lib/stream-input'
import { resolveMetadata } from '../../lib/server/metadata'
import { getStreamManager } from '../../lib/server/stream-manager'
import { SdtProbe } from '../../lib/ts-sdt'

const ACQUIRE_TIMEOUT_MS = 18_000
const READ_TIMEOUT_MS = 15_000
const MAX_BYTES = 1_500_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Reads the first bytes of a stream (without needing it in the library) and
 * reports what the broadcast itself says: DVB SDT service name/provider, with
 * the engine metadata API as a fallback.
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const id = parseAceId(url.searchParams.get('id'))
  if (!id) {
    return json({ ok: false, reason: 'id must be a valid 40-character AceStream infohash' }, 400)
  }

  const manager = getStreamManager()
  const started = Date.now()

  const acquireController = new AbortController()
  const acquireTimeout = setTimeout(() => acquireController.abort(), ACQUIRE_TIMEOUT_MS)

  let acquired
  try {
    acquired = await manager.acquire(id, acquireController.signal)
  } catch (error) {
    clearTimeout(acquireTimeout)
    return json({ ok: false, reason: error instanceof Error ? error.message : String(error) })
  }
  clearTimeout(acquireTimeout)

  if (!acquired.ok) {
    return json({ ok: false, reason: acquired.reason })
  }

  const reader = acquired.stream.getReader()
  const probe = new SdtProbe()
  let bytes = 0
  const killer = setTimeout(() => {
    void reader.cancel().catch(() => {})
  }, READ_TIMEOUT_MS)

  try {
    while (!probe.complete && bytes < MAX_BYTES) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        bytes += value.byteLength
        probe.push(value)
      }
    }
  } catch {
    // stream errored; nothing to detect
  } finally {
    clearTimeout(killer)
    void reader.cancel().catch(() => {})
  }

  let title: string | null = null
  let categories: string[] = []
  if (!probe.result) {
    try {
      const metadata = await resolveMetadata(id, { timeoutMs: 8000 })
      title = metadata.title ?? metadata.name ?? null
      categories = metadata.categories ?? []
    } catch {
      // metadata is best-effort
    }
  }

  const info = probe.result
  return json({
    ok: Boolean(info || title),
    serviceName: info?.serviceName ?? null,
    serviceProvider: info?.serviceProvider ?? null,
    title,
    categories,
    bytes,
    ms: Date.now() - started,
  })
}
