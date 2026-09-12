import type { APIRoute } from 'astro'
import { getStream } from '../../lib/db'
import { getStreamManager } from '../../lib/server/stream-manager'
import { isAuthorized } from '../../lib/server/http'

export const GET: APIRoute = async ({ request, params }) => {
  if (!isAuthorized(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const id = String(params.id || '')
  const stream = getStream(id)
  if (!stream || stream.enabled !== 1) {
    return new Response('Stream not found', { status: 404 })
  }

  const result = await getStreamManager().acquire(stream.id, request.signal)

  if (!result.ok) {
    return new Response(result.reason, {
      status: result.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    })
  }

  return new Response(result.stream, {
    status: 200,
    headers: {
      'content-type': result.contentType,
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  })
}

/** Cheap HEAD: validates the stream without acquiring a P2P session. */
export const HEAD: APIRoute = ({ request, params }) => {
  if (!isAuthorized(request)) {
    return new Response(null, { status: 401 })
  }

  const id = String(params.id || '')
  const stream = getStream(id)
  if (!stream || stream.enabled !== 1) {
    return new Response(null, { status: 404 })
  }

  return new Response(null, {
    status: 200,
    headers: {
      'content-type': 'video/mp2t',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*',
    },
  })
}
