import type { APIRoute } from 'astro'
import { getAllStreams } from '../lib/db'
import { buildXmltv } from '../lib/xmltv'
import { isAuthorized } from '../lib/server/http'

export const GET: APIRoute = ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const parsedDays = Number.parseInt(process.env.EPG_DAYS ?? '2', 10)
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 2

  const xml = buildXmltv(
    getAllStreams(true).map((stream) => ({
      id: stream.id,
      name: stream.name,
      tvg_id: stream.tvg_id ?? null,
      tvg_name: stream.tvg_name ?? null,
      tvg_logo: stream.photo_url ?? null,
    })),
    { days }
  )

  return new Response(xml, {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
