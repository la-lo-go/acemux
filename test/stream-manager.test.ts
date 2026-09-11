import { describe, expect, test } from 'bun:test'
import { StreamManager } from '../src/lib/server/stream-manager'
import type { UpstreamStream } from '../src/lib/server/acestream'

interface Harness {
  open: (aceId: string, signal: AbortSignal) => Promise<UpstreamStream>
  pushes: ReadableStreamDefaultController<Uint8Array>[]
  aborts: AbortSignal[]
}

function harness(): Harness {
  const h: Harness = {
    pushes: [],
    aborts: [],
    open: async (_aceId: string, signal: AbortSignal): Promise<UpstreamStream> => {
      let controller!: ReadableStreamDefaultController<Uint8Array>
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
        },
      })
      h.pushes.push(controller)
      h.aborts.push(signal)
      signal.addEventListener('abort', () => {
        try {
          controller.error(new Error('aborted'))
        } catch {
          // already closed
        }
      })
      return { body, contentType: 'video/mp2t', stopUrl: null, statUrl: null }
    },
  }
  return h
}

async function firstChunk(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader()
  const { value } = await reader.read()
  return value as Uint8Array
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('StreamManager fan-out', () => {
  test('varios lectores del mismo id comparten un único upstream', async () => {
    const h = harness()
    const manager = new StreamManager({ open: h.open })

    const a = await manager.acquire('abc', new AbortController().signal)
    const b = await manager.acquire('abc', new AbortController().signal)

    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(h.pushes.length).toBe(1)
    expect(manager.list()).toEqual([{ aceId: 'abc', clients: 2, bytes: 0, startedAt: expect.any(Number), ended: false }])

    h.pushes[0].enqueue(new Uint8Array([1, 2, 3]))
    await tick()

    const [chunkA, chunkB] = await Promise.all([
      firstChunk((a as { stream: ReadableStream<Uint8Array> }).stream),
      firstChunk((b as { stream: ReadableStream<Uint8Array> }).stream),
    ])
    expect(Array.from(chunkA)).toEqual([1, 2, 3])
    expect(Array.from(chunkB)).toEqual([1, 2, 3])

    await manager.shutdown()
  })

  test('ids distintos abren upstreams distintos', async () => {
    const h = harness()
    const manager = new StreamManager({ open: h.open })

    await manager.acquire('aaa', new AbortController().signal)
    await manager.acquire('bbb', new AbortController().signal)

    expect(h.pushes.length).toBe(2)
    expect(manager.activeStreams()).toBe(2)

    await manager.shutdown()
  })

  test('respeta maxConcurrentStreams', async () => {
    const h = harness()
    const manager = new StreamManager({ open: h.open, maxConcurrentStreams: 1 })

    await manager.acquire('aaa', new AbortController().signal)
    const second = await manager.acquire('bbb', new AbortController().signal)

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.status).toBe(503)

    await manager.shutdown()
  })

  test('respeta maxClientsPerStream', async () => {
    const h = harness()
    const manager = new StreamManager({ open: h.open, maxClientsPerStream: 1 })

    await manager.acquire('aaa', new AbortController().signal)
    const second = await manager.acquire('aaa', new AbortController().signal)

    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.status).toBe(503)

    await manager.shutdown()
  })

  test('detiene el upstream tras la gracia cuando se va el último cliente', async () => {
    const h = harness()
    const manager = new StreamManager({ open: h.open, stopGraceMs: 10 })

    const result = await manager.acquire('aaa', new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(h.aborts[0].aborted).toBe(false)

    await (result as { stream: ReadableStream<Uint8Array> }).stream.cancel()
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(h.aborts[0].aborted).toBe(true)
    expect(manager.activeStreams()).toBe(0)
  })
})
