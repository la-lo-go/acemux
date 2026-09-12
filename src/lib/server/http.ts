/**
 * Shared helpers for the M3U / XMLTV / stream HTTP endpoints.
 */

export function engineBase(): string {
  return (process.env.ACESTREAM_ENGINE_URL || 'http://localhost:6878').replace(/\/+$/, '')
}

export function apiToken(): string {
  return process.env.ACEMUX_API_TOKEN ?? ''
}

/**
 * Authorizes a request against ACEMUX_API_TOKEN. When no token is configured the
 * endpoint is left open. Accepts `?token=` or `Authorization: Bearer`.
 */
export function isAuthorized(request: Request): boolean {
  const token = apiToken()
  if (!token) return true
  const url = new URL(request.url)
  if (url.searchParams.get('token') === token) return true
  return request.headers.get('authorization') === `Bearer ${token}`
}

/**
 * Base URL emitted in the M3U. Uses PUBLIC_BASE_URL when configured, otherwise
 * derives it from the request (honouring common reverse-proxy headers).
 */
export function publicBase(request: Request): string {
  const configured = (process.env.PUBLIC_BASE_URL ?? '').replace(/\/+$/, '')
  if (configured) return configured

  const url = new URL(request.url)
  const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(/:$/, '')
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
  return `${proto}://${host}`
}
