import { openStream, stopSession as stopEngineSession, type UpstreamStream } from './acestream'
import { engineBase } from './http'

export type StreamOpener = (aceId: string, signal: AbortSignal) => Promise<UpstreamStream>

export interface StreamManagerOptions {
  open: StreamOpener
  /** Max simultaneous readers sharing one stream. */
  maxClientsPerStream?: number
  /** Max different streams downloaded at once. */
  maxConcurrentStreams?: number
  /** How long an idle stream is kept alive waiting for a reconnect. */
  stopGraceMs?: number
  /** Per-client buffered bytes before the slow client is dropped. */
  bufferLimitBytes?: number
  /** Time to wait for the engine before giving up. */
  startTimeoutMs?: number
  /** Injectable timer for tests. */
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
}

export interface SessionInfo {
  aceId: string
  clients: number
  bytes: number
  startedAt: number
  ended: boolean
}

export type AcquireResult =
  | { ok: true; stream: ReadableStream<Uint8Array>; contentType: string }
  | { ok: false; status: number; reason: string }

interface Subscriber {
  controller: ReadableStreamDefaultController<Uint8Array>
  dropped: boolean
}

interface Session {
  aceId: string
  controller: AbortController
  subscribers: Set<Subscriber>
  contentType: string
  stopUrl: string | null
  statUrl: string | null
  bytes: number
  startedAt: number
  ended: boolean
  errorMessage: string | null
  ready: Promise<void>
  stopTimer: ReturnType<typeof setTimeout> | null
}

const MB = 1024 * 1024

/**
 * Shares a single upstream AceStream session between N clients.
 *
 * The AceStream engine only serves one player per live stream, so opening a new
 * upstream per request would make each new viewer kill the previous one. This
 * manager keeps one download per infohash, fans it out to every reader and stops
 * the engine session only when the last reader has left.
 */
export class StreamManager {
  private sessions = new Map<string, Session>()
  private open: StreamOpener
  private maxClientsPerStream: number
  private maxConcurrentStreams: number
  private stopGraceMs: number
  private bufferLimitBytes: number
  private startTimeoutMs: number
  private setTimer: typeof setTimeout
  private clearTimer: typeof clearTimeout

  constructor(options: StreamManagerOptions) {
    this.open = options.open
    this.maxClientsPerStream = options.maxClientsPerStream ?? 6
    this.maxConcurrentStreams = options.maxConcurrentStreams ?? 3
    this.stopGraceMs = options.stopGraceMs ?? 10_000
    this.bufferLimitBytes = options.bufferLimitBytes ?? 8 * MB
    this.startTimeoutMs = options.startTimeoutMs ?? 45_000
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer = options.clearTimer ?? clearTimeout
  }

  activeStreams(): number {
    return this.sessions.size
  }

  /**
   * Runtime info for an active session, including the engine stats URL so a
   * caller can poll peers/speed without opening a second engine session.
   */
  statsTarget(aceId: string): {
    statUrl: string | null
    clients: number
    bytes: number
    startedAt: number
  } | null {
    const session = this.sessions.get(aceId)
    if (!session || session.ended) return null
    return {
      statUrl: session.statUrl,
      clients: session.subscribers.size,
      bytes: session.bytes,
      startedAt: session.startedAt,
    }
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => ({
      aceId: session.aceId,
      clients: session.subscribers.size,
      bytes: session.bytes,
      startedAt: session.startedAt,
      ended: session.ended,
    }))
  }

  async acquire(aceId: string, signal: AbortSignal): Promise<AcquireResult> {
    let session = this.sessions.get(aceId)

    if (!session) {
      if (this.sessions.size >= this.maxConcurrentStreams) {
        return { ok: false, status: 503, reason: 'max concurrent streams reached' }
      }
      session = this.createSession(aceId)
    }

    await session.ready

    if (signal.aborted) {
      return { ok: false, status: 499, reason: 'client aborted' }
    }
    if (session.ended) {
      return { ok: false, status: 502, reason: session.errorMessage ?? 'stream failed to start' }
    }
    if (session.subscribers.size >= this.maxClientsPerStream) {
      return { ok: false, status: 503, reason: 'stream is at capacity' }
    }

    return { ok: true, ...this.addSubscriber(session, signal) }
  }

  async shutdown(): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      this.teardown(session)
    }
    this.sessions.clear()
  }

  private createSession(aceId: string): Session {
    const session: Session = {
      aceId,
      controller: new AbortController(),
      subscribers: new Set(),
      contentType: 'video/mp2t',
      stopUrl: null,
      statUrl: null,
      bytes: 0,
      startedAt: Date.now(),
      ended: false,
      errorMessage: null,
      ready: Promise.resolve(),
      stopTimer: null,
    }
    this.sessions.set(aceId, session)
    session.ready = this.startSession(session)
    return session
  }

  private async startSession(session: Session): Promise<void> {
    const timeout = this.setTimer(() => {
      session.errorMessage = 'engine did not respond in time (no peers or channel unavailable)'
      session.controller.abort()
    }, this.startTimeoutMs)

    try {
      const upstream = await this.open(session.aceId, session.controller.signal)
      this.clearTimer(timeout)

      if (!upstream.body) throw new Error('engine did not return data')

      session.contentType = upstream.contentType
      session.stopUrl = upstream.stopUrl
      session.statUrl = upstream.statUrl
      this.pump(session, upstream.body)
    } catch (error) {
      this.clearTimer(timeout)
      session.errorMessage =
        session.errorMessage ?? (error instanceof Error ? error.message : String(error))
      this.endSession(session)
    }
  }

  private pump(session: Session, body: ReadableStream<Uint8Array>): void {
    const reader = body.getReader()

    ;(async () => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          if (value && value.byteLength > 0) this.broadcast(session, value)
        }
      } catch (error) {
        if (!session.ended) {
          session.errorMessage = error instanceof Error ? error.message : String(error)
        }
      } finally {
        this.endSession(session)
      }
    })()
  }

  private broadcast(session: Session, chunk: Uint8Array): void {
    session.bytes += chunk.byteLength

    for (const subscriber of session.subscribers) {
      if (subscriber.dropped) continue

      try {
        subscriber.controller.enqueue(chunk)
      } catch {
        this.removeSubscriber(session, subscriber)
        continue
      }

      const desired = subscriber.controller.desiredSize
      if (desired !== null && desired < -this.bufferLimitBytes) {
        this.removeSubscriber(session, subscriber, true)
      }
    }
  }

  private addSubscriber(
    session: Session,
    signal: AbortSignal
  ): { stream: ReadableStream<Uint8Array>; contentType: string } {
    const subscriber = {
      controller: null as unknown as ReadableStreamDefaultController<Uint8Array>,
      dropped: false,
    } satisfies Subscriber

    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          subscriber.controller = controller
        },
        cancel: () => this.removeSubscriber(session, subscriber),
      },
      new ByteLengthQueuingStrategy({ highWaterMark: MB })
    )

    session.subscribers.add(subscriber)

    if (session.stopTimer) {
      this.clearTimer(session.stopTimer)
      session.stopTimer = null
    }

    signal.addEventListener('abort', () => this.removeSubscriber(session, subscriber), { once: true })

    return { stream, contentType: session.contentType }
  }

  private removeSubscriber(session: Session, subscriber: Subscriber, close = false): void {
    if (subscriber.dropped) return
    subscriber.dropped = true
    session.subscribers.delete(subscriber)

    if (close) {
      try {
        subscriber.controller.close()
      } catch {
        // already closed/cancelled
      }
    }

    this.scheduleStop(session)
  }

  private scheduleStop(session: Session): void {
    if (session.ended || session.subscribers.size > 0 || session.stopTimer) return

    session.stopTimer = this.setTimer(() => {
      session.stopTimer = null
      if (!session.ended && session.subscribers.size === 0) {
        this.stopUpstream(session)
      }
    }, this.stopGraceMs)
  }

  private stopUpstream(session: Session): void {
    if (session.stopUrl) stopEngineSession(session.stopUrl)
    session.controller.abort()
  }

  private teardown(session: Session): void {
    if (session.stopTimer) {
      this.clearTimer(session.stopTimer)
      session.stopTimer = null
    }
    if (session.stopUrl) stopEngineSession(session.stopUrl)
    session.controller.abort()
    this.endSession(session)
  }

  private endSession(session: Session): void {
    if (session.ended) return
    session.ended = true

    if (session.stopTimer) {
      this.clearTimer(session.stopTimer)
      session.stopTimer = null
    }

    for (const subscriber of [...session.subscribers]) {
      subscriber.dropped = true
      try {
        subscriber.controller.close()
      } catch {
        // already closed/cancelled
      }
    }
    session.subscribers.clear()
    this.sessions.delete(session.aceId)
  }
}

function intEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

let singleton: StreamManager | null = null

export function getStreamManager(): StreamManager {
  if (singleton) return singleton

  const engine = engineBase()
  const pid = process.env.ACESTREAM_PLAYER_ID || 'acemux'

  singleton = new StreamManager({
    open: (aceId, signal) =>
      openStream(engine, aceId, signal, { pid: `${pid}-${aceId.slice(0, 12)}` }),
    maxClientsPerStream: intEnv('MAX_CLIENTS_PER_STREAM', 6),
    maxConcurrentStreams: intEnv('MAX_CONCURRENT_STREAMS', 3),
    stopGraceMs: intEnv('STREAM_STOP_GRACE_MS', 10_000),
  })

  return singleton
}
