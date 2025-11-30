/**
 * HLS.js player wrapper
 */

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
  clearErrorLog
} from './ui'
import { buildStreamUrls, fetchStreamInfo, fetchStats } from './acestream'

declare global {
  interface Window {
    Hls: any
  }
}

export class AceStreamPlayer {
  private elements: PlayerElements
  private config: PlayerConfig
  private streamId: string
  private hls: any = null
  private statUrl: string | null = null
  private playbackUrl: string = ''
  private statsInterval: ReturnType<typeof setInterval> | null = null
  private retryTimeout: ReturnType<typeof setTimeout> | null = null
  private retryCount = 0
  private nonFatalErrorCount = 0
  private hasReachedMaxRetries = false

  constructor(elements: PlayerElements, streamId: string, config: Partial<PlayerConfig> = {}) {
    this.elements = elements
    this.streamId = streamId
    this.config = { ...DEFAULT_PLAYER_CONFIG, ...config }
    
    this.setupEventListeners()
  }

  private setupEventListeners(): void {
    const { video, unmuteBanner } = this.elements

    // Handle unmute banner click
    unmuteBanner.addEventListener('click', () => {
      video.muted = false
      unmuteBanner.classList.add('hidden')
    })

    // Hide banner if user unmutes via video controls
    video.addEventListener('volumechange', () => {
      if (!video.muted) {
        unmuteBanner.classList.add('hidden')
      }
    })

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => this.destroy())
  }

  async init(): Promise<void> {
    const { video, overlay } = this.elements
    const { jsonSrc, hlsSrc } = buildStreamUrls(this.streamId)

    updateStatus(this.elements, 'Connecting to AceStream...', 'Requesting stream manifest', 10)

    try {
      updateStatus(this.elements, 'Initializing stream...', 'Waiting for AceStream engine', 20)
      
      const { playbackUrl, statUrl } = await fetchStreamInfo(jsonSrc, hlsSrc)
      this.playbackUrl = playbackUrl
      this.statUrl = statUrl

      updateStatus(this.elements, 'Prebuffering...', 'AceStream is loading the content', 40)

      if (this.supportsNativeHls()) {
        this.initNativeHls()
      } else if (this.supportsHlsJs()) {
        this.initHlsJs()
      } else {
        showError(overlay, 'Browser Not Supported', 
          'Your browser does not support HLS playback. Please use a modern browser like Chrome, Firefox, Safari, or Edge.')
      }
    } catch (error) {
      console.error('Stream initialization error:', error)
      showError(overlay, 'Connection Error',
        'Failed to initialize the stream. Make sure AceStream Engine is running.',
        error instanceof Error ? error.message : String(error))
    }
  }

  private supportsNativeHls(): boolean {
    return !!this.elements.video.canPlayType('application/vnd.apple.mpegurl')
  }

  private supportsHlsJs(): boolean {
    return window.Hls && window.Hls.isSupported()
  }

  private initNativeHls(): void {
    const { video, overlay, unmuteBanner } = this.elements

    video.src = this.playbackUrl

    video.addEventListener('loadedmetadata', () => {
      this.tryPlay()
    })

    video.addEventListener('playing', () => {
      console.log('Video playing event fired (native HLS)')
      hideOverlay(this.elements)
      if (video.muted) {
        showUnmuteBanner(unmuteBanner)
      }
      this.startStatsPolling()
    })

    video.addEventListener('error', () => {
      showError(overlay, 'Playback Error', 'Failed to load the stream', 
        video.error?.message || 'Unknown error')
    })
  }

  private initHlsJs(): void {
    const { video, overlay, unmuteBanner, statsBar } = this.elements
    const Hls = window.Hls

    this.hls = new Hls(this.config.hlsConfig)
    this.hls.loadSource(this.playbackUrl)
    this.hls.attachMedia(video)

    this.hls.on(Hls.Events.MANIFEST_LOADING, () => {
      updateStatus(this.elements, 'Loading manifest...', 'Fetching stream information', 50)
    })

    this.hls.on(Hls.Events.MANIFEST_PARSED, (_event: any, data: any) => {
      updateStatus(this.elements, 'Starting playback...', `Found ${data.levels.length} quality level(s)`, 80)
      this.tryPlay()
    })

    this.hls.on(Hls.Events.FRAG_LOADED, () => {
      if (!this.elements.overlay.classList.contains('hidden')) {
        updateStatus(this.elements, 'Buffering...', 'Loading video segments', 90)
      }
    })

    video.addEventListener('playing', () => {
      console.log('Video playing event fired (HLS.js)')
      // Reset error counters on successful playback
      if (this.retryCount > 0 || this.nonFatalErrorCount > 0) {
        console.log('Playback recovered, resetting error counters')
        this.retryCount = 0
        this.nonFatalErrorCount = 0
        clearErrorLog(this.elements, this.config.maxNonFatalErrors)
      }

      hideOverlay(this.elements)
      if (video.muted) {
        showUnmuteBanner(unmuteBanner)
      }
      this.startStatsPolling()
    })

    video.addEventListener('waiting', () => {
      if (!statsBar.classList.contains('hidden')) {
        setBufferingStatus()
      }
    })

    this.hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
      console.error('HLS Error:', data)
      
      // Don't process errors if we've already reached max retries
      if (this.hasReachedMaxRetries) return

      if (data.fatal) {
        this.handleFatalError(data)
      } else {
        this.handleNonFatalError(data)
      }
    })
  }

  private handleFatalError(data: any): void {
    const { overlay } = this.elements
    const Hls = window.Hls
    const { maxRetries } = this.config

    this.retryCount++

    if (this.retryCount >= maxRetries) {
      // Max retries reached, show error
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          this.stopWithError('Network Error',
            'Failed to connect to the stream. The AceStream server may be unavailable or the stream ID may be invalid.')
          break
        case Hls.ErrorTypes.MEDIA_ERROR:
          this.stopWithError('Media Error',
            'Failed to play the stream. The stream may be corrupted or incompatible.')
          break
        default:
          this.stopWithError('Playback Error', 'An unexpected error occurred while playing the stream.')
      }
      return
    }

    // Try to recover - show retrying UI
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        showRetrying(overlay, 'Network Error', data.details || 'Connection lost', this.retryCount - 1, maxRetries)
        this.retryTimeout = setTimeout(() => {
          if (!this.hasReachedMaxRetries && this.hls) {
            this.hls.loadSource(this.playbackUrl)
          }
        }, 2000 * this.retryCount)
        break

      case Hls.ErrorTypes.MEDIA_ERROR:
        showRetrying(overlay, 'Media Error', data.details || 'Playback issue detected', this.retryCount - 1, maxRetries)
        this.hls.recoverMediaError()
        break

      default:
        this.stopWithError('Playback Error', 'An unexpected error occurred while playing the stream.')
    }
  }

  private handleNonFatalError(data: any): void {
    const { maxNonFatalErrors } = this.config

    this.nonFatalErrorCount++
    console.log(`Non-fatal error count: ${this.nonFatalErrorCount}/${maxNonFatalErrors}`)

    // Log error to UI
    logErrorToUI(this.elements, data.details || 'Unknown error', this.nonFatalErrorCount, maxNonFatalErrors)

    // Update status to show there are issues
    if (!this.elements.statsBar.classList.contains('hidden')) {
      setStatusText(`Unstable (${this.nonFatalErrorCount}/${maxNonFatalErrors})`)
    }

    if (this.nonFatalErrorCount >= maxNonFatalErrors) {
      this.stopWithError('Stream Unstable',
        'Too many errors occurred. The stream may be unavailable or experiencing issues.',
        `Last error: ${data.details || 'Multiple non-fatal errors'}`)
    }
  }

  private stopWithError(title: string, message: string, code: string | null = null): void {
    this.hasReachedMaxRetries = true
    
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval)
      this.statsInterval = null
    }
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }

    // Hide unmute banner and error log
    this.elements.unmuteBanner.classList.add('hidden')
    this.elements.errorLog.classList.add('hidden')
    
    // Update stats bar status to show error
    setStatusText('Error')
    
    showError(this.elements.overlay, title, message, code)
  }

  private tryPlay(): void {
    this.elements.video.play().catch(() => {
      // Autoplay was prevented, user needs to click play
      console.log('Autoplay prevented, waiting for user interaction')
    })
  }

  private startStatsPolling(): void {
    if (!this.statUrl) {
      console.log('Stats polling disabled: no statUrl available')
      return
    }

    console.log('Starting stats polling with URL:', this.statUrl)
    
    // Fetch immediately
    this.pollStats()

    // Then poll periodically
    this.statsInterval = setInterval(() => this.pollStats(), this.config.statsPollingInterval)
  }

  private async pollStats(): Promise<void> {
    if (!this.statUrl) return
    
    const stats = await fetchStats(this.statUrl)
    if (stats) {
      console.log('Stats received:', stats)
      updateStats(stats as StreamStats)
    }
  }

  destroy(): void {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout)
      this.retryTimeout = null
    }
    if (this.statsInterval) {
      clearInterval(this.statsInterval)
      this.statsInterval = null
    }
    if (this.hls) {
      this.hls.destroy()
      this.hls = null
    }
  }
}
