import { describe, expect, test } from 'bun:test'
import { SdtProbe } from '../src/lib/ts-sdt'

const PID_SDT = 0x0011

function buildSdtSection(serviceName: string, provider: string, tableId = 0x42): Uint8Array {
  const name = new TextEncoder().encode(serviceName)
  const prov = new TextEncoder().encode(provider)

  const descriptorLength = 1 + 1 + prov.length + 1 + name.length
  const descriptor = new Uint8Array(2 + descriptorLength)
  descriptor[0] = 0x48 // service_descriptor
  descriptor[1] = descriptorLength
  descriptor[2] = 0x01 // service_type: digital TV
  descriptor[3] = prov.length
  descriptor.set(prov, 4)
  descriptor[4 + prov.length] = name.length
  descriptor.set(name, 5 + prov.length)

  const body = new Uint8Array(8 + 5 + descriptor.length + 4)
  let p = 0
  body[p++] = 0x00
  body[p++] = 0x01 // transport_stream_id
  body[p++] = 0xc1 // version + current_next
  body[p++] = 0x00 // section_number
  body[p++] = 0x00 // last_section_number
  body[p++] = 0x00
  body[p++] = 0x01 // original_network_id
  body[p++] = 0xff // reserved
  body[p++] = 0x00
  body[p++] = 0x01 // service_id
  body[p++] = 0xfc // reserved + EIT flags
  body[p++] = 0x80 | ((descriptor.length >> 8) & 0x0f)
  body[p++] = descriptor.length & 0xff
  body.set(descriptor, p)
  p += descriptor.length
  body[p++] = 0
  body[p++] = 0
  body[p++] = 0
  body[p++] = 0 // CRC32 placeholder (not verified)

  const sectionLength = body.length
  const section = new Uint8Array(3 + sectionLength)
  section[0] = tableId
  section[1] = 0xb0 | ((sectionLength >> 8) & 0x0f)
  section[2] = sectionLength & 0xff
  section.set(body, 3)
  return section
}

function packetize(section: Uint8Array, pid = PID_SDT): Uint8Array[] {
  const packets: Uint8Array[] = []
  let index = 0
  let first = true

  while (index < section.length) {
    const packet = new Uint8Array(188).fill(0xff)
    packet[0] = 0x47
    packet[1] = (first ? 0x40 : 0x00) | ((pid >> 8) & 0x1f)
    packet[2] = pid & 0xff
    packet[3] = 0x10 | (packets.length & 0x0f) // payload only + continuity counter

    let cursor = 4
    if (first) packet[cursor++] = 0x00 // pointer_field

    const chunk = section.subarray(index, index + (188 - cursor))
    packet.set(chunk, cursor)
    index += chunk.length
    first = false
    packets.push(packet)
  }

  return packets
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

describe('SdtProbe', () => {
  test('extrae nombre y proveedor de una sección SDT', () => {
    const packets = packetize(buildSdtSection('DAZN F1 Spain', 'Movistar PR'))

    const probe = new SdtProbe()
    for (const packet of packets) probe.push(packet)

    expect(probe.complete).toBe(true)
    expect(probe.result).toEqual({
      serviceName: 'DAZN F1 Spain',
      serviceProvider: 'Movistar PR',
    })
  })

  test('reensambla secciones SDT que ocupan varios paquetes TS', () => {
    const longName = `Canal ${'X'.repeat(200)}`
    const packets = packetize(buildSdtSection(longName, 'Provider'))
    expect(packets.length).toBeGreaterThan(1)

    const probe = new SdtProbe()
    for (const packet of packets) probe.push(packet)

    expect(probe.result?.serviceName).toBe(longName)
    expect(probe.result?.serviceProvider).toBe('Provider')
  })

  test('funciona con chunks de tamaño arbitrario', () => {
    const data = concat(packetize(buildSdtSection('Canal Sorpresa', 'Provider X')))
    const probe = new SdtProbe()

    for (let offset = 0; offset < data.length; offset += 97) {
      probe.push(data.subarray(offset, offset + 97))
    }

    expect(probe.result?.serviceName).toBe('Canal Sorpresa')
    expect(probe.result?.serviceProvider).toBe('Provider X')
  })

  test('se resincroniza si empieza con bytes basura', () => {
    const data = concat(packetize(buildSdtSection('Late Channel', 'Net')))
    const probe = new SdtProbe()
    probe.push(new Uint8Array([1, 2, 3, 4, 5, 6, 7]))
    probe.push(data)

    expect(probe.result?.serviceName).toBe('Late Channel')
  })

  test('ignora tablas que no son SDT actual', () => {
    const probe = new SdtProbe()
    for (const packet of packetize(buildSdtSection('Other Table', 'Net', 0x46))) probe.push(packet)

    expect(probe.complete).toBe(false)
    expect(probe.result).toBeNull()
  })

  test('devuelve null sin SDT', () => {
    const probe = new SdtProbe()
    probe.push(new Uint8Array(188 * 10).fill(0x47))

    expect(probe.result).toBeNull()
  })
})
