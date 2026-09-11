import type { APIRoute } from 'astro'
import { getAllStreams } from '../../../lib/db'

export const GET: APIRoute = () => {
  const payload = {
    version: 1,
    exported_at: new Date().toISOString(),
    streams: getAllStreams(false),
  }
  return new Response(JSON.stringify(payload), {
    headers: {
      'content-type': 'application/json',
      'content-disposition': 'attachment; filename="acemux-streams.json"',
    },
  })
}
