import type { APIRoute } from 'astro'

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
])

// Headers worth forwarding to the engine.
const FORWARD_REQUEST_HEADERS = ['accept', 'user-agent', 'range', 'content-type']

const ENGINE_PORT = ':6878'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export const ALL: APIRoute = async ({ request, params }) => {
  const base = (process.env.ACESTREAM_BASE || 'http://acestream:6878').replace(/\/+$/, '')
  const url = new URL(request.url)
  const rest = String(params.path || '')
  const target = `${base}/ace/${rest}${url.search}`

  const headers = new Headers()
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name)
    if (value) headers.set(name, value)
  }
  if (!headers.has('accept')) headers.set('accept', '*/*')
  if (!headers.has('user-agent')) headers.set('user-agent', 'AceMux/1.0')

  const hasBody = !['GET', 'HEAD'].includes(request.method)
  const init = {
    method: request.method,
    headers,
    ...(hasBody ? { body: request.body, duplex: 'half' as const } : {}),
  }

  try {
    const res = await fetch(target, init as RequestInit)

    const responseHeaders = new Headers()
    res.headers.forEach((value, key) => {
      const lower = key.toLowerCase()
      if (HOP_BY_HOP.has(lower) || lower === 'content-length') return
      responseHeaders.set(key, value)
    })
    responseHeaders.set('access-control-allow-origin', '*')

    // Rewrite internal engine URLs that leak into JSON/M3U8 bodies so they go
    // back through this same-origin proxy.
    const patterns = [
      new RegExp(`https?://[^/]+${ENGINE_PORT}/ace/`, 'g'),
      new RegExp(`${escapeRegExp(base)}/ace/`, 'g'),
    ]
    const rewrite = (text: string): string =>
      patterns.reduce((acc, pattern) => acc.replace(pattern, '/ace/'), text)

    const contentType = res.headers.get('content-type') || ''
    const needsRewrite =
      contentType.includes('application/json') ||
      contentType.includes('mpegurl') ||
      rest.endsWith('.m3u8')

    if (needsRewrite) {
      const text = await res.text()
      responseHeaders.set(
        'content-type',
        contentType.includes('application/json')
          ? 'application/json; charset=utf-8'
          : 'application/vnd.apple.mpegurl'
      )
      return new Response(rewrite(text), { status: res.status, headers: responseHeaders })
    }

    return new Response(res.body, { status: res.status, headers: responseHeaders })
  } catch (error) {
    console.error('[AceStream Proxy] Error:', error)
    console.error('[AceStream Proxy] Target URL:', target)

    return new Response(
      JSON.stringify({
        error: 'AceStream server not accessible',
        target,
        base,
        details: error instanceof Error ? error.message : String(error),
      }),
      { status: 502, headers: { 'content-type': 'application/json' } }
    )
  }
}
