import type { APIRoute } from 'astro'

export const ALL: APIRoute = async ({ request, params }) => {
  const base = (process.env.ACESTREAM_BASE || 'http://acestream:6878').replace(/\/+$/, '')
  const url = new URL(request.url)
  const rest = String(params.path || '')
  const target = `${base}/ace/${rest}${url.search}`

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body: ['GET','HEAD'].includes(request.method) ? undefined : (request as any).body
  }

  try {
    const res = await fetch(target, init)
    return new Response(res.body, { status: res.status, headers: res.headers })
  } catch (error) {
    console.error('AceStream proxy error:', error)
    console.error('Target URL:', target)
    console.error('AceStream base:', base)
    
    return new Response(
      JSON.stringify({ 
        error: 'AceStream server not accessible',
        target,
        base,
        details: error instanceof Error ? error.message : String(error)
      }), 
      { 
        status: 502,
        headers: { 'content-type': 'application/json' }
      }
    )
  }
}
