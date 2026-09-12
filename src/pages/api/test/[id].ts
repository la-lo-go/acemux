import type { APIRoute } from 'astro'
import { getStream } from '../../../lib/db'
import { getStreamManager } from '../../../lib/server/stream-manager'
import { SdtProbe } from '../../../lib/ts-sdt'

const ACQUIRE_TIMEOUT_MS = 18_000
const READ_TIMEOUT_MS = 12_000
const MIN_BYTES = 96 * 1024
const MAX_SNIFF_BYTES = 1_500_000
const SNIFF_BUDGET_MS = 4_000

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * Really tests whether a stream works: it joins the shared session (or starts
 * one), waits for the first bytes and reports peers/speed. It does not fight
 * with active playback because it uses the same upstream session manager.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = String(params.id || '')
  const stream = getStream(id)
  if (!stream || stream.enabled !== 1) {
    return json({ ok: false, reason: 'stream not found' }, 404)
  }

  const manager = getStreamManager()
  const started = Date.now()

  const acquireController = new AbortController()
  const acquireTimeout = setTimeout(() => acquireController.abort(), ACQUIRE_TIMEOUT_MS)

  let acquired
  try {
    acquired = await manager.acquire(stream.id, acquireController.signal)
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
  const sniffUntil = Date.now() + SNIFF_BUDGET_MS
  let bytes = 0
  const killer = setTimeout(() => {
    void reader.cancel().catch(() => {})
  }, READ_TIMEOUT_MS)

  try {
    while (
      bytes < MIN_BYTES ||
      (bytes < MAX_SNIFF_BYTES && !probe.complete && Date.now() < sniffUntil)
    ) {
      const { value, done } = await reader.read()
      if (done) break
      if (value) {
        bytes += value.byteLength
        probe.push(value)
      }
    }
  } catch {
    // stream errored; treated as no data
  } finally {
    clearTimeout(killer)
    void reader.cancel().catch(() => {})
  }

  const target = manager.statsTarget(stream.id)
  let peers: number | null = null
  let speedDown: number | null = null
  let status: string | null = null

  if (target?.statUrl) {
    try {
      const res = await fetch(target.statUrl, {
        signal: AbortSignal.timeout(3000),
        headers: { 'user-agent': 'acemux/0.1' },
      })
      if (res.ok) {
        const data = (await res.json()) as { response?: Record<string, unknown> }
        const stats = data.response ?? (data as Record<string, unknown>)
        if (typeof stats.peers === 'number') peers = stats.peers
        if (typeof stats.speed_down === 'number') speedDown = stats.speed_down
        if (typeof stats.status === 'string') status = stats.status
      }
    } catch {
      // stats are best-effort
    }
  }

  const info = probe.result
  return json({
    ok: bytes > 0,
    bytes,
    peers,
    speed_down: speedDown,
    status,
    serviceName: info?.serviceName ?? null,
    serviceProvider: info?.serviceProvider ?? null,
    ms: Date.now() - started,
  })
}
