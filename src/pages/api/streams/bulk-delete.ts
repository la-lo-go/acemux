import type { APIRoute } from 'astro'
import { deleteStream, getStream } from '../../../lib/db'
import { notifyThreadfinUpdate } from '../../../lib/server/threadfin'

const JSON_HEADERS = { 'content-type': 'application/json' }

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null
  const ids = body?.ids
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) {
    return new Response(JSON.stringify({ error: 'ids must be an array of strings' }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  let deleted = 0
  for (const id of ids as string[]) {
    if (!getStream(id)) continue
    deleteStream(id)
    deleted++
  }

  if (deleted > 0) notifyThreadfinUpdate()

  return new Response(JSON.stringify({ deleted }), { headers: JSON_HEADERS })
}
