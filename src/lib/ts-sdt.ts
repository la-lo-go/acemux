/**
 * Minimal MPEG-TS / DVB SDT probe.
 *
 * Broadcasters put the real channel name inside the Service Description Table
 * (PID 0x11, table_id 0x42); AceStream passes it through untouched. This lets
 * AceMux read `tvg_name` straight from the stream when the engine metadata API
 * has nothing to say about the content.
 */

const TS_PACKET_SIZE = 188
const SYNC_BYTE = 0x47
const PID_SDT = 0x0011
const TABLE_ID_SDT_ACTUAL = 0x42
const DESCRIPTOR_SERVICE = 0x48
const MAX_PENDING_BYTES = 1 << 20

export interface SdtInfo {
  serviceName: string
  serviceProvider: string | null
}

function decodeDvbText(bytes: Uint8Array): string {
  if (bytes.length === 0) return ''
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    text = new TextDecoder('latin1').decode(bytes)
  }
  return text.replace(/[\u0000-\u001f\u007f]/g, '').trim()
}

export class SdtProbe {
  private buffer = new Uint8Array(0)
  private section = new Uint8Array(0)
  private sectionExpected = 0
  private info: SdtInfo | null = null
  private done = false

  get complete(): boolean {
    return this.done
  }

  get result(): SdtInfo | null {
    return this.info
  }

  /** Feed arbitrary chunks; internally re-aligns on TS sync bytes. */
  push(chunk: Uint8Array): void {
    if (this.done || chunk.length === 0) return

    const merged = new Uint8Array(this.buffer.length + chunk.length)
    merged.set(this.buffer, 0)
    merged.set(chunk, this.buffer.length)
    this.buffer = merged

    let offset = 0
    while (!this.done && offset + TS_PACKET_SIZE <= this.buffer.length) {
      if (this.buffer[offset] !== SYNC_BYTE) {
        offset += 1
        continue
      }
      this.processPacket(this.buffer.subarray(offset, offset + TS_PACKET_SIZE))
      offset += TS_PACKET_SIZE
    }

    this.buffer = this.buffer.slice(offset)
    if (this.buffer.length > MAX_PENDING_BYTES) this.buffer = new Uint8Array(0)
  }

  private processPacket(packet: Uint8Array): void {
    const pid = ((packet[1] & 0x1f) << 8) | packet[2]
    if (pid !== PID_SDT) return

    const payloadStart = (packet[1] & 0x40) !== 0
    const adaptationControl = (packet[3] >> 4) & 0x03
    if (adaptationControl === 0 || adaptationControl === 2) return

    let cursor = 4
    if (adaptationControl === 3) cursor += 1 + packet[4]
    if (cursor >= TS_PACKET_SIZE) return

    let payload = packet.subarray(cursor)
    if (payloadStart) {
      const pointer = payload[0]
      payload = payload.subarray(1 + pointer)
      if (payload.length === 0) return
      if (payload[0] !== TABLE_ID_SDT_ACTUAL) {
        this.section = new Uint8Array(0)
        this.sectionExpected = 0
        return
      }
      const sectionLength = ((payload[1] & 0x0f) << 8) | payload[2]
      this.sectionExpected = 3 + sectionLength
      this.section = new Uint8Array(0)
    }

    if (this.sectionExpected === 0) return

    const merged = new Uint8Array(this.section.length + payload.length)
    merged.set(this.section, 0)
    merged.set(payload, this.section.length)
    this.section = merged

    if (this.section.length < this.sectionExpected) return
    this.parseSection(this.section.subarray(0, this.sectionExpected))
    this.section = new Uint8Array(0)
    this.sectionExpected = 0
  }

  private parseSection(section: Uint8Array): void {
    let cursor = 11 // 3 section header + 8 SDT header bytes
    const end = section.length - 4 // ignore CRC32

    while (cursor + 5 <= end) {
      const descriptorsLength = ((section[cursor + 3] & 0x0f) << 8) | section[cursor + 4]
      cursor += 5
      const descriptorsEnd = Math.min(cursor + descriptorsLength, end)

      while (cursor + 2 <= descriptorsEnd) {
        const tag = section[cursor]
        const length = section[cursor + 1]
        cursor += 2
        if (cursor + length > descriptorsEnd) break

        if (tag === DESCRIPTOR_SERVICE && length >= 3) {
          const descriptor = section.subarray(cursor, cursor + length)
          const providerLength = descriptor[1]
          const provider = descriptor.subarray(2, 2 + providerLength)
          const nameLength = descriptor[2 + providerLength] ?? 0
          const name = descriptor.subarray(3 + providerLength, 3 + providerLength + nameLength)
          const serviceName = decodeDvbText(name)
          if (serviceName) {
            this.info = { serviceName, serviceProvider: decodeDvbText(provider) || null }
            this.done = true
            return
          }
        }

        cursor += length
      }

      cursor = descriptorsEnd
    }
  }
}
