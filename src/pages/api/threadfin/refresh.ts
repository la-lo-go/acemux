import type { APIRoute } from 'astro'
import { notifyThreadfinUpdate } from '../../../lib/server/threadfin'

const JSON_HEADERS = { 'content-type': 'application/json' }

export const POST: APIRoute = () => {
  notifyThreadfinUpdate()
  return new Response(JSON.stringify({ ok: true, at: new Date().toISOString() }), {
    headers: JSON_HEADERS,
  })
}
