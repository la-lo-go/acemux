import type { APIRoute } from 'astro'
import { buildLineupStatus } from '../lib/hdhr'

export const GET: APIRoute = () =>
  new Response(buildLineupStatus(), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
