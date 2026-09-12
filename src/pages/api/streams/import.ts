import type { APIRoute } from 'astro'
import { createStream, getStream, updateStream } from '../../../lib/db'
import { parseAceId, parseStreamFields } from '../../../lib/stream-input'

const JSON_HEADERS = { 'content-type': 'application/json' }

function badRequest(error: string): Response {
  return new Response(JSON.stringify({ error }), { status: 400, headers: JSON_HEADERS })
}

function extractItems(body: unknown): unknown[] | null {
  if (Array.isArray(body)) return body
  if (typeof body === 'object' && body !== null) {
    const streams = (body as Record<string, unknown>).streams
    if (Array.isArray(streams)) return streams
  }
  return null
}

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null)
  const items = extractItems(body)
  if (!items) {
    return badRequest('body must be an array of streams or { streams: [...] }')
  }

  let imported = 0
  let updated = 0
  let skipped = 0

  for (const item of items) {
    if (typeof item !== 'object' || item === null) {
      skipped++
      continue
    }

    const record = item as Record<string, unknown>
    const id = parseAceId(record.id)
    if (!id) {
      skipped++
      continue
    }

    const parsed = parseStreamFields(record)
    if (!parsed.ok) {
      skipped++
      continue
    }

    if (getStream(id)) {
      updateStream(id, parsed.fields)
      updated++
    } else {
      createStream({ id, ...parsed.fields })
      imported++
    }
  }

  return new Response(JSON.stringify({ imported, updated, skipped }), { headers: JSON_HEADERS })
}
