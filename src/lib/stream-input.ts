import { normalizeAceId } from './server/acestream'

export const INFOHASH_RE = /^[0-9a-f]{40}$/

export interface StreamFields {
  name: string
  photo_url: string | null
  tvg_id: string | null
  tvg_name: string | null
  group_title: string | null
  number: number | null
  enabled: boolean
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function bool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    return ['on', 'true', '1', 'yes'].includes(value.trim().toLowerCase())
  }
  return fallback
}

function intOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number.parseInt(String(value), 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Normalize a raw AceStream input (acestream:// link, URL or infohash)
 * and return the 40-hex infohash, or null when it is not valid.
 */
export function parseAceId(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const id = normalizeAceId(raw)
  return INFOHASH_RE.test(id) ? id : null
}

export function parseStreamFields(
  body: Record<string, unknown>
): { ok: true; fields: StreamFields } | { ok: false; error: string } {
  const name = text(body.name)
  if (!name) return { ok: false, error: 'name is required' }

  return {
    ok: true,
    fields: {
      name,
      photo_url: text(body.photo_url),
      tvg_id: text(body.tvg_id),
      tvg_name: text(body.tvg_name),
      group_title: text(body.group_title),
      number: intOrNull(body.number),
      enabled: bool(body.enabled, true),
    },
  }
}
