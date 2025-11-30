/**
 * Player UI utility functions
 */

import type { PlayerElements, StreamStats } from './types'

/**
 * Get all player DOM elements
 */
export function getPlayerElements(): PlayerElements | null {
  const video = document.getElementById('player') as HTMLVideoElement
  const overlay = document.getElementById('overlay')
  const statusText = document.getElementById('statusText')
  const statusDetail = document.getElementById('statusDetail')
  const progressFill = document.getElementById('progressFill')
  const statsBar = document.getElementById('statsBar')
  const unmuteBanner = document.getElementById('unmuteBanner')
  const errorLog = document.getElementById('errorLog')
  const errorIcon = document.getElementById('errorIcon')
  const errorText = document.getElementById('errorText')
  const errorCounter = document.getElementById('errorCounter')

  const missing: string[] = []
  if (!video) missing.push('player')
  if (!overlay) missing.push('overlay')
  if (!statusText) missing.push('statusText')
  if (!statusDetail) missing.push('statusDetail')
  if (!progressFill) missing.push('progressFill')
  if (!statsBar) missing.push('statsBar')
  if (!unmuteBanner) missing.push('unmuteBanner')
  if (!errorLog) missing.push('errorLog')
  if (!errorIcon) missing.push('errorIcon')
  if (!errorText) missing.push('errorText')
  if (!errorCounter) missing.push('errorCounter')

  if (missing.length > 0) {
    console.error('Missing player elements:', missing.join(', '))
    return null
  }

  return { 
    video, overlay, statusText, statusDetail, progressFill, 
    statsBar, unmuteBanner, errorLog, errorIcon, errorText, errorCounter 
  } as PlayerElements
}

/**
 * Update the loading status display
 */
export function updateStatus(
  elements: Pick<PlayerElements, 'statusText' | 'statusDetail' | 'progressFill'>,
  text: string,
  detail: string,
  progress: number | null = null
): void {
  elements.statusText.textContent = text
  elements.statusDetail.textContent = detail
  if (progress !== null) {
    elements.progressFill.style.width = `${Math.min(100, progress)}%`
  }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

/**
 * Show an error message in the overlay
 */
export function showError(
  overlay: HTMLElement,
  title: string,
  message: string,
  code: string | null = null
): void {
  // Hide unmute banner when showing error
  const unmuteBanner = document.getElementById('unmuteBanner')
  if (unmuteBanner) unmuteBanner.classList.add('hidden')

  overlay.innerHTML = `
    <div class="error-box">
      <h3 class="error-title">${escapeHtml(title)}</h3>
      <p class="error-message">${escapeHtml(message)}</p>
      ${code ? `<code class="error-code">${escapeHtml(code)}</code>` : ''}
      <button class="retry-btn" onclick="window.location.reload()">Retry</button>
    </div>
  `
  overlay.classList.remove('hidden')
}

/**
 * Show retry UI with progress dots
 */
export function showRetrying(
  overlay: HTMLElement,
  errorType: string,
  errorDetail: string,
  currentRetry: number,
  maxRetry: number
): void {
  const retryDots = Array(maxRetry).fill(null).map((_, i) => {
    if (i < currentRetry) return '<span class="retry-dot completed"></span>'
    if (i === currentRetry) return '<span class="retry-dot active"></span>'
    return '<span class="retry-dot"></span>'
  }).join('')

  overlay.innerHTML = `
    <div class="retry-box">
      <div class="retry-icon">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2.25V4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M12 19.5V21.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3"/>
          <path d="M4.5 12H2.25" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.5"/>
          <path d="M21.75 12H19.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.7"/>
          <path d="M5.63604 5.63604L7.17157 7.17157" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.9"/>
          <path d="M16.8284 16.8284L18.364 18.364" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
          <path d="M5.63604 18.364L7.17157 16.8284" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
          <path d="M16.8284 7.17157L18.364 5.63604" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.8"/>
        </svg>
      </div>
      <h3 class="retry-title">${escapeHtml(errorType)}</h3>
      <p class="retry-detail">${escapeHtml(errorDetail)}</p>
      <div class="retry-progress">
        <span class="retry-label">Retrying...</span>
        <div class="retry-dots">${retryDots}</div>
        <span class="retry-count">${currentRetry + 1} / ${maxRetry}</span>
      </div>
    </div>
  `
  overlay.classList.remove('hidden')
}

/**
 * Hide the loading overlay and show stats bar
 */
export function hideOverlay(elements: Pick<PlayerElements, 'overlay' | 'statsBar'>): void {
  console.log('hideOverlay called - showing statsBar')
  elements.overlay.classList.add('hidden')
  elements.statsBar.classList.remove('hidden')
  console.log('statsBar hidden class removed, classList:', elements.statsBar.classList.toString())
}

/**
 * Show the unmute banner
 */
export function showUnmuteBanner(unmuteBanner: HTMLElement): void {
  unmuteBanner.classList.remove('hidden')
}

/**
 * Update stream statistics display
 */
export function updateStats(stats: StreamStats): void {
  console.log('updateStats called with:', stats)
  const statPeers = document.getElementById('statPeers')
  const statDown = document.getElementById('statDown')
  const statUp = document.getElementById('statUp')
  const statStatus = document.getElementById('statStatus')

  console.log('Stats elements found:', {
    statPeers: !!statPeers,
    statDown: !!statDown,
    statUp: !!statUp,
    statStatus: !!statStatus
  })

  if (statPeers) statPeers.textContent = String(stats.peers ?? '-')
  if (statDown) statDown.textContent = String(stats.speed_down ?? '-')
  if (statUp) statUp.textContent = String(stats.speed_up ?? '-')
  if (statStatus) {
    statStatus.textContent = stats.status === 'dl' ? 'Playing' :
      stats.status === 'prebuf' ? 'Buffering' : stats.status || '-'
  }
}

/**
 * Set status to buffering
 */
export function setBufferingStatus(): void {
  const statStatus = document.getElementById('statStatus')
  if (statStatus) {
    statStatus.textContent = 'Buffering...'
  }
}

/**
 * Set status text (for custom status messages)
 */
export function setStatusText(text: string): void {
  const statStatus = document.getElementById('statStatus')
  if (statStatus) {
    statStatus.textContent = text
  }
}

// SVG icon paths for error log
const WARNING_ICON_PATH = '<path fill-rule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd" />'
const CRITICAL_ICON_PATH = '<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" />'

/**
 * Log error to the error pill UI
 */
export function logErrorToUI(
  elements: Pick<PlayerElements, 'errorLog' | 'errorIcon' | 'errorText' | 'errorCounter'>,
  details: string,
  currentCount: number,
  maxCount: number
): void {
  const { errorLog, errorIcon, errorText, errorCounter } = elements

  // Show error log pill
  errorLog.classList.remove('hidden')

  // Update text and counter
  errorText.textContent = details
  errorCounter.textContent = `${currentCount}/${maxCount}`

  // Update styling based on severity
  const isCritical = currentCount >= maxCount - 1
  if (isCritical) {
    errorLog.classList.add('critical')
    errorIcon.innerHTML = CRITICAL_ICON_PATH
  } else {
    errorLog.classList.remove('critical')
    errorIcon.innerHTML = WARNING_ICON_PATH
  }
}

/**
 * Clear the error log UI
 */
export function clearErrorLog(
  elements: Pick<PlayerElements, 'errorLog' | 'errorText' | 'errorCounter'>,
  maxCount: number
): void {
  const { errorLog, errorText, errorCounter } = elements
  
  errorLog.classList.add('hidden')
  errorLog.classList.remove('critical')
  errorText.textContent = '-'
  errorCounter.textContent = `0/${maxCount}`
}
