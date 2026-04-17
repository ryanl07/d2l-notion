const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------
function showView(name) {
  $('main-view').classList.toggle('hidden', name !== 'main');
  $('settings-view').classList.toggle('hidden', name !== 'settings');
}

function setStatus(msg, type) {
  const el = $('status');
  el.textContent = msg || '';
  el.className = msg ? `status ${type || 'info'}` : 'status';
}

function setSettingsStatus(msg, type) {
  const el = $('settings-status');
  if (!el) return;
  el.textContent = msg || '';
  el.className = msg ? `status ${type || 'info'}` : 'status';
}

function renderResults(results) {
  const box = $('results');
  box.innerHTML = '';
  results.forEach(r => {
    const div = document.createElement('div');
    div.className = 'result-item';
    const statusClass = r.status === 'error' ? 'err' : r.status === 'skipped' ? 'skip' : 'ok';
    const icon = r.status === 'created' ? '➕' :
                 r.status === 'updated' ? '🔄' :
                 r.status === 'skipped' ? '⏭️' : '❌';
    const courseSpan = document.createElement('span');
    const courseLabel = document.createElement('span');
    courseLabel.className = 'course';
    courseLabel.textContent = r.course || '?';
    courseSpan.appendChild(courseLabel);
    courseSpan.appendChild(document.createTextNode(' ' + (r.name || '')));

    const statusSpan = document.createElement('span');
    statusSpan.className = statusClass;
    statusSpan.textContent = icon;

    div.appendChild(courseSpan);
    div.appendChild(statusSpan);
    box.appendChild(div);
  });
}

// ------------------------------------------------------------
// Init: load saved settings
// ------------------------------------------------------------
chrome.storage.local.get(['notionToken', 'databaseId', 'syncDescription'], (data) => {
  if (data.notionToken) $('notion-token').value = data.notionToken;
  if (data.databaseId) $('database-id').value = data.databaseId;
  $('sync-description').checked = !!data.syncDescription;
});

// ------------------------------------------------------------
// Event handlers
// ------------------------------------------------------------
$('settings-btn').addEventListener('click', () => {
  setSettingsStatus('');
  showView('settings');
});

$('back-btn').addEventListener('click', () => {
  setSettingsStatus('');
  showView('main');
});

$('save-btn').addEventListener('click', () => {
  const notionToken = $('notion-token').value.trim();
  const databaseId = $('database-id').value.trim().replace(/-/g, '').split('?')[0];
  const syncDescription = $('sync-description').checked;

  chrome.storage.local.set({ notionToken, databaseId, syncDescription }, () => {
    setSettingsStatus('Settings saved!', 'success');
    setTimeout(() => {
      setSettingsStatus('');
      showView('main');
    }, 800);
  });
});

$('test-btn').addEventListener('click', async () => {
  const notionToken = $('notion-token').value.trim();
  const databaseId = $('database-id').value.trim().replace(/-/g, '').split('?')[0];

  if (!notionToken || !databaseId) {
    setSettingsStatus('Please fill in both fields first.', 'error');
    return;
  }

  $('test-btn').disabled = true;
  setSettingsStatus('Testing connection...', 'info');

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'testNotion',
      notionToken,
      databaseId
    });

    if (result && result.success) {
      setSettingsStatus(`✅ Connected! Created test entry "${result.testName}". Feel free to delete it.`, 'success');
    } else {
      setSettingsStatus('❌ ' + ((result && result.error) || 'Unknown error'), 'error');
    }
  } catch (err) {
    setSettingsStatus('❌ ' + err.message, 'error');
  } finally {
    $('test-btn').disabled = false;
  }
});

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

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.match(/brightspace\.com|desire2learn\.com|d2l\.com/)) {
      setStatus('Please open a Brightspace page first.', 'error');
      return;
    }

    // Try messaging the content script. If it's not loaded, inject it manually.
    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    } catch (err) {
      console.log('Content script not loaded, injecting manually...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 300));
      response = await chrome.tabs.sendMessage(tab.id, { action: 'scrape' });
    }

    if (!response || !response.assignments) {
      setStatus('Could not read page. Refresh Brightspace and try again.', 'error');
      return;
    }

    const assignments = response.assignments;
    if (assignments.length === 0) {
      setStatus('No assignments found. Make sure you\'re on the Calendar page.', 'error');
      return;
    }

    setStatus(`Found ${assignments.length} assignment(s). Syncing to Notion...`, 'info');

    const syncResult = await chrome.runtime.sendMessage({
      action: 'syncToNotion',
      assignments,
      notionToken,
      databaseId,
      syncDescription
    });

    const results = (syncResult && syncResult.results) || [];
    renderResults(results);
    const ok = results.filter(r => r.status === 'created' || r.status === 'updated').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors = results.filter(r => r.status === 'error').length;
    setStatus(`✅ Synced ${ok} · Skipped ${skipped} · Errors ${errors}`, errors > 0 ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
  } finally {
    $('sync-btn').disabled = false;
  }
});
