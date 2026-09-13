/**
 * Home page functionality: stream management, views and status checking.
 *
 * Two independent presentations share the same data and action attributes:
 *  - #cardsView  -> gallery cards (.stream-card.view-item)
 *  - #tableView  -> real <table> rows (tr.stream-row.view-item + tr.edit-row)
 * Only the active panel is queried, so both stay independent.
 */

declare global {
  interface Window {
    aceStreamBase: string
    aceMuxToken?: string
  }
}

type ToastType = 'ok' | 'error' | 'info'

const TOAST_TONES: Record<ToastType, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  error: 'border-rose-500/40 bg-rose-500/10 text-rose-200',
  info: 'border-slate-600/50 bg-slate-700/30 text-slate-200'
}

function showToast(message: string, type: ToastType = 'info'): void {
  const container = document.getElementById('toasts')
  if (!container) return

  const toast = document.createElement('div')
  toast.className =
    'pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ' +
    'transition-all duration-300 opacity-0 translate-y-2 ' +
    TOAST_TONES[type]
  toast.textContent = message
  container.appendChild(toast)

  requestAnimationFrame(() => toast.classList.remove('opacity-0', 'translate-y-2'))

  setTimeout(() => {
    toast.classList.add('opacity-0', 'translate-y-2')
    setTimeout(() => toast.remove(), 300)
  }, 4000)
}

async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through
    }
  }

  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.top = '-9999px'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ */
/* View helpers                                                        */
/* ------------------------------------------------------------------ */

function activeRoot(): ParentNode {
  return document.querySelector('.view-panel.view-active') ?? document
}

function findItem(streamId: string): Element | null {
  return activeRoot().querySelector(`.view-item[data-id="${CSS.escape(streamId)}"]`)
}

function findEdit(streamId: string): HTMLElement | null {
  return activeRoot().querySelector(`[data-editform][data-id="${CSS.escape(streamId)}"]`)
}

function indicatorOf(streamId: string): HTMLElement | null {
  return (findItem(streamId)?.querySelector('.status-indicator') as HTMLElement | null) ?? null
}

/**
 * Show/hide the editor for an item. Cards hide their [data-view] block; table
 * rows hide themselves and reveal the following edit row.
 */
function setEdit(streamId: string, editing: boolean): void {
  const item = findItem(streamId)
  const edit = findEdit(streamId)
  if (!item || !edit) return

  const isRow = item.tagName === 'TR'

  if (editing) {
    if (isRow) {
      item.setAttribute('hidden', '')
      edit.removeAttribute('hidden')
    } else {
      item.querySelector('[data-view]')?.setAttribute('hidden', '')
      edit.removeAttribute('hidden')
    }
  } else {
    if (isRow) {
      item.removeAttribute('hidden')
      edit.setAttribute('hidden', '')
    } else {
      item.querySelector('[data-view]')?.removeAttribute('hidden')
      edit.setAttribute('hidden', '')
    }
  }
}

function openEdit(streamId: string): void {
  activeRoot().querySelectorAll('.view-item[data-id]').forEach((el) => {
    const id = el.getAttribute('data-id')
    if (id && id !== streamId) setEdit(id, false)
  })
  setEdit(streamId, true)
}

/* ------------------------------------------------------------------ */
/* Create form                                                         */
/* ------------------------------------------------------------------ */

function initCreateForm(): void {
  const showCreateBtn = document.getElementById('showCreate')
  const cancelCreateBtn = document.getElementById('cancelCreate')
  const createWrapper = document.getElementById('createWrapper')

  if (showCreateBtn && createWrapper) {
    showCreateBtn.addEventListener('click', () => {
      createWrapper.classList.remove('hidden')
      createWrapper.classList.add('animate-slideUp')
      showCreateBtn.style.display = 'none'
    })
  }

  if (cancelCreateBtn && createWrapper && showCreateBtn) {
    cancelCreateBtn.addEventListener('click', () => {
      const createForm = document.getElementById('create') as HTMLFormElement | null
      createForm?.reset()
      createWrapper.classList.add('hidden')
      showCreateBtn.style.display = 'block'
    })
  }
}

function initCreateFormSubmit(): void {
  const createForm = document.getElementById('create') as HTMLFormElement | null
  const errorEl = document.getElementById('err')
  if (!createForm) return

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault()
    const formData = new FormData(createForm)
    const data: Record<string, unknown> = Object.fromEntries(formData)
    data.enabled = formData.has('enabled')
    if (errorEl) errorEl.hidden = true

    try {
      const res = await fetch('/api/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })

      if (res.ok) {
        showToast('Stream added', 'ok')
        createForm.reset()
        document.getElementById('createWrapper')?.classList.add('hidden')
        const showCreate = document.getElementById('showCreate')
        if (showCreate) showCreate.style.display = 'block'
        await refreshView()
      } else {
        const error = (await res.json().catch(() => ({}))) as { error?: string }
        if (errorEl) {
          errorEl.textContent = error.error || 'Error creating stream'
          errorEl.hidden = false
        }
      }
    } catch {
      if (errorEl) {
        errorEl.textContent = 'Network error'
        errorEl.hidden = false
      }
    }
  })
}

/* ------------------------------------------------------------------ */
/* Status checking                                                     */
/* ------------------------------------------------------------------ */

type StreamStatus = 'online' | 'offline' | 'checking' | 'unknown'

interface StatusResult {
  status: StreamStatus
  title: string
  detail: string
}

interface SessionStats {
  active?: boolean
  peers?: number | null
  speed_down?: number | null
  status?: string | null
}

interface TestResponse {
  ok?: boolean
  bytes?: number
  peers?: number | null
  speed_down?: number | null
  status?: string | null
  serviceName?: string | null
  serviceProvider?: string | null
  reason?: string
}

const TEST_CACHE_TTL_MS = 3 * 60_000
const LIVE_REFRESH_MS = 30_000
const REQUEST_TIMEOUT_MS = 22_000

const statusCache = new Map<string, { at: number; result: StatusResult }>()

let liveInterval: ReturnType<typeof setInterval> | null = null
let autoTestRunning = false

function setIndicatorStatus(indicator: HTMLElement, status: StreamStatus, title: string, detail?: string): void {
  indicator.setAttribute('data-status', status)
  indicator.setAttribute('title', detail ? `${title}\n${detail}` : title)
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

function fmt(peers: number, speedDown: number): string {
  const info: string[] = []
  if (peers > 0) info.push(`${peers} peer${peers !== 1 ? 's' : ''}`)
  if (speedDown > 0) info.push(`${speedDown} KB/s`)
  return info.join(' · ')
}

function sessionToStatus(session: SessionStats): StatusResult {
  const peers = session.peers ?? 0
  const speedDown = session.speed_down ?? 0
  const streamStatus = session.status ?? ''
  const detail = fmt(peers, speedDown)

  if (peers > 0) return { status: 'online', title: 'Working', detail: detail || 'Streaming' }
  if (streamStatus === 'prebuf') return { status: 'unknown', title: 'Prebuffering', detail: 'Looking for peers…' }
  return { status: 'unknown', title: 'Connecting', detail: detail || 'No peers yet' }
}

function testToStatus(data: TestResponse): StatusResult {
  const peers = data.peers ?? 0
  const speedDown = data.speed_down ?? 0
  const detail = [fmt(peers, speedDown), data.bytes ? `${Math.round(data.bytes / 1024)} KB` : '']
    .filter(Boolean)
    .join(' · ')
  const name = data.serviceName
    ? `${data.serviceName}${data.serviceProvider ? ` (${data.serviceProvider})` : ''}`
    : null

  if (data.ok) return { status: 'online', title: name ?? 'Working', detail: detail || 'Stream OK' }
  return { status: 'offline', title: 'Not working', detail: data.reason || 'No data received' }
}

function paintIndicator(streamId: string, result: StatusResult): void {
  const indicator = indicatorOf(streamId)
  if (indicator) setIndicatorStatus(indicator, result.status, result.title, result.detail)
}

function markChecking(streamId: string): void {
  const indicator = indicatorOf(streamId)
  if (indicator) setIndicatorStatus(indicator, 'checking', 'Testing…')
}

async function runStreamTest(streamId: string): Promise<StatusResult> {
  const data = await fetchJson<TestResponse>(`/api/test/${encodeURIComponent(streamId)}`)
  const result: StatusResult = data
    ? testToStatus(data)
    : { status: 'offline', title: 'Test failed', detail: 'No response' }

  statusCache.set(streamId, { at: Date.now(), result })
  paintIndicator(streamId, result)
  return result
}

function itemsOfActiveView(): Element[] {
  return Array.from(activeRoot().querySelectorAll('.view-item[data-id]'))
}

function paintCachedStatuses(): void {
  itemsOfActiveView().forEach((item) => {
    const streamId = item.getAttribute('data-id')
    if (!streamId) return
    const indicator = item.querySelector('.status-indicator') as HTMLElement | null
    if (!indicator) return
    const cached = statusCache.get(streamId)
    if (cached) {
      setIndicatorStatus(indicator, cached.result.status, cached.result.title, cached.result.detail)
    } else {
      setIndicatorStatus(indicator, 'unknown', 'Not tested', 'Click to test')
    }
  })
}

async function refreshLiveStatuses(): Promise<void> {
  for (const item of itemsOfActiveView()) {
    const streamId = item.getAttribute('data-id')
    if (!streamId) continue
    const session = await fetchJson<SessionStats>(`/api/sessions/${encodeURIComponent(streamId)}`)
    if (session?.active) {
      const result = sessionToStatus(session)
      statusCache.set(streamId, { at: Date.now(), result })
      paintIndicator(streamId, result)
    }
  }
}

async function runAutoTests(): Promise<void> {
  if (autoTestRunning) return
  autoTestRunning = true
  try {
    for (const item of itemsOfActiveView()) {
      const streamId = item.getAttribute('data-id')
      if (!streamId) continue
      if (!item.querySelector('.status-indicator')) continue

      const session = await fetchJson<SessionStats>(`/api/sessions/${encodeURIComponent(streamId)}`)
      if (session?.active) {
        const result = sessionToStatus(session)
        statusCache.set(streamId, { at: Date.now(), result })
        paintIndicator(streamId, result)
        continue
      }

      const cached = statusCache.get(streamId)
      if (cached && Date.now() - cached.at < TEST_CACHE_TTL_MS) {
        paintIndicator(streamId, cached.result)
        continue
      }

      markChecking(streamId)
      await runStreamTest(streamId)
    }
  } finally {
    autoTestRunning = false
  }
}

function initStreamStatusChecks(): void {
  if (liveInterval !== null) clearInterval(liveInterval)

  itemsOfActiveView().forEach((item) => {
    const indicator = item.querySelector('.status-indicator') as HTMLElement | null
    if (indicator) setIndicatorStatus(indicator, 'unknown', 'Not tested', 'Click to test')
  })

  setTimeout(() => {
    void refreshLiveStatuses().then(() => runAutoTests())
  }, 300)

  liveInterval = setInterval(() => void refreshLiveStatuses(), LIVE_REFRESH_MS)
}

/* ------------------------------------------------------------------ */
/* Stream mutations                                                    */
/* ------------------------------------------------------------------ */

async function handleSave(streamId: string | null, editEl: Element | null): Promise<void> {
  if (!streamId || !editEl) return

  const data: Record<string, string> = {}
  editEl.querySelectorAll('input').forEach((input) => {
    if (input instanceof HTMLInputElement) {
      data[input.name] = input.type === 'checkbox' ? String(input.checked) : input.value
    }
  })

  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })

    if (res.ok) {
      showToast('Stream updated', 'ok')
      await refreshView()
    } else {
      const error = (await res.json().catch(() => ({}))) as { error?: string }
      showToast(error.error || 'Error updating stream', 'error')
    }
  } catch {
    showToast('Network error', 'error')
  }
}

async function handleDelete(streamId: string | null): Promise<void> {
  if (!streamId) return
  if (!confirm('Delete this stream?')) return

  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, { method: 'DELETE' })
    if (res.ok) {
      showToast('Stream deleted', 'ok')
      await refreshView()
    } else {
      showToast('Error deleting stream', 'error')
    }
  } catch {
    showToast('Network error', 'error')
  }
}

async function handleCopyStream(btn: Element): Promise<void> {
  const base = btn.getAttribute('data-url')
  if (!base) return
  const url = window.aceMuxToken ? `${base}?token=${encodeURIComponent(window.aceMuxToken)}` : base
  const ok = await copyText(url)
  showToast(ok ? 'Stream URL copied' : 'Could not copy stream URL', ok ? 'ok' : 'error')
}

async function handleFavoriteToggle(streamId: string, item: Element): Promise<void> {
  try {
    const res = await fetch(`/api/streams/${encodeURIComponent(streamId)}`, { method: 'PATCH' })
    if (!res.ok) return
    const updated = (await res.json()) as { is_favorite?: number }
    const isFav = updated.is_favorite === 1
    item.setAttribute('data-favorite', isFav ? '1' : '0')
    item.querySelectorAll('[data-favorite-btn]').forEach((btn) => btn.classList.toggle('is-fav', isFav))
    applySort()
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------ */
/* Search & sort                                                       */
/* ------------------------------------------------------------------ */

function applySort(): void {
  const select = document.getElementById('sortSelect') as HTMLSelectElement | null
  const mode = select?.value ?? 'default'
  if (mode === 'default') return

  const cmp = (a: Element, b: Element): number => {
    if (mode === 'favorites') {
      const af = a.getAttribute('data-favorite') === '1' ? 0 : 1
      const bf = b.getAttribute('data-favorite') === '1' ? 0 : 1
      if (af !== bf) return af - bf
    }
    const an = a.getAttribute('data-name') ?? ''
    const bn = b.getAttribute('data-name') ?? ''
    if (mode === 'name-asc') return an.localeCompare(bn)
    if (mode === 'name-desc') return bn.localeCompare(an)

    const ac = a.getAttribute('data-created') ?? ''
    const bc = b.getAttribute('data-created') ?? ''
    if (mode === 'oldest') return ac.localeCompare(bc)
    return bc.localeCompare(ac)
  }

  const items = itemsOfActiveView()
  if (items.length === 0) return
  const parent = items[0].parentElement
  if (!parent) return

  items.sort(cmp)
  for (const item of items) {
    parent.appendChild(item)
    const id = item.getAttribute('data-id')
    if (!id) continue
    const edit = parent.querySelector(`[data-editform][data-id="${CSS.escape(id)}"]`)
    if (edit && !item.contains(edit)) parent.appendChild(edit)
  }
}

function initSort(): void {
  document.getElementById('sortSelect')?.addEventListener('change', applySort)
}

function initSearch(): void {
  const input = document.getElementById('searchInput') as HTMLInputElement | null
  if (!input) return

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim()
    let visible = 0

    itemsOfActiveView().forEach((item) => {
      const match = !q || (item.getAttribute('data-name') ?? '').includes(q)
      item.classList.toggle('hidden', !match)
      if (match) visible++
    })

    const cardsActive = document.getElementById('cardsView')?.classList.contains('view-active') ?? false
    document.getElementById('noResults')?.classList.toggle('hidden', !(cardsActive && visible === 0 && q.length > 0))
  })
}

/* ------------------------------------------------------------------ */
/* Delegated interactions                                              */
/* ------------------------------------------------------------------ */

function initItemActions(): void {
  document.addEventListener('click', async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const item = target.closest('.view-item')
    if (!item) return

    const streamId = item.getAttribute('data-id')
    const editEl = streamId ? findEdit(streamId) : null

    if (target.closest('[data-check]')) {
      if (streamId) {
        markChecking(streamId)
        await runStreamTest(streamId)
      }
      return
    }

    if (target.closest('[data-select]')) {
      updateBulkBar()
      return
    }

    if (target.closest('[data-edit]')) {
      if (streamId) openEdit(streamId)
    } else if (target.closest('[data-cancel]')) {
      if (streamId) setEdit(streamId, false)
    } else if (target.closest('[data-save]')) {
      await handleSave(streamId, editEl)
    } else if (target.closest('[data-delete]')) {
      await handleDelete(streamId)
    } else if (target.closest('[data-copy-stream]')) {
      await handleCopyStream(target.closest('[data-copy-stream]') as Element)
    } else if (target.closest('[data-favorite-btn]')) {
      if (streamId) await handleFavoriteToggle(streamId, item)
    } else if (!target.closest('a, button, input, label, [data-editform]')) {
      if (streamId) window.location.href = `/${encodeURIComponent(streamId)}`
    }
  })
}

/* ------------------------------------------------------------------ */
/* Bulk selection                                                      */
/* ------------------------------------------------------------------ */

function updateBulkBar(): void {
  const bulkBar = document.getElementById('bulkBar')
  const bulkCount = document.getElementById('bulkCount')
  if (!bulkBar) return

  const selected = activeRoot().querySelectorAll('[data-select]:checked')

  if (selected.length > 0) {
    bulkBar.classList.remove('hidden')
    bulkBar.classList.add('flex')
    if (bulkCount) bulkCount.textContent = `${selected.length} selected`
  } else {
    bulkBar.classList.add('hidden')
    bulkBar.classList.remove('flex')
  }
}

function clearSelection(): void {
  activeRoot().querySelectorAll<HTMLInputElement>('[data-select]').forEach((checkbox) => {
    checkbox.checked = false
  })
  updateBulkBar()
}

function initBulkActions(): void {
  document.getElementById('bulkClear')?.addEventListener('click', () => clearSelection())

  document.getElementById('bulkDelete')?.addEventListener('click', async () => {
    const ids = Array.from(activeRoot().querySelectorAll<HTMLInputElement>('[data-select]:checked'))
      .map((checkbox) => checkbox.closest('.view-item')?.getAttribute('data-id') || '')
      .filter((id) => id.length > 0)

    if (ids.length === 0) return
    if (!confirm(`Delete ${ids.length} stream${ids.length !== 1 ? 's' : ''}?`)) return

    try {
      const res = await fetch('/api/streams/bulk-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      })

      if (res.ok) {
        const data = (await res.json()) as { deleted?: number }
        const deleted = data.deleted ?? 0
        showToast(`Deleted ${deleted} stream${deleted !== 1 ? 's' : ''}`, 'ok')
        await refreshView()
      } else {
        showToast('Bulk delete failed', 'error')
      }
    } catch {
      showToast('Bulk delete failed', 'error')
    }
  })
}

/* ------------------------------------------------------------------ */
/* View selector                                                       */
/* ------------------------------------------------------------------ */

type ViewMode = 'cards' | 'compact'
const VIEW_STORAGE_KEY = 'acemux:view'

function applyView(mode: ViewMode): void {
  const showCards = mode === 'cards'

  const cards = document.getElementById('cardsView')
  const table = document.getElementById('tableView')
  cards?.classList.toggle('view-active', showCards)
  cards?.classList.toggle('hidden', !showCards)
  table?.classList.toggle('view-active', !showCards)
  table?.classList.toggle('hidden', showCards)

  const buttons: Array<[HTMLElement | null, boolean]> = [
    [document.getElementById('viewCards'), showCards],
    [document.getElementById('viewCompact'), !showCards]
  ]

  for (const [el, active] of buttons) {
    if (!el) continue
    el.classList.remove('text-sky-300', 'text-slate-500', 'hover:text-slate-300')
    if (active) el.classList.add('text-sky-300')
    else el.classList.add('text-slate-500', 'hover:text-slate-300')
  }

  paintCachedStatuses()
  clearSelection()
}

function initViewToggle(): void {
  const urlView = new URLSearchParams(window.location.search).get('view')
  const stored = localStorage.getItem(VIEW_STORAGE_KEY)
  const mode: ViewMode =
    urlView === 'compact' || urlView === 'cards' ? urlView : stored === 'compact' ? 'compact' : 'cards'

  applyView(mode)
  if (urlView === 'compact' || urlView === 'cards') localStorage.setItem(VIEW_STORAGE_KEY, mode)

  document.querySelectorAll<HTMLButtonElement>('#viewToggle [data-view-mode]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const next: ViewMode = btn.getAttribute('data-view-mode') === 'compact' ? 'compact' : 'cards'
      localStorage.setItem(VIEW_STORAGE_KEY, next)
      applyView(next)
    })
  })
}

/* ------------------------------------------------------------------ */
/* Refresh without reload                                              */
/* ------------------------------------------------------------------ */

async function refreshView(): Promise<void> {
  try {
    const res = await fetch('/')
    const html = await res.text()
    const doc = new DOMParser().parseFromString(html, 'text/html')

    for (const id of ['cardsView', 'tableView', 'integrationsPanel']) {
      const current = document.getElementById(id)
      const next = doc.getElementById(id)
      if (current && next) current.innerHTML = next.innerHTML
    }
  } catch (err) {
    console.error('Failed to refresh view:', err)
  }

  const hasItems = itemsOfActiveView().length > 0
  const showCreate = document.getElementById('showCreate')
  const createWrapper = document.getElementById('createWrapper')

  if (hasItems) {
    createWrapper?.classList.add('hidden')
    if (showCreate) showCreate.style.display = 'block'
  } else {
    createWrapper?.classList.remove('hidden')
    if (showCreate) showCreate.style.display = 'none'
  }

  clearSelection()
  paintCachedStatuses()
  applySort()
  ;(document.getElementById('searchInput') as HTMLInputElement | null)?.dispatchEvent(new Event('input'))
  void runAutoTests()
}

/* ------------------------------------------------------------------ */
/* Header toolbar: engine status, actions menu, import modal           */
/* ------------------------------------------------------------------ */

function setEngineDot(tone: 'emerald' | 'rose' | 'slate'): void {
  const dot = document.getElementById('engine-dot')
  if (!dot) return
  dot.classList.remove('bg-slate-500', 'bg-emerald-500', 'bg-rose-500')
  dot.classList.add(tone === 'emerald' ? 'bg-emerald-500' : tone === 'rose' ? 'bg-rose-500' : 'bg-slate-500')
}

async function updateEngineStatus(): Promise<void> {
  const status = document.getElementById('engine-status')
  const apply = (reachable: boolean, streams?: number) => {
    setEngineDot(reachable ? 'emerald' : 'rose')
    status?.setAttribute(
      'title',
      reachable ? `AceStream engine online · ${streams ?? 0} streams` : 'AceStream engine offline'
    )
  }

  try {
    const res = await fetch('/healthz')
    const data = (await res.json()) as { engineReachable?: boolean; streams?: number }
    apply(Boolean(data.engineReachable), data.streams)
  } catch {
    apply(false)
  }
}

function openImportModal(): void {
  const modal = document.getElementById('importModal')
  if (!modal) return
  modal.classList.remove('hidden')
  modal.classList.add('flex')
}

function closeImportModal(): void {
  const modal = document.getElementById('importModal')
  if (!modal) return
  modal.classList.add('hidden')
  modal.classList.remove('flex')
}

async function runImport(text: string): Promise<void> {
  try {
    const res = await fetch('/api/streams/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: text
    })

    if (res.ok) {
      const data = (await res.json()) as { imported?: number; updated?: number; skipped?: number }
      showToast(`Imported ${data.imported ?? 0}, updated ${data.updated ?? 0}, skipped ${data.skipped ?? 0}`, 'ok')
      closeImportModal()
      await refreshView()
    } else {
      const error = (await res.json().catch(() => ({}))) as { error?: string }
      showToast(error.error || 'Import failed', 'error')
    }
  } catch {
    showToast('Import failed', 'error')
  }
}

function initActionsMenu(): void {
  const wrap = document.getElementById('actionsMenuWrap')
  const btn = document.getElementById('actionsMenuBtn')
  const menu = document.getElementById('actionsMenu')
  if (!wrap || !btn || !menu) return

  const close = () => {
    menu.classList.add('hidden')
    btn.setAttribute('aria-expanded', 'false')
  }

  btn.addEventListener('click', (event) => {
    event.stopPropagation()
    const willOpen = menu.classList.contains('hidden')
    menu.classList.toggle('hidden', !willOpen)
    btn.setAttribute('aria-expanded', willOpen ? 'true' : 'false')
  })

  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && !wrap.contains(event.target)) close()
  })

  menu.querySelectorAll<HTMLButtonElement>('[data-menu]').forEach((item) => {
    item.addEventListener('click', () => {
      const action = item.getAttribute('data-menu')
      close()
      if (action === 'export') (window.location.href = '/api/streams/export')
      else if (action === 'import') openImportModal()
    })
  })
}

function initImportModal(): void {
  const modal = document.getElementById('importModal')
  if (!modal) return

  const text = document.getElementById('importText') as HTMLTextAreaElement | null
  const file = document.getElementById('importFile') as HTMLInputElement | null

  document.getElementById('importClose')?.addEventListener('click', closeImportModal)
  document.getElementById('importPickFile')?.addEventListener('click', () => file?.click())
  document.getElementById('importRun')?.addEventListener('click', () => {
    if (text && text.value.trim()) void runImport(text.value)
    else showToast('Paste some JSON first', 'error')
  })
  document.getElementById('importCopySchema')?.addEventListener('click', async () => {
    const schema = document.getElementById('importSchema')?.textContent ?? ''
    const ok = await copyText(schema)
    showToast(ok ? 'Schema copied' : 'Could not copy schema', ok ? 'ok' : 'error')
  })

  file?.addEventListener('change', async () => {
    const selected = file.files?.[0]
    if (!selected) return
    if (text) text.value = await selected.text()
    file.value = ''
  })

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeImportModal()
  })
}

function initToolbar(): void {
  void updateEngineStatus()
  setInterval(() => void updateEngineStatus(), 15_000)
  initActionsMenu()
  initImportModal()
  initViewToggle()
}

export function initHomePage(): void {
  initCreateForm()
  initCreateFormSubmit()
  initItemActions()
  initStreamStatusChecks()
  initToolbar()
  initBulkActions()
  initSearch()
  initSort()
}
