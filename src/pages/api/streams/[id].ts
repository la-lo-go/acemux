import type { APIRoute } from 'astro'
import { getStream, updateStream, deleteStream, toggleFavorite } from '../../../lib/db'
import { parseStreamFields } from '../../../lib/stream-input'
import { notifyThreadfinUpdate } from '../../../lib/server/threadfin'

const JSON_HEADERS = { 'content-type': 'application/json' }

export const GET: APIRoute = ({ params }) => {
  const id = String(params.id || '')
  const stream = getStream(id)
  if (!stream) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  }
  return new Response(JSON.stringify(stream), { headers: JSON_HEADERS })
}

export const PUT: APIRoute = async ({ params, request }) => {
  const id = String(params.id || '')
  if (!getStream(id)) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const parsed = parseStreamFields(body)
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: JSON_HEADERS })
  }

  const stream = updateStream(id, parsed.fields)
  if (!stream) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  }
  notifyThreadfinUpdate()
  return new Response(JSON.stringify(stream), { headers: JSON_HEADERS })
}

export const PATCH: APIRoute = ({ params }) => {
  const id = String(params.id || '')
  const stream = toggleFavorite(id)
  if (!stream) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  }
  return new Response(JSON.stringify(stream), { headers: JSON_HEADERS })
}

export const DELETE: APIRoute = ({ params }) => {
  const id = String(params.id || '')
  if (!getStream(id)) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  }
  deleteStream(id)
  notifyThreadfinUpdate()
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
}
