import { describe, expect, test } from 'bun:test'
import {
  buildDeviceXml,
  buildDiscover,
  buildLineup,
  buildLineupStatus,
  createDeviceId,
  isChannelNumber,
  isValidDeviceId,
  streamUrl,
  tunerCountFromEnv,
} from '../src/lib/hdhr'

const ID = 'dd1e67078381739d14beca697356ab76d49d1a2d'

describe('HDHomeRun device id', () => {
  test('createDeviceId genera ids de 8 hex con checksum válido', () => {
    for (let i = 0; i < 50; i++) {
      const id = createDeviceId()
      expect(id).toMatch(/^[0-9A-F]{8}$/)
      expect(isValidDeviceId(id)).toBe(true)
    }
  })

  test('isValidDeviceId rechaza formatos y checksums incorrectos', () => {
    expect(isValidDeviceId('')).toBe(false)
    expect(isValidDeviceId('ACEMUX01')).toBe(false)
    expect(isValidDeviceId('12345678')).toBe(false)

    const valid = createDeviceId()
    const corrupted = valid.slice(0, 7) + ((Number.parseInt(valid[7], 16) + 1) % 16).toString(16).toUpperCase()
    expect(isValidDeviceId(corrupted)).toBe(false)
  })
})

describe('isChannelNumber', () => {
  test('acepta enteros en rango y rechaza el resto', () => {
    expect(isChannelNumber(1)).toBe(true)
    expect(isChannelNumber(99999)).toBe(true)
    expect(isChannelNumber(0)).toBe(false)
    expect(isChannelNumber(-1)).toBe(false)
    expect(isChannelNumber(1.5)).toBe(false)
    expect(isChannelNumber('3')).toBe(false)
    expect(isChannelNumber(null)).toBe(false)
    expect(isChannelNumber(undefined)).toBe(false)
  })
})

describe('tunerCountFromEnv', () => {
  test('deriva el TunerCount de MAX_CONCURRENT_STREAMS', () => {
    expect(tunerCountFromEnv({})).toBe(3)
    expect(tunerCountFromEnv({ MAX_CONCURRENT_STREAMS: '6' })).toBe(6)
    expect(tunerCountFromEnv({ MAX_CONCURRENT_STREAMS: '0' })).toBe(99)
    expect(tunerCountFromEnv({ MAX_CONCURRENT_STREAMS: '-1' })).toBe(3)
    expect(tunerCountFromEnv({ MAX_CONCURRENT_STREAMS: 'abc' })).toBe(3)
  })
})

describe('buildDiscover', () => {
  test('emite el descriptor de tuner con las URLs públicas', () => {
    const raw = buildDiscover({
      baseUrl: 'http://hub:4321',
      deviceId: '00CF1210',
      tunerCount: 4,
    })
    const data = JSON.parse(raw) as Record<string, unknown>

    expect(data.BaseURL).toBe('http://hub:4321')
    expect(data.LineupURL).toBe('http://hub:4321/lineup.json')
    expect(data.DeviceID).toBe('00CF1210')
    expect(data.TunerCount).toBe(4)
    expect(data.ModelNumber).toBe('HDTC-2US')
    expect(data.Manufacturer).toBe('Silicondust')
    expect(data.FriendlyName).toBe('AceMux')
  })
})

describe('buildLineupStatus', () => {
  test('declara Cable sin scan en curso', () => {
    const data = JSON.parse(buildLineupStatus()) as Record<string, unknown>
    expect(data.ScanInProgress).toBe(0)
    expect(data.ScanPossible).toBe(0)
    expect(data.Source).toBe('Cable')
    expect(data.SourceList).toEqual(['Cable'])
  })
})

describe('buildLineup', () => {
  const config = { baseUrl: 'http://hub:4321', token: 'tok en' }

  test('ordena por número, usa tvg_name y codifica el token', () => {
    const raw = buildLineup(
      [
        { id: 'b', name: 'Canal B', tvg_name: null, number: 1001 },
        { id: 'a', name: 'Canal A', tvg_name: 'Canal A HD', number: 2 },
      ],
      config
    )
    const lineup = JSON.parse(raw) as Array<Record<string, string>>

    expect(lineup).toHaveLength(2)
    expect(lineup[0]).toEqual({
      GuideName: 'Canal A HD',
      GuideNumber: '2',
      URL: 'http://hub:4321/stream/a?token=tok%20en',
    })
    expect(lineup[1].GuideName).toBe('Canal B')
    expect(lineup[1].GuideNumber).toBe('1001')
  })

  test('devuelve [] sin canales', () => {
    expect(buildLineup([], { baseUrl: 'http://hub:4321' })).toBe('[]')
  })

  test('streamUrl no añade token vacío', () => {
    expect(streamUrl({ id: ID }, { baseUrl: 'http://hub:4321' })).toBe(
      `http://hub:4321/stream/${ID}`
    )
  })
})

describe('buildDeviceXml', () => {
  test('incluye URLBase, UDN y el modelo HDHomeRun', () => {
    const xml = buildDeviceXml({ baseUrl: 'http://hub:4321', deviceId: '00CF1210' })

    expect(xml).toContain('<URLBase>http://hub:4321</URLBase>')
    expect(xml).toContain('<UDN>uuid:00CF1210</UDN>')
    expect(xml).toContain('<modelName>HDTC-2US</modelName>')
    expect(xml).toContain('<manufacturer>Silicondust</manufacturer>')
  })

  test('escapa caracteres XML en la URL base', () => {
    const xml = buildDeviceXml({ baseUrl: 'http://hub:4321/?a=1&b=2', deviceId: '00CF1210' })
    expect(xml).toContain('<URLBase>http://hub:4321/?a=1&amp;b=2</URLBase>')
    expect(xml).not.toContain('a=1&b=2</URLBase>')
  })
})
