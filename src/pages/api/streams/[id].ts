import type { APIRoute } from 'astro'
import { getStream, updateStream, deleteStream, toggleFavorite, replaceStreamId } from '../../../lib/db'
import { parseAceId, parseStreamFields } from '../../../lib/stream-input'

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

  let nextId = id
  if (Object.prototype.hasOwnProperty.call(body, 'id')) {
    const candidate = parseAceId(body.id)
    if (!candidate) {
      return new Response(
        JSON.stringify({ error: 'id must be a valid 40-character AceStream infohash' }),
        { status: 400, headers: JSON_HEADERS }
      )
    }
    nextId = candidate
  }

  if (nextId !== id) {
    if (getStream(nextId)) {
      return new Response(JSON.stringify({ error: 'id already exists' }), {
        status: 409,
        headers: JSON_HEADERS,
      })
    }
    if (!replaceStreamId(id, nextId)) {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
    }
    const replaced = updateStream(nextId, parsed.fields)
    return new Response(JSON.stringify(replaced), { headers: JSON_HEADERS })
  }

  const stream = updateStream(id, parsed.fields)
  if (!stream) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: JSON_HEADERS })
  }
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
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS })
}
