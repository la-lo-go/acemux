/**
 * AceStream API integration
 */

import type { AceStreamJsonResponse } from './types'

/**
 * Build the AceStream manifest URLs
 */
export function buildStreamUrls(streamId: string): { jsonSrc: string; hlsSrc: string } {
  const encodedId = encodeURIComponent(streamId)
  return {
    jsonSrc: `/ace/manifest.m3u8?id=${encodedId}&format=json`,
    hlsSrc: `/ace/manifest.m3u8?id=${encodedId}`
  }
}

/**
 * Convert internal AceStream URLs to proxied URLs
 */
export function proxyUrl(url: string | undefined): string | undefined {
  if (!url) return url
  // Replace any internal IP:port combinations with our proxy
  return url.replace(/http:\/\/[^/]+:6878/g, '')
}

/**
 * Fetch stream info with JSON format to get additional URLs
 */
export async function fetchStreamInfo(jsonSrc: string, hlsSrc: string): Promise<{
  playbackUrl: string
  statUrl: string | null
}> {
  try {
    //console.log('Fetching stream info from:', jsonSrc)
    const response = await fetch(jsonSrc)
    
    if (!response.ok) {
      console.log('JSON format not available (status:', response.status, '), using direct HLS')
      return { playbackUrl: hlsSrc, statUrl: null }
    }

    const data: AceStreamJsonResponse = await response.json()
    //console.log('Stream info response:', data)

    if (data.error) {
      throw new Error(data.error)
    }

    const playbackUrl = proxyUrl(
      data.response?.playback_url || data.playback_url
    ) || hlsSrc

    const statUrl = proxyUrl(
      data.response?.stat_url || data.stat_url
    ) || null

    //console.log('Processed URLs - playbackUrl:', playbackUrl, 'statUrl:', statUrl)
    return { playbackUrl, statUrl }
  } catch (error) {
    //console.log('JSON format not available, using direct HLS:', error)
    return { playbackUrl: hlsSrc, statUrl: null }
  }
}

/**
 * Fetch stream statistics
 */
export async function fetchStats(statUrl: string): Promise<{
  peers?: number
  speed_down?: number
  speed_up?: number
  status?: string
} | null> {
  try {
    const response = await fetch(statUrl)
    if (!response.ok) return null

    const data = await response.json()
    return data.response || data
  } catch (error) {
    console.warn('Stats fetch error:', error)
    return null
  }
}
