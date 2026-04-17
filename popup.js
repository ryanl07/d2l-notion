const $ = (id) => document.getElementById(id);

// --- View management ---
const showView = (name) => {
  $('main-view').classList.toggle('hidden', name !== 'main');
  $('settings-view').classList.toggle('hidden', name !== 'settings');
};

$('settings-btn').addEventListener('click', () => showView('settings'));
$('back-btn').addEventListener('click', () => showView('main'));

// --- Load saved settings ---
chrome.storage.local.get(['notionToken', 'databaseId', 'syncDescription'], (data) => {
  if (data.notionToken) $('notion-token').value = data.notionToken;
  if (data.databaseId) $('database-id').value = data.databaseId;
  $('sync-description').checked = !!data.syncDescription;
});

// --- Save settings ---
$('save-btn').addEventListener('click', () => {
  const notionToken = $('notion-token').value.trim();
  const databaseId = $('database-id').value.trim().replace(/-/g, '');
  const syncDescription = $('sync-description').checked;

  chrome.storage.local.set({ notionToken, databaseId, syncDescription }, () => {
    setStatus('Settings saved!', 'success');
    setTimeout(() => showView('main'), 800);
  });
});

// --- Status helper ---
const setStatus = (msg, type = 'info') => {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${type}`;
};

// --- Sync button ---
$('sync-btn').addEventListener('click', async () => {
  const { notionToken, databaseId, syncDescription } = await chrome.storage.local.get(
    ['notionToken', 'databaseId', 'syncDescription']
  );

  if (!notionToken || !databaseId) {
    setStatus('Please add your Notion token and database ID in Settings.', 'error');
    return;
  }

  $('sync-btn').disabled = true;
  $('results').innerHTML = '';
  setStatus('Scraping assignments from D2L...', 'info');

  // Ask content script for assignments
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab.url.includes('purdue.brightspace.com')) {
    setStatus('Please open a Brightspace page first (purdue.brightspace.com).', 'error');
    $('sync-btn').disabled = false;
    return;
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });

    if (!response || !response.assignments) {
      setStatus('Could not scrape page. Navigate to a course or assignments page.', 'error');
      $('sync-btn').disabled = false;
      return;
    }

    const { assignments } = response;
    if (assignments.length === 0) {
      setStatus('No assignments found on this page.', 'info');
      $('sync-btn').disabled = false;
      return;
    }

    setStatus(`Found ${assignments.length} assignment(s). Syncing to Notion...`, 'info');

    // Send to background script to sync with Notion
    const syncResult = await chrome.runtime.sendMessage({
      action: 'syncToNotion',
      assignments,
      notionToken,
      databaseId,
      syncDescription
    });

    renderResults(syncResult.results);
    const ok = syncResult.results.filter(r => r.status === 'created' || r.status === 'updated').length;
    const skipped = syncResult.results.filter(r => r.status === 'skipped').length;
    const errors = syncResult.results.filter(r => r.status === 'error').length;
    setStatus(`✅ Synced ${ok} · Skipped ${skipped} · Errors ${errors}`, errors > 0 ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
  } finally {
    $('sync-btn').disabled = false;
  }
});

const renderResults = (results) => {
  const box = $('results');
  box.innerHTML = '';
  results.forEach(r => {
    const div = document.createElement('div');
    div.className = 'result-item';
    const statusClass = r.status === 'error' ? 'err' : r.status === 'skipped' ? 'skip' : 'ok';
    const icon = r.status === 'created' ? '➕' : r.status === 'updated' ? '🔄' : r.status === 'skipped' ? '⏭️' : '❌';
    div.innerHTML = `
      <span><span class="course">${r.course || '?'}</span> ${r.name}</span>
      <span class="${statusClass}">${icon}</span>
    `;
    box.appendChild(div);
  });
};
