import type { APIRoute } from 'astro'
import { getAllStreams, createStream, getStream } from '../../../lib/db'

export const GET: APIRoute = () => new Response(JSON.stringify(getAllStreams()), {
  headers: { 'content-type': 'application/json' }
})

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => ({}))
  const id = String(body?.id ?? '').trim()
  const name = String(body?.name ?? '').trim()
  const photo_url = body?.photo_url ? String(body.photo_url).trim() : null
  if (!id || !name) return new Response(JSON.stringify({ error: 'id and name are required' }), { status: 400 })
  if (getStream(id)) return new Response(JSON.stringify({ error: 'id already exists' }), { status: 409 })
  const s = createStream({ id, name, photo_url })
  return new Response(JSON.stringify(s), { headers: { 'content-type': 'application/json' } })
}
