import { describe, expect, test } from 'bun:test'
import { buildM3U } from '../src/lib/m3u'

const INFOHASH = 'dd1e67078381739d14beca697356ab76d49d1a2d'

describe('buildM3U', () => {
  test('genera EXTINF con todos los atributos y la URL con token', () => {
    const m3u = buildM3U(
      [
        {
          id: INFOHASH,
          name: 'DAZN 1 FHD',
          tvg_id: 'dazn1',
          tvg_name: 'DAZN 1',
          tvg_logo: 'http://logo.png',
          group_title: 'Deportes',
          number: 3,
        },
      ],
      'http://hub:8088/',
      'tok en'
    )

    expect(m3u.startsWith('#EXTM3U\n')).toBe(true)
    expect(m3u).toContain(
      `#EXTINF:-1 tvg-id="dazn1" tvg-name="DAZN 1" tvg-logo="http://logo.png" group-title="Deportes" tvg-chno="3",DAZN 1 FHD`
    )
    expect(m3u).toContain(`http://hub:8088/stream/${INFOHASH}?token=tok%20en`)
  })

  test('usa el nombre como fallback de tvg-name y omite los vacíos', () => {
    const m3u = buildM3U(
      [
        {
          id: INFOHASH,
          name: 'Canal',
          tvg_id: null,
          tvg_name: null,
          tvg_logo: null,
          group_title: null,
          number: null,
        },
      ],
      'http://hub:8088',
      ''
    )

    expect(m3u).toContain(`#EXTINF:-1 tvg-id="${INFOHASH}" tvg-name="Canal",Canal`)
    expect(m3u).not.toContain('tvg-logo=')
    expect(m3u).not.toContain('group-title=')
    expect(m3u).not.toContain('tvg-chno=')
    expect(m3u).toContain(`http://hub:8088/stream/${INFOHASH}`)
    expect(m3u).not.toContain('token=')
  })

  test('sanea comillas y saltos de línea', () => {
    const m3u = buildM3U(
      [
        {
          id: INFOHASH,
          name: 'Canal "A"',
          tvg_id: null,
          tvg_name: null,
          tvg_logo: null,
          group_title: 'Grupo\nNuevo',
          number: null,
        },
      ],
      'http://hub:8088',
      ''
    )

    expect(m3u).toContain('group-title="Grupo Nuevo"')
    expect(m3u).toContain(',Canal \'A\'')
  })
})
