export interface XmltvStream {
  id: string
  name: string
  tvg_id: string | null
  tvg_name?: string | null
  tvg_logo: string | null
  number?: number | null
}

const BLOCK_MS = 6 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function formatUtc(date: Date): string {
  const stamp =
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  return `${stamp} +0000`
}

function channelId(stream: XmltvStream, idMode: 'tvg' | 'number'): string {
  if (
    idMode === 'number' &&
    typeof stream.number === 'number' &&
    Number.isInteger(stream.number) &&
    stream.number > 0
  ) {
    return String(stream.number)
  }
  return stream.tvg_id ?? stream.id
}

function displayName(stream: XmltvStream): string {
  return stream.tvg_name ?? stream.name
}

export function buildXmltv(
  streams: XmltvStream[],
  options: { days?: number; now?: Date; idMode?: 'tvg' | 'number' } = {}
): string {
  const days = options.days ?? 2
  const now = options.now ?? new Date()
  const idMode = options.idMode ?? 'tvg'
  const start = now.getTime()
  const end = start + days * DAY_MS

  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="AceMux">']

  for (const stream of streams) {
    lines.push(`  <channel id="${escapeXml(channelId(stream, idMode))}">`)
    lines.push(`    <display-name>${escapeXml(displayName(stream))}</display-name>`)
    if (stream.tvg_logo) lines.push(`    <icon src="${escapeXml(stream.tvg_logo)}"/>`)
    lines.push('  </channel>')
  }

  for (let blockStart = start; blockStart < end; blockStart += BLOCK_MS) {
    const blockStop = Math.min(blockStart + BLOCK_MS, end)
    const startAttr = formatUtc(new Date(blockStart))
    const stopAttr = formatUtc(new Date(blockStop))

    for (const stream of streams) {
      lines.push(
        `  <programme start="${startAttr}" stop="${stopAttr}" channel="${escapeXml(channelId(stream, idMode))}">`
      )
      lines.push(`    <title>${escapeXml(displayName(stream))}</title>`)
      lines.push('    <desc>Live stream via AceMux</desc>')
      lines.push('  </programme>')
    }
  }

  lines.push('</tv>')
  return `${lines.join('\n')}\n`
}
