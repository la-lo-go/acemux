import { describe, expect, test } from 'bun:test'
import { normalizeAceId, rewriteLoopback } from '../src/lib/server/acestream'

const INFOHASH = 'dd1e67078381739d14beca697356ab76d49d1a2d'

describe('normalizeAceId', () => {
  test('extrae el infohash de un enlace acestream://', () => {
    expect(normalizeAceId(`acestream://${INFOHASH}`)).toBe(INFOHASH)
  })

  test('normaliza mayúsculas y espacios', () => {
    expect(normalizeAceId(`  ${INFOHASH.toUpperCase()}  `)).toBe(INFOHASH)
  })

  test('extrae el id de una URL getstream', () => {
    expect(normalizeAceId(`http://127.0.0.1:6878/ace/getstream?id=${INFOHASH}`)).toBe(INFOHASH)
  })

  test('extrae el infohash de una URL con infohash=', () => {
    expect(normalizeAceId(`http://engine:6878/ace/getstream?infohash=${INFOHASH}`)).toBe(INFOHASH)
  })
})

describe('rewriteLoopback', () => {
  test('reescribe 127.0.0.1 al host del engine', () => {
    expect(rewriteLoopback('http://127.0.0.1:6878/ace/r/abc/def', 'http://engine:6878')).toBe(
      'http://engine:6878/ace/r/abc/def'
    )
  })

  test('reescribe localhost al host del engine', () => {
    expect(rewriteLoopback('http://localhost:6878/ace/r/abc', 'http://engine:6878')).toBe(
      'http://engine:6878/ace/r/abc'
    )
  })

  test('respeta las URLs que no son loopback', () => {
    expect(rewriteLoopback('http://192.168.1.5:6878/ace/r/abc', 'http://engine:6878')).toBe(
      'http://192.168.1.5:6878/ace/r/abc'
    )
  })
})
