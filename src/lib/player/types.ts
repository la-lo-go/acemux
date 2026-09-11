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
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  maxRetries: 3,
  maxNonFatalErrors: 3,
  statsPollingInterval: 3000,
}
