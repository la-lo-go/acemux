import { engineBase } from './http'

export interface ResolvedMetadata {
  id: string
  title: string | null
  name: string | null
  categories: string[]
  isLive: boolean | null
  contentType: string | null
  source: 'analyze_content' | 'get_media_files' | 'public' | null
}

const USER_AGENT = 'acemux/0.1'

async function fetchJson(url: string, timeoutMs: number): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': USER_AGENT },
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

/**
 * Best-effort infohash -> name lookup against the public AceStream snapshot.
 * The public API only supports text search, so we download the full snapshot
 * once and cache it in memory.
 */
let snapshot: { at: number; map: Map<string, { name: string; categories: string[] }> } | null = null
const SNAPSHOT_TTL_MS = 60 * 60 * 1000

async function publicLookup(aceId: string): Promise<{ name: string; categories: string[] } | null> {
  try {
    if (!snapshot || Date.now() - snapshot.at > SNAPSHOT_TTL_MS) {
      const response = await fetch('https://api.acestream.me/all?api_version=1&api_key=test_api_key', {
        signal: AbortSignal.timeout(15_000),
        headers: { 'user-agent': USER_AGENT },
      })
      if (!response.ok) return null
      const items = (await response.json()) as Array<Record<string, unknown>>
      const map = new Map<string, { name: string; categories: string[] }>()
      for (const item of items) {
        const infohash = typeof item.infohash === 'string' ? item.infohash.toLowerCase() : ''
        const name = typeof item.name === 'string' ? item.name : ''
        if (!infohash || !name) continue
        map.set(infohash, {
          name,
          categories: Array.isArray(item.categories)
            ? item.categories.filter((c): c is string => typeof c === 'string')
            : [],
        })
      }
      snapshot = { at: Date.now(), map }
    }
    return snapshot.map.get(aceId.toLowerCase()) ?? null
  } catch {
    return null
  }
}

/**
 * Resolve a stream name/category from the engine metadata API, with the public
 * snapshot as a fallback. `analyze_content` may need to fetch the transport
 * file (P2P), so a short timeout is used and failure is not fatal.
 */
async function resolveMetadataUncached(
  aceId: string,
  options: { timeoutMs?: number } = {}
): Promise<ResolvedMetadata> {
  const engine = engineBase()
  const timeout = options.timeoutMs ?? 12_000
  const result: ResolvedMetadata = {
    id: aceId,
    title: null,
    name: null,
    categories: [],
    isLive: null,
    contentType: null,
    source: null,
  }

  const query = encodeURIComponent(`acestream:?infohash=${aceId}`)
  const analyze = asRecord(await fetchJson(
    `${engine}/server/api?api_version=3&method=analyze_content&query=${query}`,
    timeout
  ))
  const analyzed = asRecord(analyze?.result)
  if (analyzed) {
    if (typeof analyzed.title === 'string' && analyzed.title.trim()) result.title = analyzed.title.trim()
    if (Array.isArray(analyzed.categories)) {
      result.categories = analyzed.categories.filter((c): c is string => typeof c === 'string')
    }
    if (typeof analyzed.is_live === 'number') result.isLive = analyzed.is_live === 1
    if (typeof analyzed.content_type === 'string') result.contentType = analyzed.content_type
    if (result.title) {
      result.name = result.title
      result.source = 'analyze_content'
      return result
    }
  }

  const media = asRecord(await fetchJson(
    `${engine}/server/api?api_version=3&method=get_media_files&infohash=${encodeURIComponent(aceId)}`,
    timeout
  ))
  const mediaResult = asRecord(media?.result)
  if (mediaResult) {
    const files = Array.isArray(mediaResult.files) ? mediaResult.files : []
    const firstFile = asRecord(files[0])
    const name =
      (typeof mediaResult.name === 'string' && mediaResult.name.trim()) ||
      (firstFile && typeof firstFile.filename === 'string' ? firstFile.filename.trim() : '')
    if (name) {
      result.name = name
      result.title = name
      result.source = 'get_media_files'
      if (result.categories.length === 0 && Array.isArray(mediaResult.categories)) {
        result.categories = mediaResult.categories.filter((c): c is string => typeof c === 'string')
      }
      return result
    }
  }

  const publicItem = await publicLookup(aceId)
  if (publicItem) {
    result.name = publicItem.name
    result.title = publicItem.name
    if (result.categories.length === 0) result.categories = publicItem.categories
    result.source = 'public'
  }

  return result
}

/**
 * In-memory metadata cache. Caches both successful and empty ("no metadata
 * found") results so a missing stream does not hammer the engine on every
 * request. Concurrent lookups for the same infohash share one request.
 */
const METADATA_TTL_MS = 60_000
const metadataCache = new Map<string, { at: number; value: ResolvedMetadata }>()
const metadataInflight = new Map<string, Promise<ResolvedMetadata>>()

/** Clear the metadata cache. Mostly useful for tests. */
export function clearMetadataCache(): void {
  metadataCache.clear()
  metadataInflight.clear()
}

export function resolveMetadata(
  aceId: string,
  options: { timeoutMs?: number } = {}
): Promise<ResolvedMetadata> {
  const key = aceId.toLowerCase()
  const cached = metadataCache.get(key)
  if (cached && Date.now() - cached.at < METADATA_TTL_MS) {
    return Promise.resolve(cached.value)
  }

  const pending = metadataInflight.get(key)
  if (pending) return pending

  const request = resolveMetadataUncached(aceId, options)
    .then((value) => {
      metadataCache.set(key, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      metadataInflight.delete(key)
    })

  metadataInflight.set(key, request)
  return request
}
