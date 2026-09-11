import type { APIRoute } from 'astro'
import { countStreams } from '../lib/db'
import { engineBase } from '../lib/server/http'
import { getStreamManager } from '../lib/server/stream-manager'

async function engineReachable(base: string): Promise<boolean> {
  try {
    await fetch(`${base}/server/api?api_version=3&method=get_version`, {
      signal: AbortSignal.timeout(2000),
    })
    return true
  } catch {
    return false
  }
}

export const GET: APIRoute = async () => {
  const manager = getStreamManager()
  const engine = engineBase()
  return new Response(
    JSON.stringify({
      ok: true,
      streams: countStreams(),
      engine,
      engineReachable: await engineReachable(engine),
      activeStreams: manager.activeStreams(),
      sessions: manager.list(),
    }),
    { headers: { 'content-type': 'application/json' } }
  )
}
