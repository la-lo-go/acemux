import type { APIRoute } from 'astro'
import { parseAceId } from '../../lib/stream-input'
import { resolveMetadata } from '../../lib/server/metadata'

const JSON_HEADERS = { 'content-type': 'application/json' }

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url)
  const id = parseAceId(url.searchParams.get('id'))

  if (!id) {
    return new Response(
      JSON.stringify({ error: 'id must be a valid 40-character AceStream infohash' }),
      { status: 400, headers: JSON_HEADERS }
    )
  }

  try {
    const metadata = await resolveMetadata(id)
    return new Response(JSON.stringify(metadata), { headers: JSON_HEADERS })
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 502, headers: JSON_HEADERS }
    )
  }
}
