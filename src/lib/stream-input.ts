import { normalizeAceId } from './server/acestream'
import { MAX_CHANNEL_NUMBER, MIN_CHANNEL_NUMBER } from './hdhr'

export const INFOHASH_RE = /^[0-9a-f]{40}$/

export interface StreamFields {
  name: string
  photo_url: string | null
  tvg_id: string | null
  tvg_name: string | null
  group_title: string | null
  number: number | null | undefined
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

/**
 * `undefined` = field absent (keep current number), `null` = explicitly
 * cleared (AceMux will allocate a fresh one), otherwise a validated integer.
 */
function numberField(
  body: Record<string, unknown>
): { ok: true; value: number | null | undefined } | { ok: false; error: string } {
  const value = body.number
  if (!('number' in body) || value === undefined) return { ok: true, value: undefined }
  if (value === null || value === '') return { ok: true, value: null }

  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(parsed) || parsed < MIN_CHANNEL_NUMBER || parsed > MAX_CHANNEL_NUMBER) {
    return {
      ok: false,
      error: `number must be an integer between ${MIN_CHANNEL_NUMBER} and ${MAX_CHANNEL_NUMBER}`,
    }
  }
  return { ok: true, value: parsed }
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

  const number = numberField(body)
  if (!number.ok) return { ok: false, error: number.error }

  return {
    ok: true,
    fields: {
      name,
      photo_url: text(body.photo_url),
      tvg_id: text(body.tvg_id),
      tvg_name: text(body.tvg_name),
      group_title: text(body.group_title),
      number: number.value,
      enabled: bool(body.enabled, true),
    },
  }
}
