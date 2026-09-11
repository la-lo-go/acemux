import { describe, expect, test } from 'bun:test'
import { buildXmltv } from '../src/lib/xmltv'

const INFOHASH = 'dd1e67078381739d14beca697356ab76d49d1a2d'
const NOW = new Date('2026-01-01T00:00:00Z')

describe('buildXmltv', () => {
  test('genera un channel por stream y usa el infohash si no hay tvg_id', () => {
    const xml = buildXmltv(
      [
        { id: INFOHASH, name: 'Canal Uno', tvg_id: 'uno', tvg_logo: 'http://logo.png' },
        { id: INFOHASH, name: 'Canal Dos', tvg_id: null, tvg_logo: null },
      ],
      { days: 1, now: NOW }
    )

    expect(xml).toContain('<tv generator-info-name="AceMux">')
    expect(xml).toContain('<channel id="uno">')
    expect(xml).toContain('<display-name>Canal Uno</display-name>')
    expect(xml).toContain('<icon src="http://logo.png"/>')
    expect(xml).toContain(`<channel id="${INFOHASH}">`)
    expect(xml).toContain('<display-name>Canal Dos</display-name>')

    const channels = xml.match(/<channel /g) ?? []
    expect(channels).toHaveLength(2)
  })

  test('genera bloques de 6h con el channel coincidente', () => {
    const xml = buildXmltv(
      [{ id: INFOHASH, name: 'Canal', tvg_id: 'uno', tvg_logo: null }],
      { days: 2, now: NOW }
    )

    expect(xml).toContain(
      `<programme start="20260101000000 +0000" stop="20260101060000 +0000" channel="uno">`
    )
    expect(xml).toContain('<title>Canal</title>')
    expect(xml).toContain('<desc>Live stream via AceMux</desc>')

    const programmes = xml.match(/<programme /g) ?? []
    expect(programmes).toHaveLength(8)
  })

  test('usa tvg_name como display-name y title cuando existe', () => {
    const xml = buildXmltv(
      [{ id: INFOHASH, name: 'Canal', tvg_name: 'Canal HD', tvg_id: 'uno', tvg_logo: null }],
      { days: 1, now: NOW }
    )

    expect(xml).toContain('<display-name>Canal HD</display-name>')
    expect(xml).toContain('<title>Canal HD</title>')
  })

  test('escapa &, <, >, " y \' en textos y atributos', () => {
    const xml = buildXmltv(
      [
        {
          id: INFOHASH,
          name: 'A & B <C> "D" \'E\'',
          tvg_id: 'x & y <z>',
          tvg_logo: 'http://logo.png?a=1&b=2',
        },
      ],
      { days: 1, now: NOW }
    )

    expect(xml).toContain('<display-name>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;</display-name>')
    expect(xml).toContain('<channel id="x &amp; y &lt;z&gt;">')
    expect(xml).toContain('<icon src="http://logo.png?a=1&amp;b=2"/>')
    expect(xml).toContain('<title>A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;</title>')
  })
})
