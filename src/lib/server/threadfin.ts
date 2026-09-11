/**
 * Threadfin integration: trigger a playlist/EPG refresh when AceMux changes.
 *
 * Threadfin exposes an internal WebSocket at `/data/` used by its web UI. We
 * reuse its `saveFiles` command so adding/removing a stream is reflected in
 * Threadfin (and therefore in Plex) without waiting for its schedule.
 */

export function threadfinBase(): string {
  return (process.env.THREADFIN_URL ?? 'http://threadfin:34400').replace(/\/+$/, '')
}

/**
 * Fire-and-forget refresh of Threadfin. Never throws and never blocks the
 * request: if Threadfin is not reachable the change still succeeds locally.
 */
export function notifyThreadfinUpdate(): void {
  const base = threadfinBase()
  if (!base) return

  const wsUrl = `${base.replace(/^http/, 'ws')}/data/?Token=`

  try {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => {
      try {
        ws.close()
      } catch {
        // ignore
      }
    }, 3000)

    const done = () => clearTimeout(timer)

    let responses = 0
    ws.addEventListener('open', () => {
      try {
        ws.send(JSON.stringify({ cmd: 'updateFileM3U' }))
      } catch {
        // ignore
      }
    })
    ws.addEventListener('message', () => {
      responses++
      if (responses === 1) {
        try {
          ws.send(JSON.stringify({ cmd: 'updateFileXMLTV' }))
        } catch {
          // ignore
        }
        return
      }
      done()
      try {
        ws.close()
      } catch {
        // ignore
      }
    })
    ws.addEventListener('error', done)
    ws.addEventListener('close', done)
  } catch {
    // WebSocket not available or invalid URL: ignore
  }
}
