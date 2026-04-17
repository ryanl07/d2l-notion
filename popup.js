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

function formatWindow(w) {
  const labels = { '2w': '2 weeks', '1m': '1 month', '3m': '3 months', '6m': '6 months', '1y': '1 year' };
  return labels[w] || '3 months';
}

function dedupePearsonAssignments(assignments) {
  const seen = new Set();
  return assignments.filter(a => {
    const key = `${a.name || ''}|${a.dueDate || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !!a.name;
  });
}

async function getFrameIds(tabId) {
  const frames = await chrome.webNavigation.getAllFrames({ tabId }).catch(() => null);
  if (!frames || frames.length === 0) return [0];
  return frames.filter(f => !f.errorOccurred).map(f => f.frameId);
}

async function scrapePearsonFromFrames(tabId, frameIds) {
  let assignments = [];
  let responses = 0;
  let errors = 0;

  for (const frameId of frameIds) {
    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { action: 'scrapePearson' },
        { frameId }
      );
      responses += 1;
      if (resp && Array.isArray(resp.assignments) && resp.assignments.length > 0) {
        assignments = assignments.concat(resp.assignments);
      }
    } catch (e) {
      errors += 1;
    }
  }

  return { assignments: dedupePearsonAssignments(assignments), responses, errors };
}

async function scrapePearsonAssignments(tabId) {
  const frameIds = await getFrameIds(tabId);

  const firstPass = await scrapePearsonFromFrames(tabId, frameIds);
  if (firstPass.assignments.length > 0) return firstPass.assignments;

  if (firstPass.responses === 0 || firstPass.errors > 0) {
    try {
      for (const frameId of frameIds) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [frameId] },
            files: ['content.js']
          });
        } catch (e) {
          // Some frames (about:blank, cross-origin) can't be injected
        }
      }
      await new Promise(r => setTimeout(r, 300));
      const secondPass = await scrapePearsonFromFrames(tabId, frameIds);
      return secondPass.assignments;
    } catch (err) {
      console.warn('[D2L→Notion] Pearson injection fallback failed:', err);
    }
  }

  return [];
}

// ------------------------------------------------------------
// Init
// ------------------------------------------------------------
chrome.storage.local.get(['notionToken', 'databaseId', 'syncDescription', 'syncWindow'], (data) => {
  if (data.notionToken) $('notion-token').value = data.notionToken;
  if (data.databaseId) $('database-id').value = data.databaseId;
  $('sync-description').checked = !!data.syncDescription;
  if (data.syncWindow) $('sync-window').value = data.syncWindow;
});

// ------------------------------------------------------------
// Settings view
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
  const syncWindow = $('sync-window').value;

  chrome.storage.local.set({ notionToken, databaseId, syncDescription, syncWindow }, () => {
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
      setSettingsStatus('Connected! Created test entry "' + result.testName + '". Feel free to delete it.', 'success');
    } else {
      const errMsg = (result && result.error) ? result.error : 'Unknown error';
      setSettingsStatus('Error: ' + errMsg, 'error');
    }
  } catch (err) {
    setSettingsStatus('Error: ' + err.message, 'error');
  } finally {
    $('test-btn').disabled = false;
  }
});

// ------------------------------------------------------------
// Brightspace Sync
// ------------------------------------------------------------
$('sync-btn').addEventListener('click', async () => {
  const { notionToken, databaseId, syncDescription, syncWindow } = await chrome.storage.local.get(
    ['notionToken', 'databaseId', 'syncDescription', 'syncWindow']
  );

  if (!notionToken || !databaseId) {
    setStatus('Please add your Notion token and database ID in Settings.', 'error');
    return;
  }

  $('sync-btn').disabled = true;
  $('results').innerHTML = '';
  setStatus('Reading calendar info...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.match(/brightspace\.com|desire2learn\.com|d2l\.com/)) {
      setStatus('Please open a Brightspace page first.', 'error');
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action: 'getCalendarInfo' });
    } catch (err) {
      console.log('Content script not loaded, injecting manually...');
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
      await new Promise(r => setTimeout(r, 300));
      response = await chrome.tabs.sendMessage(tab.id, { action: 'getCalendarInfo' });
    }

    if (!response || !response.baseUrl || !response.ouId) {
      setStatus('Could not detect calendar info. Open Brightspace and try again.', 'error');
      return;
    }

    setStatus('Fetching assignments (window: ' + formatWindow(syncWindow) + ')...', 'info');

    const syncResult = await chrome.runtime.sendMessage({
      action: 'fetchAndSync',
      baseUrl: response.baseUrl,
      ouId: response.ouId,
      syncWindow: syncWindow || '3m',
      notionToken,
      databaseId,
      syncDescription
    });

    if (syncResult && syncResult.error) {
      setStatus('Error: ' + syncResult.error, 'error');
      return;
    }

    const results = (syncResult && syncResult.results) || [];
    if (results.length === 0) {
      setStatus('No assignments found in the selected window.', 'error');
      return;
    }

    renderResults(results);
    const ok = results.filter(r => r.status === 'created' || r.status === 'updated').length;
    const skipped = results.filter(r => r.status === 'skipped').length;
    const errors = results.filter(r => r.status === 'error').length;
    setStatus('Synced ' + ok + ' / Skipped ' + skipped + ' / Errors ' + errors, errors > 0 ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
  } finally {
    $('sync-btn').disabled = false;
  }
});

// ------------------------------------------------------------
// Pearson Sync
// ------------------------------------------------------------
$('pearson-btn').addEventListener('click', async () => {
  const { notionToken, databaseId, syncDescription } = await chrome.storage.local.get(
    ['notionToken', 'databaseId', 'syncDescription']
  );

  if (!notionToken || !databaseId) {
    setStatus('Please add your Notion token and database ID in Settings.', 'error');
    return;
  }

  $('pearson-btn').disabled = true;
  $('results').innerHTML = '';
  setStatus('Scraping assignments from Pearson...', 'info');

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.url || !tab.url.includes('mylabmastering.pearson.com')) {
      setStatus('Please open a Pearson MyLab course page first.', 'error');
      return;
    }

    const assignments = await scrapePearsonAssignments(tab.id);

    if (assignments.length === 0) {
      setStatus('No current assignments found on this Pearson page.', 'error');
      return;
    }

    setStatus('Found ' + assignments.length + ' assignment(s). Syncing to Notion...', 'info');

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
    setStatus('Synced ' + ok + ' / Skipped ' + skipped + ' / Errors ' + errors, errors > 0 ? 'error' : 'success');
  } catch (err) {
    console.error(err);
    setStatus('Error: ' + err.message, 'error');
  } finally {
    $('pearson-btn').disabled = false;
  }
});