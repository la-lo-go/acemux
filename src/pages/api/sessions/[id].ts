import type { APIRoute } from 'astro'
import { getStreamManager } from '../../../lib/server/stream-manager'

const JSON_HEADERS = { 'content-type': 'application/json' }

export const GET: APIRoute = async ({ params }) => {
  const id = String(params.id || '')
  const target = getStreamManager().statsTarget(id)

  if (!target) {
    return new Response(JSON.stringify({ active: false }), { headers: JSON_HEADERS })
  }

  let engine: Record<string, unknown> | null = null
  if (target.statUrl) {
    try {
      const res = await fetch(target.statUrl, { headers: { 'user-agent': 'acemux/0.1' } })
      if (res.ok) {
        const data = (await res.json()) as { response?: Record<string, unknown> }
        engine = data.response ?? (data as Record<string, unknown>)
      }
    } catch {
      // stats are best-effort
    }
  }

  return new Response(
    JSON.stringify({
      active: true,
      clients: target.clients,
      bytes: target.bytes,
      startedAt: target.startedAt,
      peers: engine?.peers ?? null,
      speed_down: engine?.speed_down ?? null,
      speed_up: engine?.speed_up ?? null,
      status: engine?.status ?? null,
    }),
    { headers: JSON_HEADERS }
  )
}
