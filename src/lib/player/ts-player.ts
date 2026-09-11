/**
 * AceStream player backed by the shared MPEG-TS session.
 *
 * Playback goes through /stream/:id (an MPEG-TS stream remuxed to fMP4 by
 * mpegts.js via MSE), so every viewer of the same channel shares a single
 * upstream session in the engine.
 */

import mpegts from 'mpegts.js'
import type { PlayerElements, PlayerConfig, StreamStats } from './types'
import { DEFAULT_PLAYER_CONFIG } from './types'
import {
  updateStatus,
  showError,
  showRetrying,
  hideOverlay,
  showUnmuteBanner,
  setBufferingStatus,
  setStatusText,
  updateStats,
  logErrorToUI,
  clearErrorLog,
} from './ui'
import { fetchSessionStats } from './acestream'

interface MpegtsStatisticsInfo {
  speed?: number
  droppedFrames?: number
}

export class AceStreamPlayer {
  private elements: PlayerElements
  private config: PlayerConfig
  private streamId: string
  private streamUrl: string
  private player: ReturnType<typeof mpegts.createPlayer> | null = null
  private statsInterval: ReturnType<typeof setInterval> | null = null
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private hasReachedMaxRetries = false
  private lastSpeed = 0

  constructor(
    elements: PlayerElements,
    streamId: string,
    streamUrl: string,
    config: Partial<PlayerConfig> = {}
  ) {
    this.elements = elements
    this.streamId = streamId
    this.streamUrl = streamUrl
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config }

    this.setupEventListeners()
  }

  private get video(): HTMLVideoElement {
    return this.elements.video
  }

  private setupEventListeners(): void {
    const { video, unmuteBanner } = this.elements

    unmuteBanner.addEventListener('click', () => {
      video.muted = false
      unmuteBanner.classList.add('hidden')
    })

    video.addEventListener('volumechange', () => {
      if (!video.muted) unmuteBanner.classList.add('hidden')
    })

    video.addEventListener('playing', () => {
      if (this.retryCount > 0) {
        this.retryCount = 0
        clearErrorLog(this.elements, this.config.maxRetries)
      }

      hideOverlay(this.elements)
      if (video.muted) showUnmuteBanner(unmuteBanner)
      this.startStatsPolling()
    })

    video.addEventListener('waiting', () => {
      if (!this.elements.statsBar.classList.contains('hidden')) {
        setBufferingStatus()
      }
    })

    window.addEventListener('beforeunload', () => this.destroy())
  }

  init(): void {
    if (!mpegts.isSupported()) {
      showError(
        this.elements.overlay,
        'Unsupported browser',
        'This browser does not support Media Source Extensions, which is required for live playback.'
      )
      return
    }
    this.start()
  }

  private start(): void {
    updateStatus(this.elements, 'Connecting to AceStream...', 'Joining shared stream session', 15)

    try {
      const player = mpegts.createPlayer(
        { type: 'mpegts', isLive: true, url: this.streamUrl },
        {
          // mpegts.js' worker breaks when bundled by Vite/Rollup.
          enableWorker: false,
          liveBufferLatencyChasing: true,
          liveBufferLatencyMaxLatency: 3,
          liveBufferLatencyMinRemain: 0.5,
          lazyLoad: false,
        }
      )

      this.player = player

      player.on(mpegts.Events.ERROR, (type: string, detail: string) => this.onError(type, detail))
      player.on(mpegts.Events.MEDIA_INFO, () =>
        updateStatus(this.elements, 'Starting playback...', 'Stream loaded', 80)
      )
      player.on(mpegts.Events.STATISTICS_INFO, (info: MpegtsStatisticsInfo) => {
        if (typeof info?.speed === 'number') this.lastSpeed = info.speed
      })

      player.attachMediaElement(this.video)
      player.load()

      const playResult = player.play()
      if (playResult && typeof (playResult as Promise<void>).catch === 'function') {
        ;(playResult as Promise<void>).catch(() => {
          // Autoplay may be blocked until the user interacts; controls remain.
        })
      }

      updateStatus(this.elements, 'Prebuffering...', 'AceStream is loading the content', 40)
    } catch (error) {
      this.onError('OtherError', error instanceof Error ? error.message : String(error))
    }
  }

  private onError(type: string, detail: string): void {
    console.error('Player error:', type, detail)
    if (this.hasReachedMaxRetries) return

    if (this.retryCount >= this.config.maxRetries) {
      this.stopWithError(
        'Stream unavailable',
        'Could not play the stream after several attempts. The channel may be offline.',
        detail
      )
      return
    }

    this.retryCount++
    logErrorToUI(this.elements, detail || 'Playback issue', this.retryCount, this.config.maxRetries)
    showRetrying(
      this.elements.overlay,
      type === mpegts.ErrorTypes.NETWORK_ERROR ? 'Network Error' : 'Playback Error',
      detail || 'Connection lost',
      this.retryCount - 1,
      this.config.maxRetries
    )

    this.retryTimeout = setTimeout(() => this.restart(), 2000 * this.retryCount)
  }

  private restart(): void {
    this.cleanupPlayer()
    if (!this.hasReachedMaxRetries) this.start()
  }

  private stopWithError(title: string, message: string, code: string | null = null): void {
    this.hasReachedMaxRetries = true
    this.cleanupPlayer()

    this.elements.unmuteBanner.classList.add('hidden')
    this.elements.errorLog.classList.add('hidden')
    setStatusText('Error')
    showError(this.elements.overlay, title, message, code)
  }

  private cleanupPlayer(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval)
      this.statsInterval = null
    }
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }

    const player = this.player
    if (player) {
      try {
        player.pause()
      } catch {
        // ignore
      }
      try {
        player.unload()
      } catch {
        // ignore
      }
      try {
        player.detachMediaElement()
      } catch {
        // ignore
      }
      try {
        player.destroy()
      } catch {
        // ignore
      }
      this.player = null
    }
  }

  private startStatsPolling(): void {
    if (this.statsInterval) return
    this.pollStats()
    this.statsInterval = setInterval(() => this.pollStats(), this.config.statsPollingInterval)
  }

  private async pollStats(): Promise<void> {
    const session = await fetchSessionStats(this.streamId)
    if (!session) return

    updateStats({
      peers: session.peers ?? undefined,
      speed_down: this.lastSpeed || (session.speed_down ?? undefined),
      speed_up: session.speed_up ?? undefined,
      status: session.status ?? undefined,
    } as StreamStats)
  }

  destroy(): void {
    this.hasReachedMaxRetries = true
    this.cleanupPlayer()
  }
}
