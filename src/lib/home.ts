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
 * Initialize the create stream form toggle
 */
function initCreateForm(): void {
  const showCreateBtn = document.getElementById('showCreate');
  const cancelCreateBtn = document.getElementById('cancelCreate');
  const createWrapper = document.getElementById('createWrapper');

  if (showCreateBtn && createWrapper) {
    showCreateBtn.addEventListener('click', () => {
      createWrapper.classList.remove('hidden');
      createWrapper.classList.add('animate-slideUp');
      showCreateBtn.style.display = 'none';
    });
  }

  if (cancelCreateBtn && createWrapper && showCreateBtn) {
    cancelCreateBtn.addEventListener('click', () => {
      createWrapper.classList.add('hidden');
      showCreateBtn.style.display = 'block';
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

/**
 * Initialize all home page functionality
 */
export function initHomePage(): void {
  initCreateForm();
  initCreateFormSubmit();
  initStreamStatusChecks();
  initCardActions();
}
