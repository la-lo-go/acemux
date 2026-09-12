import type { APIRoute } from 'astro'
import { getAllStreams } from '../lib/db'
import { buildLineup, isChannelNumber } from '../lib/hdhr'
import { apiToken, publicBase } from '../lib/server/http'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

export const GET: APIRoute = ({ request }) => {
  const streams = getAllStreams(true)
    .filter((stream) => isChannelNumber(stream.number))
    .map((stream) => ({
      id: stream.id,
      name: stream.name,
      tvg_name: stream.tvg_name ?? null,
      number: stream.number as number,
    }))

  const body = buildLineup(streams, {
    baseUrl: publicBase(request),
    token: apiToken(),
  })
  return new Response(body, { headers: JSON_HEADERS })
}
