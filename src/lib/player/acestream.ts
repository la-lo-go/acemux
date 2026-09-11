/**
 * Client-side helpers to talk to AceMux's shared-stream endpoints.
 */

/**
 * URL of the shared MPEG-TS session endpoint. All viewers of the same id read
 * from the same upstream session, so the engine is only contacted once.
 */
export function buildStreamUrl(streamId: string, token: string): string {
  const base = `/stream/${encodeURIComponent(streamId)}`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

export interface SessionStats {
  active: boolean
  clients?: number
  peers?: number | null
  speed_down?: number | null
  speed_up?: number | null
  status?: string | null
  bytes?: number
}

export async function fetchSessionStats(streamId: string): Promise<SessionStats | null> {
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(streamId)}`)
    if (!response.ok) return null
    return (await response.json()) as SessionStats
  } catch {
    return null
  }
}
