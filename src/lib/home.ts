/**
 * Home page functionality - Stream management and status checking
 */

// Declare global aceStreamBase
declare global {
  interface Window {
    aceStreamBase: string;
  }
}

/**
 * Initialize the create stream form toggle and Import dropdown
 */
function initCreateForm(): void {
  const showCreateBtn = document.getElementById('showCreate');
  const cancelCreateBtn = document.getElementById('cancelCreate');
  const createWrapper = document.getElementById('createWrapper');
  const addMenuToggle = document.getElementById('addMenuToggle');
  const addMenu = document.getElementById('addMenu');

  if (showCreateBtn && createWrapper) {
    showCreateBtn.addEventListener('click', () => {
      createWrapper.classList.remove('hidden');
      createWrapper.classList.add('animate-slideUp');
    });
  }

  if (cancelCreateBtn && createWrapper) {
    cancelCreateBtn.addEventListener('click', () => {
      createWrapper.classList.add('hidden');
    });
  }

  if (addMenuToggle && addMenu) {
    addMenuToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      addMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', () => {
      addMenu.classList.add('hidden');
    });
  }
}

/**
 * Initialize the create stream form submission
 */
function initCreateFormSubmit(): void {
  const createForm = document.getElementById('create') as HTMLFormElement;
  const errorEl = document.getElementById('err');

  if (!createForm) return;

  createForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(createForm);
    const data = Object.fromEntries(formData);

    try {
      const res = await fetch('/api/streams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (res.ok) {
        location.reload();
      } else {
        const error = await res.json();
        if (errorEl) {
          errorEl.textContent = error.error || 'Error creating stream';
          errorEl.hidden = false;
        }
      }
    } catch {
      if (errorEl) {
        errorEl.textContent = 'Network error';
        errorEl.hidden = false;
      }
    }
  });
}

/**
 * Stream status types
 */
type StreamStatus = 'online' | 'offline' | 'checking' | 'unknown';

/**
 * Status check configuration
 */
const STATUS_CHECK_CONFIG = {
  /** Minimum download speed to consider stream truly active (KB/s) */
  MIN_ACTIVE_SPEED: 50,
  /** Minimum peers AND speed to be considered online */
  MIN_PEERS_FOR_ONLINE: 2,
  /** Request timeout in ms */
  REQUEST_TIMEOUT: 12000,
  /** Stats request timeout in ms */
  STATS_TIMEOUT: 6000,
};

/**
 * Set the status indicator for a stream card
 */
function setIndicatorStatus(indicator: HTMLElement, status: StreamStatus, title: string, detail?: string): void {
  indicator.setAttribute('data-status', status);
  indicator.setAttribute('title', detail ? `${title}\n${detail}` : title);
}

/**
 * Check the status of a single stream - returns the result
 */
async function checkSingleStreamStatus(streamId: string): Promise<{
  status: StreamStatus;
  title: string;
  detail: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STATUS_CHECK_CONFIG.REQUEST_TIMEOUT);

    const response = await fetch(`/ace/manifest.m3u8?id=${encodeURIComponent(streamId)}&format=json`, {
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { status: 'offline', title: 'Not available', detail: `HTTP ${response.status}` };
    }

    const data = await response.json();

    if (data.error) {
      return { status: 'offline', title: 'Error', detail: data.error };
    }

    const statUrl = data.response?.stat_url || data.stat_url;
    
    if (!statUrl) {
      return { status: 'unknown', title: 'No stats', detail: 'Cannot verify status' };
    }

    const proxiedStatUrl = statUrl.replace(/http:\/\/[^/]+:6878/g, '');

    try {
      const statsController = new AbortController();
      const statsTimeout = setTimeout(() => statsController.abort(), STATUS_CHECK_CONFIG.STATS_TIMEOUT);

      const statsResponse = await fetch(proxiedStatUrl, { signal: statsController.signal });
      clearTimeout(statsTimeout);

      if (!statsResponse.ok) {
        return { status: 'unknown', title: 'Stats unavailable', detail: 'Click to test' };
      }

      const stats = await statsResponse.json();
      const statsData = stats.response || stats;

      const peers = statsData.peers ?? 0;
      const speedDown = statsData.speed_down ?? 0;
      const streamStatus = statsData.status ?? '';

      const info: string[] = [];
      if (peers > 0) info.push(`${peers} peer${peers !== 1 ? 's' : ''}`);
      if (speedDown > 0) info.push(`${speedDown} KB/s`);

      // STRICT: Only online if actually downloading with good speed
      if (streamStatus === 'dl' && speedDown >= STATUS_CHECK_CONFIG.MIN_ACTIVE_SPEED) {
        return { 
          status: 'online', 
          title: 'Streaming', 
          detail: info.join(' • ') 
        };
      }

      // Has peers and some speed - likely working
      if (peers >= STATUS_CHECK_CONFIG.MIN_PEERS_FOR_ONLINE && speedDown > 0) {
        return { 
          status: 'online', 
          title: 'Active', 
          detail: info.join(' • ') 
        };
      }

      // Prebuffering - not ready yet
      if (streamStatus === 'prebuf') {
        return { 
          status: 'unknown', 
          title: 'Prebuffering', 
          detail: info.length > 0 ? info.join(' • ') : 'Looking for peers...' 
        };
      }

      // Has some peers but no speed - uncertain
      if (peers > 0) {
        return { 
          status: 'unknown', 
          title: 'Connecting', 
          detail: `${peers} peer${peers !== 1 ? 's' : ''}, no data yet` 
        };
      }

      // No peers, no speed - likely not working
      return { 
        status: 'unknown', 
        title: 'No peers', 
        detail: 'May not be available' 
      };

    } catch {
      return { status: 'unknown', title: 'Stats error', detail: 'Click to test' };
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { status: 'unknown', title: 'Timeout', detail: 'Server slow' };
    }
    return { status: 'offline', title: 'Connection error', detail: 'Cannot reach server' };
  }
}

/**
 * Check status of a card and update its indicator
 */
async function checkAndUpdateCard(card: Element): Promise<void> {
  const streamId = card.getAttribute('data-id');
  if (!streamId) return;

  const indicator = card.querySelector('.status-indicator') as HTMLElement;
  if (!indicator) return;

  // Show checking status immediately
  setIndicatorStatus(indicator, 'checking', 'Checking...');

  // Get the actual status
  const result = await checkSingleStreamStatus(streamId);
  
  // Update indicator
  setIndicatorStatus(indicator, result.status, result.title, result.detail);
}

/**
 * Initialize stream status checking for all cards - IN PARALLEL
 */
function initStreamStatusChecks(): void {
  const cards = Array.from(document.querySelectorAll('.stream-card'));
  
  if (cards.length === 0) return;

  // Check all streams in parallel
  const checkAllStreams = () => {
    // Set all to checking first
    cards.forEach(card => {
      const indicator = card.querySelector('.status-indicator') as HTMLElement;
      if (indicator) {
        setIndicatorStatus(indicator, 'checking', 'Checking...');
      }
    });

    // Then check all in parallel
    Promise.all(cards.map(card => checkAndUpdateCard(card)));
  };

  // Initial check after short delay
  setTimeout(checkAllStreams, 300);

  // Refresh all streams every 2 minutes
  setInterval(checkAllStreams, 120000);
}

/**
 * Handle stream card actions (edit, save, delete, copy)
 */
function initCardActions(): void {
  document.addEventListener('click', async (e) => {
    const target = e.target;
    if (!target || !(target instanceof Element)) return;

    const card = target.closest('.stream-card');
    if (!card) return;

    const streamId = card.getAttribute('data-id');
    const viewEl = card.querySelector('[data-view]');
    const editEl = card.querySelector('[data-editform]');

    if (target.matches('[data-edit]')) {
      viewEl?.setAttribute('hidden', '');
      editEl?.removeAttribute('hidden');
    } else if (target.matches('[data-cancel]')) {
      viewEl?.removeAttribute('hidden');
      editEl?.setAttribute('hidden', '');
    } else if (target.matches('[data-save]')) {
      await handleSave(streamId, editEl);
    } else if (target.matches('[data-delete]')) {
      await handleDelete(streamId);
    } else if (target.matches('[data-copy-link]')) {
      await handleCopyLink(streamId, target);
    } else if (target.matches('[data-favorite-btn]')) {
      await handleFavoriteToggle(streamId, card as HTMLElement);
    }
  });
}

async function handleSave(streamId: string | null, editEl: Element | null): Promise<void> {
  if (!streamId || !editEl) return;

  const inputs = editEl.querySelectorAll('input');
  const data: Record<string, string> = {};
  inputs.forEach(input => {
    if (input instanceof HTMLInputElement) {
      data[input.name] = input.value;
    }
  });

  try {
    const res = await fetch(`/api/streams/${streamId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });

    if (res.ok) {
      location.reload();
    }
  } catch (err) {
    console.error('Error updating stream:', err);
  }
}

async function handleDelete(streamId: string | null): Promise<void> {
  if (!streamId) return;

  if (confirm('Delete this stream?')) {
    try {
      const res = await fetch(`/api/streams/${streamId}`, { method: 'DELETE' });
      if (res.ok) {
        location.reload();
      }
    } catch (err) {
      console.error('Error deleting stream:', err);
    }
  }
}

async function handleCopyLink(streamId: string | null, target: Element): Promise<void> {
  if (!streamId) return;

  const aceStreamUrl = `/ace/manifest.m3u8?id=${encodeURIComponent(streamId)}`;
  const fullUrl = window.aceStreamBase + aceStreamUrl;

  const showCopyFeedback = () => {
    const originalText = target.innerHTML;
    target.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M20 6 9 17l-5-5"/>
      </svg>
      Copied!
    `;
    if (target instanceof HTMLElement) {
      target.style.color = '#10b981';
    }

    setTimeout(() => {
      target.innerHTML = originalText;
      if (target instanceof HTMLElement) {
        target.style.color = '';
      }
    }, 2000);
  };

  try {
    await navigator.clipboard.writeText(fullUrl);
    showCopyFeedback();
  } catch {
    // Fallback for older browsers
    const textArea = document.createElement('textarea');
    textArea.value = fullUrl;
    document.body.appendChild(textArea);
    textArea.select();
    try {
      document.execCommand('copy');
      showCopyFeedback();
    } catch (fallbackErr) {
      console.error('Fallback copy failed:', fallbackErr);
      alert(`Copy this link: ${fullUrl}`);
    }
    document.body.removeChild(textArea);
  }
}

async function handleFavoriteToggle(streamId: string | null, card: HTMLElement): Promise<void> {
  if (!streamId) return;
  const res = await fetch(`/api/streams/${streamId}`, { method: 'PATCH' });
  if (!res.ok) return;
  const updated = await res.json();
  const isFav = updated.is_favorite === 1;
  card.dataset.favorite = isFav ? '1' : '0';
  const btn = card.querySelector('[data-favorite-btn]');
  if (btn) btn.textContent = isFav ? '★' : '☆';
  sortCards();
}

function sortCards(): void {
  const select = document.getElementById('sortSelect') as HTMLSelectElement | null;
  if (!select) return;
  const val = select.value;

  const cmp = (a: HTMLElement, b: HTMLElement): number => {
    if (val === 'favorites') {
      const fa = a.dataset.favorite === '1' ? 0 : 1;
      const fb = b.dataset.favorite === '1' ? 0 : 1;
      if (fa !== fb) return fa - fb;
    }
    if (val === 'name-asc')  return (a.dataset.name ?? '').localeCompare(b.dataset.name ?? '');
    if (val === 'name-desc') return (b.dataset.name ?? '').localeCompare(a.dataset.name ?? '');
    if (val === 'oldest')    return (a.dataset.created ?? '').localeCompare(b.dataset.created ?? '');
    return (b.dataset.created ?? '').localeCompare(a.dataset.created ?? '');
  };

  const list = document.getElementById('list');
  if (list) {
    const cards = Array.from(list.querySelectorAll<HTMLElement>('.stream-card'));
    cards.sort(cmp);
    cards.forEach(card => list.appendChild(card));
  }

  const tbody = document.querySelector<HTMLElement>('#streamTable tbody');
  if (tbody) {
    const rows = Array.from(tbody.querySelectorAll<HTMLElement>('tr[data-id]'));
    rows.sort(cmp);
    rows.forEach(row => tbody.appendChild(row));
  }
}

function initSort(): void {
  const select = document.getElementById('sortSelect');
  if (!select) return;
  select.addEventListener('change', sortCards);
}

function initSearch(): void {
  const input = document.getElementById('searchInput') as HTMLInputElement | null;
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.toLowerCase().trim();
    let visible = 0;

    document.querySelectorAll<HTMLElement>('.stream-card').forEach(card => {
      const match = !q || (card.dataset.name ?? '').includes(q);
      card.classList.toggle('hidden', !match);
      if (match) visible++;
    });

    document.querySelectorAll<HTMLElement>('#streamTable tbody tr[data-id]').forEach(tr => {
      const match = !q || (tr.dataset.name ?? '').includes(q);
      tr.style.display = match ? '' : 'none';
    });

    const noResults = document.getElementById('noResults');
    if (noResults) noResults.classList.toggle('hidden', visible > 0 || !!document.getElementById('streamTable'));
  });
}

/**
 * Toggle between grid (2-column) card view and compact table view
 */
function initViewToggle(): void {
  const btn = document.getElementById('viewToggle');
  const list = document.getElementById('list');
  if (!btn || !list) return;

  const gridIcon = btn.querySelector('[data-grid-icon]') as HTMLElement | null;
  const listIcon = btn.querySelector('[data-list-icon]') as HTMLElement | null;

  const saved = localStorage.getItem('acemux-view');
  let isGrid = saved !== 'list';

  function buildStreamTable(): HTMLElement {
    const wrapper = document.createElement('div');
    wrapper.id = 'streamTable';
    wrapper.className = 'rounded-2xl border border-[#1f2a37]/70 overflow-hidden animate-slideUp';

    const table = document.createElement('table');

    // Header
    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    hr.innerHTML = `
      <th style="width:2.5rem;padding:0.65rem 1rem;text-align:left;">
        <input type="checkbox" id="selectAll" style="accent-color:#38bdf8;cursor:pointer;" title="Select all" />
      </th>
      <th style="padding:0.65rem 1rem;text-align:left;font-size:0.7rem;color:rgb(148,163,184);font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Name</th>
      <th style="width:3.5rem;padding:0.65rem 1rem;text-align:center;font-size:0.7rem;color:rgb(148,163,184);font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Status</th>
      <th style="padding:0.65rem 1rem;text-align:right;font-size:0.7rem;color:rgb(148,163,184);font-weight:500;text-transform:uppercase;letter-spacing:0.06em;">Actions</th>
    `;
    thead.appendChild(hr);
    table.appendChild(thead);

    // Body
    const tbody = document.createElement('tbody');
    const cards = Array.from(document.querySelectorAll<HTMLElement>('.stream-card'));
    cards.forEach(card => {
      const id = card.dataset.id ?? '';
      const displayName = card.querySelector('h2')?.textContent?.trim() ?? card.dataset.name ?? '';
      const isFav = card.dataset.favorite === '1';
      const statusEl = card.querySelector('.status-indicator');
      const statusHtml = statusEl
        ? statusEl.outerHTML
        : '<div style="width:0.75rem;height:0.75rem;border-radius:50%;display:inline-block;background:rgba(100,116,139,0.5);"></div>';
      const vlcUrl = `vlc://${window.aceStreamBase}/ace/manifest.m3u8?id=${encodeURIComponent(id)}`;
      const aceUrl = `${window.aceStreamBase}/ace/manifest.m3u8?id=${encodeURIComponent(id)}`;
      const isHidden = card.classList.contains('hidden');

      const tr = document.createElement('tr');
      tr.dataset.id = id;
      tr.dataset.name = card.dataset.name ?? '';
      tr.dataset.favorite = card.dataset.favorite ?? '0';
      tr.dataset.created = card.dataset.created ?? '';
      if (isHidden) tr.style.display = 'none';

      tr.innerHTML = `
        <td style="padding:0.6rem 1rem;">
          <input type="checkbox" data-bulk-check style="accent-color:#38bdf8;cursor:pointer;" />
        </td>
        <td style="padding:0.6rem 1rem;font-weight:500;">${displayName}</td>
        <td style="padding:0.6rem 1rem;text-align:center;">
          <div style="display:flex;justify-content:center;">${statusHtml}</div>
        </td>
        <td style="padding:0.6rem 1rem;">
          <div style="display:flex;justify-content:flex-end;align-items:center;gap:0.3rem;flex-wrap:wrap;">
            <a href="/${id}" class="tbl-btn tbl-btn-watch">Watch</a>
            <a href="${vlcUrl}" class="tbl-btn">VLC</a>
            <button class="tbl-btn" data-table-copy data-ace-url="${aceUrl}">Copy</button>
            <button class="tbl-btn tbl-btn-fav${isFav ? ' is-fav' : ''}" data-table-fav title="Toggle favorite">${isFav ? '★' : '☆'}</button>
            <button class="tbl-btn tbl-btn-del" data-table-delete title="Delete">✕</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    wrapper.appendChild(table);

    // Select all handler
    wrapper.addEventListener('change', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.id === 'selectAll') {
        const checked = e.target.checked;
        wrapper.querySelectorAll<HTMLInputElement>('[data-bulk-check]').forEach(cb => { cb.checked = checked; });
        document.dispatchEvent(new Event('bulk-recount'));
      }
    });

    // Row action handlers
    wrapper.addEventListener('click', async (e) => {
      const target = e.target as Element;
      const tr = target.closest('tr') as HTMLTableRowElement | null;
      const id = tr?.dataset.id;
      if (!id) return;

      if (target.matches('[data-table-delete]')) {
        if (!confirm('Delete this stream?')) return;
        await fetch(`/api/streams/${id}`, { method: 'DELETE' });
        location.reload();
      } else if (target.matches('[data-table-fav]')) {
        const res = await fetch(`/api/streams/${id}`, { method: 'PATCH' });
        if (!res.ok) return;
        const updated = await res.json();
        const isFav = updated.is_favorite === 1;
        target.textContent = isFav ? '★' : '☆';
        target.classList.toggle('is-fav', isFav);
        if (tr) tr.dataset.favorite = isFav ? '1' : '0';
        // Sync original card
        const card = document.querySelector<HTMLElement>(`.stream-card[data-id="${id}"]`);
        if (card) {
          card.dataset.favorite = isFav ? '1' : '0';
          const favBtn = card.querySelector('[data-favorite-btn]');
          if (favBtn) favBtn.textContent = isFav ? '★' : '☆';
        }
        sortCards();
      } else if (target.matches('[data-table-copy]')) {
        const aceUrl = (target as HTMLElement).dataset.aceUrl ?? '';
        try {
          await navigator.clipboard.writeText(aceUrl);
          const orig = target.textContent;
          target.textContent = 'Copied!';
          (target as HTMLElement).style.color = '#10b981';
          setTimeout(() => { target.textContent = orig; (target as HTMLElement).style.color = ''; }, 2000);
        } catch {
          alert(`Copy this link:\n${aceUrl}`);
        }
      }
    });

    return wrapper;
  }

  function applyView(): void {
    if (isGrid) {
      document.getElementById('streamTable')?.remove();
      list!.classList.remove('hidden');
      list!.classList.add('md:grid-cols-2');
      gridIcon?.classList.remove('hidden');
      listIcon?.classList.add('hidden');
      btn!.title = 'Switch to list view';
    } else {
      list!.classList.add('hidden');
      document.getElementById('streamTable')?.remove();
      const tableEl = buildStreamTable();
      list!.insertAdjacentElement('afterend', tableEl);
      gridIcon?.classList.add('hidden');
      listIcon?.classList.remove('hidden');
      btn!.title = 'Switch to grid view';
    }
  }

  applyView();

  btn.addEventListener('click', () => {
    isGrid = !isGrid;
    localStorage.setItem('acemux-view', isGrid ? 'grid' : 'list');
    applyView();
  });
}

/**
 * Export all streams as a dated JSON file
 */
function initExport(): void {
  const btn = document.getElementById('exportBtn');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      const res = await fetch('/api/streams');
      if (!res.ok) throw new Error('Failed to fetch streams');
      const streams = await res.json();

      const date = new Date().toISOString().split('T')[0];
      const filename = `acemux-export-${date}.json`;
      const blob = new Blob([JSON.stringify(streams, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  });
}

/**
 * Import streams from a JSON file
 */
function initImportFile(): void {
  const importBtn = document.getElementById('importBtn');
  const importFile = document.getElementById('importFile') as HTMLInputElement | null;
  if (!importBtn || !importFile) return;

  importBtn.addEventListener('click', () => importFile.click());

  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const streams = JSON.parse(text);

      if (!Array.isArray(streams)) {
        alert('Invalid file: expected a JSON array of streams');
        return;
      }

      let added = 0;
      let skipped = 0;

      await Promise.all(streams.map(async (s) => {
        const res = await fetch('/api/streams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(s)
        });
        if (res.status === 409) {
          skipped++;
        } else if (res.ok) {
          added++;
        }
      }));

      alert(`Import complete: ${added} added, ${skipped} skipped (duplicates)`);
      location.reload();
    } catch {
      alert('Failed to import: invalid JSON file');
    } finally {
      importFile.value = '';
    }
  });
}

/**
 * Bulk select mode:
 * - Card view: click card to highlight it (color change, no checkbox)
 * - Table view: checkboxes always visible; checking one auto-enters select mode
 */
function initBulkActions(): void {
  const bulkBtn = document.getElementById('bulkBtn');
  const bulkBar = document.getElementById('bulkBar');
  const bulkCount = document.getElementById('bulkCount');
  const bulkDelete = document.getElementById('bulkDelete');
  const bulkCancel = document.getElementById('bulkCancel');
  if (!bulkBtn || !bulkBar) return;

  let selectMode = false;

  function updateCount(): void {
    const cards = document.querySelectorAll('.stream-card.card-selected').length;
    const boxes = document.querySelectorAll<HTMLInputElement>('[data-bulk-check]:checked').length;
    if (bulkCount) bulkCount.textContent = `${cards + boxes} selected`;
  }

  function enterSelectMode(): void {
    selectMode = true;
    bulkBtn!.textContent = 'Selecting…';
    bulkBar!.classList.remove('hidden');
    document.getElementById('list')?.classList.add('select-mode');
    updateCount();
  }

  function exitSelectMode(): void {
    selectMode = false;
    bulkBtn!.textContent = 'Select';
    bulkBar!.classList.add('hidden');
    document.getElementById('list')?.classList.remove('select-mode');
    // Deselect all cards
    document.querySelectorAll<HTMLElement>('.stream-card.card-selected').forEach(c => c.classList.remove('card-selected'));
    // Uncheck table checkboxes
    document.querySelectorAll<HTMLInputElement>('[data-bulk-check]').forEach(cb => { cb.checked = false; });
    const selectAll = document.getElementById('selectAll') as HTMLInputElement | null;
    if (selectAll) selectAll.checked = false;
    updateCount();
  }

  // Toggle select mode on bulkBtn click
  bulkBtn.addEventListener('click', () => {
    if (selectMode) exitSelectMode();
    else enterSelectMode();
  });

  bulkCancel?.addEventListener('click', exitSelectMode);

  // Card click → toggle highlight (card view select mode only)
  document.getElementById('list')?.addEventListener('click', (e) => {
    if (!selectMode) return;
    const target = e.target as Element;
    // Ignore clicks on interactive elements
    if (target.closest('a, button, input')) return;
    const card = target.closest('.stream-card') as HTMLElement | null;
    if (!card) return;
    card.classList.toggle('card-selected');
    updateCount();
  });

  // Table checkbox change → update count (auto-enter select mode if needed)
  document.addEventListener('change', (e) => {
    const target = e.target as HTMLInputElement;
    if (target.matches('[data-bulk-check]')) {
      if (!selectMode && target.checked) enterSelectMode();
      updateCount();
    }
  });

  // Custom event from selectAll in table
  document.addEventListener('bulk-recount', updateCount);

  bulkDelete?.addEventListener('click', async () => {
    const cardIds = Array.from(document.querySelectorAll<HTMLElement>('.stream-card.card-selected'))
      .map(c => c.getAttribute('data-id')).filter(Boolean) as string[];
    const tableIds = Array.from(document.querySelectorAll<HTMLInputElement>('[data-bulk-check]:checked'))
      .map(cb => cb.closest('tr')?.getAttribute('data-id')).filter(Boolean) as string[];
    const ids = [...new Set([...cardIds, ...tableIds])];
    if (ids.length === 0) return;

    if (!confirm(`Delete ${ids.length} stream${ids.length !== 1 ? 's' : ''}?`)) return;
    await Promise.all(ids.map(id => fetch(`/api/streams/${id}`, { method: 'DELETE' })));
    location.reload();
  });
}

/**
 * Initialize all home page functionality
 */
export function initHomePage(): void {
  initCreateForm();
  initCreateFormSubmit();
  initStreamStatusChecks();
  initCardActions();
  initSearch();
  initSort();
  initViewToggle();
  initExport();
  initImportFile();
  initBulkActions();
}
