import type { APIRoute } from 'astro'
import { getOrCreateDeviceId } from '../lib/db'
import { buildDiscover, tunerCountFromEnv } from '../lib/hdhr'
import { publicBase } from '../lib/server/http'

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
}

export const GET: APIRoute = ({ request }) => {
  const body = buildDiscover({
    baseUrl: publicBase(request),
    deviceId: getOrCreateDeviceId(),
    tunerCount: tunerCountFromEnv(),
  })
  return new Response(body, { headers: JSON_HEADERS })
}
