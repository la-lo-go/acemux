import type { APIRoute } from 'astro'
import { getOrCreateDeviceId } from '../lib/db'
import { buildDeviceXml } from '../lib/hdhr'
import { publicBase } from '../lib/server/http'

export const GET: APIRoute = ({ request }) =>
  new Response(buildDeviceXml({ baseUrl: publicBase(request), deviceId: getOrCreateDeviceId() }), {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
