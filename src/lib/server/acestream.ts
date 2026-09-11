const INFOHASH_RE = /[0-9a-fA-F]{40}/
const USER_AGENT = 'acemux/0.1'

export interface UpstreamStream {
  body: ReadableStream<Uint8Array> | null
  contentType: string
  /** Engine command URL used to explicitly stop the playback session. */
  stopUrl: string | null
  /** Engine stats URL for this playback session. */
  statUrl: string | null
}

export interface OpenStreamOptions {
  /**
   * Player id sent to the engine. The engine distinguishes player sessions by
   * `pid`; using our own keeps AceMux from being replaced by other players.
   */
  pid?: string
}

export function normalizeAceId(raw: string): string {
  const value = raw.trim()
  const match = value.match(INFOHASH_RE)
  if (match) return match[0].toLowerCase()

  try {
    const url = new URL(value.replace(/^acestream:\/\//i, 'http://'))
    const id =
      url.searchParams.get('id') ??
      url.searchParams.get('infohash') ??
      url.searchParams.get('content_id')
    if (id) return id.trim().toLowerCase()
  } catch {
    // no es una URL
  }

  return value.replace(/^acestream:\/\//i, '')
}

export function rewriteLoopback(rawUrl: string, engineUrl: string): string {
  const url = new URL(rawUrl, engineUrl)
  const engine = new URL(engineUrl)
  const loopbackHosts = ['127.0.0.1', 'localhost', '0.0.0.0', '::1', '[::1]']

  if (loopbackHosts.includes(url.hostname)) {
    url.protocol = engine.protocol
    url.hostname = engine.hostname
    url.port = engine.port
    url.username = ''
    url.password = ''
  }

  return url.toString()
}

async function fetchStream(
  url: string,
  signal: AbortSignal,
  stopUrl: string | null = null,
  statUrl: string | null = null
): Promise<UpstreamStream> {
  const response = await fetch(url, { signal, headers: { 'user-agent': USER_AGENT } })
  if (!response.ok) throw new Error(`engine responded ${response.status}`)
  return {
    body: response.body,
    contentType: response.headers.get('content-type') ?? 'video/mp2t',
    stopUrl,
    statUrl,
  }
}

export async function openStream(
  engineUrl: string,
  aceId: string,
  signal: AbortSignal,
  options: OpenStreamOptions = {}
): Promise<UpstreamStream> {
  const metadataUrl = new URL('/ace/getstream', engineUrl)
  metadataUrl.searchParams.set('id', aceId)
  metadataUrl.searchParams.set('format', 'json')
  if (options.pid) metadataUrl.searchParams.set('pid', options.pid)

  const response = await fetch(metadataUrl, {
    signal,
    redirect: 'manual',
    headers: { 'user-agent': USER_AGENT },
  })

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location')
    if (!location) throw new Error('engine returned a redirect without Location')
    return fetchStream(rewriteLoopback(location, engineUrl), signal)
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    if (!response.ok) throw new Error(`engine responded ${response.status}`)
    const payload = (await response.json()) as {
      response?: { playback_url?: string; command_url?: string; stat_url?: string }
      playback_url?: string
      command_url?: string
      stat_url?: string
      error?: string
    }
    if (payload.error) throw new Error(payload.error)
    const playbackUrl = payload.response?.playback_url ?? payload.playback_url
    if (!playbackUrl) throw new Error('engine did not return a playback_url')
    const commandUrl = payload.response?.command_url ?? payload.command_url ?? null
    const statUrl = payload.response?.stat_url ?? payload.stat_url ?? null
    return fetchStream(
      rewriteLoopback(playbackUrl, engineUrl),
      signal,
      commandUrl ? rewriteLoopback(commandUrl, engineUrl) : null,
      statUrl ? rewriteLoopback(statUrl, engineUrl) : null
    )
  }

  if (!response.ok) throw new Error(`engine responded ${response.status}`)
  return { body: response.body, contentType: contentType || 'video/mp2t', stopUrl: null, statUrl: null }
}

/**
 * Best-effort explicit stop of an engine playback session. The engine stops the
 * session automatically when the reader disconnects, but calling this makes the
 * teardown deterministic.
 */
export function stopSession(stopUrl: string): void {
  try {
    const url = new URL(stopUrl)
    url.searchParams.set('method', 'stop')
    fetch(url, { headers: { 'user-agent': USER_AGENT } }).catch(() => {})
  } catch {
    // ignore malformed URLs
  }
}
