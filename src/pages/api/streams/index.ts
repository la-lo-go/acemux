import type { APIRoute } from 'astro'
import { getAllStreams, createStream, getStream } from '../../../lib/db'
import { parseAceId, parseStreamFields } from '../../../lib/stream-input'

const JSON_HEADERS = { 'content-type': 'application/json' }

export const GET: APIRoute = () =>
  new Response(JSON.stringify(getAllStreams()), { headers: JSON_HEADERS })

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

  const id = parseAceId(body.id)
  if (!id) {
    return new Response(
      JSON.stringify({ error: 'id must be a valid 40-character AceStream infohash' }),
      { status: 400, headers: JSON_HEADERS }
    )
  }

  const parsed = parseStreamFields(body)
  if (!parsed.ok) {
    return new Response(JSON.stringify({ error: parsed.error }), { status: 400, headers: JSON_HEADERS })
  }

  if (getStream(id)) {
    return new Response(JSON.stringify({ error: 'id already exists' }), {
      status: 409,
      headers: JSON_HEADERS,
    })
  }

  const stream = createStream({ id, ...parsed.fields })
  return new Response(JSON.stringify(stream), { status: 201, headers: JSON_HEADERS })
}
