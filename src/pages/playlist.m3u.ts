import type { APIRoute } from 'astro'
import { getAllStreams } from '../lib/db'
import { buildM3U } from '../lib/m3u'
import { apiToken, isAuthorized, publicBase } from '../lib/server/http'

export const GET: APIRoute = ({ request }) => {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const playlist = buildM3U(
    getAllStreams(true).map((stream) => ({
      id: stream.id,
      name: stream.name,
      tvg_id: stream.tvg_id ?? null,
      tvg_name: stream.tvg_name ?? null,
      tvg_logo: stream.photo_url ?? null,
      group_title: stream.group_title ?? null,
      number: stream.number ?? null,
    })),
    publicBase(request),
    apiToken()
  )
  return new Response(playlist, {
    status: 200,
    headers: {
      'content-type': 'audio/x-mpegurl; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
