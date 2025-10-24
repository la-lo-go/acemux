import type { APIRoute } from 'astro'
import { getStream, updateStream, deleteStream } from '../../../lib/db'

export const GET: APIRoute = ({ params }) => {
  const id = String(params.id || '')
  const s = getStream(id)
  if (!s) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  return new Response(JSON.stringify(s), { headers: { 'content-type': 'application/json' } })
}

export const PUT: APIRoute = async ({ params, request }) => {
  const id = String(params.id || '')
  const body = await request.json().catch(() => ({}))
  const s = updateStream(id, {
    name: body?.name,
    photo_url: body?.photo_url ?? null
  })
  if (!s) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  return new Response(JSON.stringify(s), { headers: { 'content-type': 'application/json' } })
}

export const DELETE: APIRoute = ({ params }) => {
  const id = String(params.id || '')
  const s = getStream(id)
  if (!s) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 })
  deleteStream(id)
  return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
}
