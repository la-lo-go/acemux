/**
 * HLS Video Element player wrapper
 * Uses hls-video-element custom element for HLS playback
 */

import type { PlayerElements, PlayerConfig, StreamStats, HlsVideoElement } from './types'
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
import { Hls } from 'hls-video-element'

export class AceStreamPlayer {
  private elements: PlayerElements
  private config: PlayerConfig
  private streamId: string
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

  private get hlsVideo(): HlsVideoElement {
    return this.elements.video as HlsVideoElement
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
    const { overlay } = this.elements
    const { jsonSrc, hlsSrc } = buildStreamUrls(this.streamId)

    updateStatus(this.elements, 'Connecting to AceStream...', 'Requesting stream manifest', 10)

    try {
      updateStatus(this.elements, 'Initializing stream...', 'Waiting for AceStream engine', 20)
      
      const { playbackUrl, statUrl } = await fetchStreamInfo(jsonSrc, hlsSrc)
      this.playbackUrl = playbackUrl
      this.statUrl = statUrl

      updateStatus(this.elements, 'Prebuffering...', 'AceStream is loading the content', 40)

      this.initHlsVideo()
    } catch (error) {
      console.error('Stream initialization error:', error)
      showError(overlay, 'Connection Error',
        'Failed to initialize the stream. Make sure AceStream Engine is running.',
        error instanceof Error ? error.message : String(error))
    }
  }

  private initHlsVideo(): void {
    const { video, overlay, unmuteBanner, statsBar } = this.elements
    const hlsVideo = this.hlsVideo

    // Configure hls.js options via the config property
    hlsVideo.config = this.config.hlsConfig

    // Set the source - hls-video-element handles both native HLS and hls.js
    hlsVideo.src = this.playbackUrl

    // Wait for the hls.js API to be available and set up event handlers
    this.setupHlsEventHandlers()

    // Standard video events work on hls-video-element
    video.addEventListener('loadedmetadata', () => {
      updateStatus(this.elements, 'Starting playback...', 'Stream loaded', 80)
      this.tryPlay()
    })

    video.addEventListener('playing', () => {
      // Reset error counters on successful playback
      if (this.retryCount > 0 || this.nonFatalErrorCount > 0) {
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

    video.addEventListener('error', () => {
      if (this.hasReachedMaxRetries) return
      
      const errorMessage = video.error?.message || 'Unknown playback error'
      console.error('Video Error:', errorMessage)
      showError(overlay, 'Playback Error', 'Failed to load the stream', errorMessage)
    })
  }

  private setupHlsEventHandlers(): void {
    const hlsVideo = this.hlsVideo

    // Poll for api availability since it's set asynchronously
    const checkApi = () => {
      if (hlsVideo.api) {
        this.attachHlsEvents(hlsVideo.api)
      } else {
        // Check again after a short delay
        setTimeout(checkApi, 50)
      }
    }
    checkApi()
  }

  private attachHlsEvents(hls: typeof Hls.prototype): void {
    hls.on(Hls.Events.MANIFEST_LOADING, () => {
      updateStatus(this.elements, 'Loading manifest...', 'Fetching stream information', 50)
    })

    hls.on(Hls.Events.MANIFEST_PARSED, (_event: string, data: any) => {
      updateStatus(this.elements, 'Starting playback...', `Found ${data.levels.length} quality level(s)`, 80)
    })

    hls.on(Hls.Events.FRAG_LOADED, () => {
      if (!this.elements.overlay.classList.contains('hidden')) {
        updateStatus(this.elements, 'Buffering...', 'Loading video segments', 90)
      }
    })

    hls.on(Hls.Events.ERROR, (_event: string, data: any) => {
      console.error('HLS Error:', data)
      
      // Don't process errors if we've already reached max retries
      if (this.hasReachedMaxRetries) return

      if (data.fatal) {
        this.handleFatalError(data, hls)
      } else {
        this.handleNonFatalError(data)
      }
    })
  }

  private handleFatalError(data: any, hls: typeof Hls.prototype): void {
    const { overlay } = this.elements
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
          if (!this.hasReachedMaxRetries && hls) {
            hls.loadSource(this.playbackUrl)
          }
        }, 2000 * this.retryCount)
        break

      case Hls.ErrorTypes.MEDIA_ERROR:
        showRetrying(overlay, 'Media Error', data.details || 'Playback issue detected', this.retryCount - 1, maxRetries)
        hls.recoverMediaError()
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

    // The hls-video-element handles cleanup internally when src is removed or element is disconnected
    const hlsVideo = this.hlsVideo
    if (hlsVideo.api) {
      hlsVideo.api.destroy()
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
    })
  }

  private startStatsPolling(): void {
    if (!this.statUrl) {
      return
    }
    
    // Fetch immediately
    this.pollStats()

    // Then poll periodically
    this.statsInterval = setInterval(() => this.pollStats(), this.config.statsPollingInterval)
  }

  private async pollStats(): Promise<void> {
    if (!this.statUrl) return
    
    const stats = await fetchStats(this.statUrl)
    if (stats) {
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
    
    // The hls-video-element handles cleanup internally
    const hlsVideo = this.hlsVideo
    if (hlsVideo.api) {
      hlsVideo.api.destroy()
    }
  }
}
