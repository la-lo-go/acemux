import { randomBytes } from 'node:crypto'
import { escapeXml } from './xmltv'

export const HDHR_FIRMWARE_NAME = 'bin_acemux'
export const HDHR_FIRMWARE_VERSION = '1.0.0'
export const HDHR_MODEL_NUMBER = 'HDTC-2US'
export const HDHR_MANUFACTURER = 'Silicondust'
export const HDHR_FRIENDLY_NAME = 'AceMux'
export const HDHR_DEVICE_AUTH = 'acemux'

export const MIN_CHANNEL_NUMBER = 1
export const MAX_CHANNEL_NUMBER = 99999

// SiliconDust device-id checksum: the XOR of all nibbles, where odd nibble
// positions are passed through a lookup table, must be zero.
// https://github.com/Silicondust/libhdhomerun/blob/master/hdhomerun_discover.c
const CHECKSUM_LOOKUP = [0xa, 0x5, 0xf, 0x6, 0x7, 0xc, 0x1, 0xb, 0x9, 0x2, 0x8, 0xd, 0x4, 0x3, 0xe, 0x0]
const DEVICE_ID_RE = /^[0-9A-F]{8}$/

function deviceIdChecksum(id: number): number {
  let checksum = 0
  checksum ^= CHECKSUM_LOOKUP[(id >>> 28) & 0x0f]
  checksum ^= (id >>> 24) & 0x0f
  checksum ^= CHECKSUM_LOOKUP[(id >>> 20) & 0x0f]
  checksum ^= (id >>> 16) & 0x0f
  checksum ^= CHECKSUM_LOOKUP[(id >>> 12) & 0x0f]
  checksum ^= (id >>> 8) & 0x0f
  checksum ^= CHECKSUM_LOOKUP[(id >>> 4) & 0x0f]
  checksum ^= id & 0x0f
  return checksum & 0x0f
}

/** A stable, checksum-valid 8-hex HDHomeRun device id. */
export function createDeviceId(): string {
  const base = randomBytes(4).readUInt32BE(0) & 0xfffffff0
  const checksum = deviceIdChecksum(base)
  const id = (base | checksum) >>> 0
  return id.toString(16).toUpperCase().padStart(8, '0')
}

export function isValidDeviceId(value: unknown): value is string {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  if (!DEVICE_ID_RE.test(normalized)) return false
  return deviceIdChecksum(Number.parseInt(normalized, 16)) === 0
}

export function isChannelNumber(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= MIN_CHANNEL_NUMBER &&
    value <= MAX_CHANNEL_NUMBER
  )
}

/** Plex tuner count derived from MAX_CONCURRENT_STREAMS (0 = unlimited). */
export function tunerCountFromEnv(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.MAX_CONCURRENT_STREAMS ?? '', 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 3
  return parsed === 0 ? 99 : Math.min(parsed, 99)
}

export interface HdhrStream {
  id: string
  name: string
  tvg_name: string | null
  number: number
}

export interface HdhrConfig {
  baseUrl: string
  token?: string
}

export interface HdhrDeviceConfig extends HdhrConfig {
  deviceId: string
  tunerCount: number
}

export function buildDiscover(config: HdhrDeviceConfig): string {
  return JSON.stringify(
    {
      BaseURL: config.baseUrl,
      DeviceAuth: HDHR_DEVICE_AUTH,
      DeviceID: config.deviceId,
      FirmwareName: HDHR_FIRMWARE_NAME,
      FirmwareVersion: HDHR_FIRMWARE_VERSION,
      FriendlyName: HDHR_FRIENDLY_NAME,
      LineupURL: `${config.baseUrl}/lineup.json`,
      Manufacturer: HDHR_MANUFACTURER,
      ModelNumber: HDHR_MODEL_NUMBER,
      TunerCount: config.tunerCount,
    },
    null,
    2
  )
}

export function buildLineupStatus(): string {
  return JSON.stringify(
    { ScanInProgress: 0, ScanPossible: 0, Source: 'Cable', SourceList: ['Cable'] },
    null,
    2
  )
}

export function streamUrl(stream: Pick<HdhrStream, 'id'>, config: HdhrConfig): string {
  const token = config.token ? `?token=${encodeURIComponent(config.token)}` : ''
  return `${config.baseUrl}/stream/${encodeURIComponent(stream.id)}${token}`
}

export function buildLineup(streams: HdhrStream[], config: HdhrConfig): string {
  const lineup = [...streams]
    .sort((a, b) => a.number - b.number)
    .map((stream) => ({
      GuideName: stream.tvg_name ?? stream.name,
      GuideNumber: String(stream.number),
      URL: streamUrl(stream, config),
    }))
  return JSON.stringify(lineup, null, 2)
}

export function buildDeviceXml(config: { baseUrl: string; deviceId: string }): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<root xmlns="urn:schemas-upnp-org:device-1-0">',
    `  <URLBase>${escapeXml(config.baseUrl)}</URLBase>`,
    '  <specVersion>',
    '    <major>1</major>',
    '    <minor>0</minor>',
    '  </specVersion>',
    '  <device>',
    '    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>',
    `    <friendlyName>${escapeXml(HDHR_FRIENDLY_NAME)}</friendlyName>`,
    `    <manufacturer>${escapeXml(HDHR_MANUFACTURER)}</manufacturer>`,
    `    <modelName>${escapeXml(HDHR_MODEL_NUMBER)}</modelName>`,
    `    <modelNumber>${escapeXml(HDHR_MODEL_NUMBER)}</modelNumber>`,
    '    <serialNumber/>',
    `    <UDN>uuid:${escapeXml(config.deviceId)}</UDN>`,
    '  </device>',
    '</root>',
    '',
  ].join('\n')
}
