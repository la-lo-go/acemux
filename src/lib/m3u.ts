export interface M3uStream {
  id: string
  name: string
  tvg_id: string | null
  tvg_name: string | null
  tvg_logo: string | null
  group_title: string | null
  number: number | null
}

function sanitize(value: string): string {
  return value.replace(/"/g, "'").replace(/[\r\n]+/g, ' ').trim()
}

export function buildM3U(streams: M3uStream[], baseUrl: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, '')
  const lines = ['#EXTM3U']

  for (const stream of streams) {
    const attributes = [
      `tvg-id="${sanitize(stream.tvg_id ?? stream.id)}"`,
      `tvg-name="${sanitize(stream.tvg_name ?? stream.name)}"`,
      stream.tvg_logo ? `tvg-logo="${sanitize(stream.tvg_logo)}"` : '',
      stream.group_title ? `group-title="${sanitize(stream.group_title)}"` : '',
      stream.number !== null ? `tvg-chno="${stream.number}"` : '',
    ].filter(Boolean)

    const url = `${base}/stream/${encodeURIComponent(stream.id)}${token ? `?token=${encodeURIComponent(token)}` : ''}`
    lines.push(`#EXTINF:-1 ${attributes.join(' ')},${sanitize(stream.name)}`)
    lines.push(url)
  }

  return `${lines.join('\n')}\n`
}
