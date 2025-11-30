/**
 * Player-related type definitions
 */

export interface StreamStats {
  peers?: number
  speed_down?: number
  speed_up?: number
  status?: 'prebuf' | 'dl' | string
  downloaded?: number
  uploaded?: number
  total_progress?: number
}

export interface AceStreamJsonResponse {
  response?: {
    playback_url?: string
    stat_url?: string
    command_url?: string
    event_url?: string
  }
  playback_url?: string
  stat_url?: string
  error?: string
}

export interface PlayerElements {
  video: HTMLVideoElement
  overlay: HTMLElement
  statusText: HTMLElement
  statusDetail: HTMLElement
  progressFill: HTMLElement
  statsBar: HTMLElement
  unmuteBanner: HTMLElement
  errorLog: HTMLElement
  errorIcon: HTMLElement
  errorText: HTMLElement
  errorCounter: HTMLElement
}

export interface PlayerConfig {
  maxRetries: number
  maxNonFatalErrors: number
  statsPollingInterval: number
  hlsConfig: HlsConfig
}

export interface HlsConfig {
  liveDurationInfinity: boolean
  liveBackBufferLength: number
  maxBufferLength: number
  maxMaxBufferLength: number
  manifestLoadingTimeOut: number
  manifestLoadingMaxRetry: number
  manifestLoadingRetryDelay: number
  levelLoadingTimeOut: number
  levelLoadingMaxRetry: number
  levelLoadingRetryDelay: number
  fragLoadingTimeOut: number
  fragLoadingMaxRetry: number
  fragLoadingRetryDelay: number
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  maxRetries: 3,
  maxNonFatalErrors: 3,
  statsPollingInterval: 3000,
  hlsConfig: {
    liveDurationInfinity: true,
    liveBackBufferLength: 0,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    manifestLoadingTimeOut: 10000,
    manifestLoadingMaxRetry: 2,
    manifestLoadingRetryDelay: 1000,
    levelLoadingTimeOut: 10000,
    levelLoadingMaxRetry: 2,
    levelLoadingRetryDelay: 1000,
    fragLoadingTimeOut: 10000,
    fragLoadingMaxRetry: 2,
    fragLoadingRetryDelay: 1000,
  }
}
