import type { APIRoute } from 'astro'
import { getAllStreams } from '../../lib/db'
import { isChannelNumber } from '../../lib/hdhr'
import { buildXmltv } from '../../lib/xmltv'

/**
 * XMLTV view for Plex: channel ids are the numeric GuideNumber used in
 * /lineup.json, which is how Plex matches tuner channels to guide entries.
 * This endpoint is intentionally open (Plex cannot send api tokens); the
 * regular /xmltv.xml stays token-protected for Jellyfin/VLC.
 */
export const GET: APIRoute = () => {
  const parsedDays = Number.parseInt(process.env.EPG_FILLER_DAYS ?? '2', 10)
  const days = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 2

  const streams = getAllStreams(true)
    .filter((stream) => isChannelNumber(stream.number))
    .map((stream) => ({
      id: stream.id,
      name: stream.name,
      tvg_id: stream.tvg_id ?? null,
      tvg_name: stream.tvg_name ?? null,
      tvg_logo: stream.photo_url ?? null,
      number: stream.number,
    }))

  const xml = buildXmltv(streams, { days, idMode: 'number' })
  return new Response(xml, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}
