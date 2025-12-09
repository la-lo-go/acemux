import type { APIRoute } from 'astro'

export const ALL: APIRoute = async ({ request, params }) => {
  const base = (process.env.ACESTREAM_BASE || 'http://acestream:6878').replace(/\/+$/, '')
  const url = new URL(request.url)
  const rest = String(params.path || '')
  const target = `${base}/ace/${rest}${url.search}`

  //console.log('[AceStream Proxy] Request:', request.method, rest, url.search)
  //console.log('[AceStream Proxy] Target:', target)

  const init: RequestInit = {
    method: request.method,
    headers: {
      'Accept': request.headers.get('Accept') || '*/*',
      'User-Agent': request.headers.get('User-Agent') || 'AceMux/1.0',
    },
    body: ['GET','HEAD'].includes(request.method) ? undefined : (request as any).body
  }

  try {
    const res = await fetch(target, init)
    
    // Get the content type to determine if we need to rewrite URLs
    const contentType = res.headers.get('content-type') || ''
    
    // For JSON responses, rewrite internal AceStream URLs to use our proxy
    if (contentType.includes('application/json')) {
      const text = await res.text()
      // Replace internal AceStream URLs with our proxy URLs
      // AceStream returns URLs like http://127.0.0.1:6878/ace/... or http://<internal-ip>:6878/ace/...
      const rewritten = text.replace(
        /http:\/\/[^\/]+:6878\/ace\//g, 
        '/ace/'
      )
      return new Response(rewritten, { 
        status: res.status, 
        headers: {
          'content-type': 'application/json',
          'access-control-allow-origin': '*',
        }
      })
    }
    
    // For m3u8 playlists, also rewrite URLs
    if (contentType.includes('mpegurl') || rest.endsWith('.m3u8')) {
      const text = await res.text()
      const rewritten = text.replace(
        /http:\/\/[^\/]+:6878\/ace\//g, 
        '/ace/'
      )
      return new Response(rewritten, { 
        status: res.status, 
        headers: {
          'content-type': 'application/vnd.apple.mpegurl',
          'access-control-allow-origin': '*',
        }
      })
    }
    
    // For binary data (video segments), stream directly
    const headers = new Headers()
    res.headers.forEach((value, key) => {
      // Skip hop-by-hop headers
      if (!['connection', 'keep-alive', 'transfer-encoding'].includes(key.toLowerCase())) {
        headers.set(key, value)
      }
    })
    headers.set('access-control-allow-origin', '*')
    
    return new Response(res.body, { status: res.status, headers })
  } catch (error) {
    console.error('[AceStream Proxy] Error:', error)
    console.error('[AceStream Proxy] Target URL:', target)
    console.error('[AceStream Proxy] Base:', base)
    
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
