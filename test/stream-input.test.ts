import { describe, expect, test } from 'bun:test'
import { INFOHASH_RE, parseAceId, parseStreamFields } from '../src/lib/stream-input'

const INFOHASH = 'dd1e67078381739d14beca697356ab76d49d1a2d'

function fields(body: Record<string, unknown>) {
  const result = parseStreamFields(body)
  if (!result.ok) throw new Error(result.error)
  return result.fields
}

describe('parseAceId', () => {
  test('acepta acestream:// con mayúsculas y devuelve minúsculas', () => {
    expect(parseAceId(`acestream://${INFOHASH.toUpperCase()}`)).toBe(INFOHASH)
  })

  test('acepta una URL getstream con id=', () => {
    expect(parseAceId(`http://127.0.0.1:6878/ace/getstream?id=${INFOHASH}`)).toBe(INFOHASH)
  })

  test('devuelve null para cadena vacía', () => {
    expect(parseAceId('')).toBeNull()
    expect(parseAceId('   ')).toBeNull()
  })

  test('devuelve null para un id inválido', () => {
    expect(parseAceId('abc')).toBeNull()
  })

  test('INFOHASH_RE solo acepta 40 hex minúsculas', () => {
    expect(INFOHASH_RE.test(INFOHASH)).toBe(true)
    expect(INFOHASH_RE.test(INFOHASH.toUpperCase())).toBe(false)
    expect(INFOHASH_RE.test(INFOHASH.slice(0, 39))).toBe(false)
  })
})

describe('parseStreamFields', () => {
  test('devuelve error si falta name', () => {
    const result = parseStreamFields({})
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('name is required')
  })

  test('enabled por defecto es true', () => {
    expect(fields({ name: 'Canal' }).enabled).toBe(true)
  })

  test("enabled: 'on' se interpreta como true", () => {
    expect(fields({ name: 'Canal', enabled: 'on' }).enabled).toBe(true)
  })

  test('enabled: false se respeta', () => {
    expect(fields({ name: 'Canal', enabled: false }).enabled).toBe(false)
  })

  test("number: '3' se convierte en 3", () => {
    expect(fields({ name: 'Canal', number: '3' }).number).toBe(3)
  })

  test('number vacío se convierte en null', () => {
    expect(fields({ name: 'Canal', number: '' }).number).toBeNull()
  })

  test('photo_url vacío se convierte en null', () => {
    expect(fields({ name: 'Canal', photo_url: '' }).photo_url).toBeNull()
  })
})
