chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'syncToNotion') {
    syncAll(msg.assignments, msg.notionToken, msg.databaseId, msg.syncDescription)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ results: [{ status: 'error', name: 'SYNC', error: err.message }] }));
    return true;
  }
  if (msg.action === 'testNotion') {
    testNotionConnection(msg.notionToken, msg.databaseId)
      .then(res => sendResponse(res))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});

async function testNotionConnection(token, databaseId) {
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers: notionHeaders(token)
  });
  const dbData = await dbRes.json();
  if (!dbRes.ok) {
    if (dbRes.status === 401) {
      return { success: false, error: 'Invalid Notion token. Make sure it\'s copied correctly.' };
    }
    if (dbRes.status === 404) {
      return { success: false, error: 'Database not found. Check the ID, and make sure your integration is connected to the database (open the DB → "..." → Connections).' };
    }
    return { success: false, error: `Notion error (${dbRes.status}): ${dbData.message || 'Unknown'}` };
  }

  const testName = `🔌 Test — ${new Date().toLocaleString()}`;
  const testAssignment = {
    name: testName,
    course: 'Extension Test',
    dueDate: new Date().toISOString().split('T')[0],
    description: 'Test entry created by D2L → Notion Sync to verify connection. Safe to delete.',
    status: 'Not started'
  };

  try {
    await createPage(testAssignment, token, databaseId, true);
    return { success: true, testName };
  } catch (err) {
    return {
      success: false,
      error: `Connected, but couldn't create entry: ${err.message}. Make sure your database has properties named: "Name" (title), "Due Date" (date), "Class" (select), "Status" (status).`
    };
  }
}

async function syncAll(assignments, token, databaseId, includeDescription) {
  const results = [];
  for (const a of assignments) {
    try {
      if (!a.name) { results.push({ ...a, status: 'skipped' }); continue; }
      const existing = await findExisting(a.name, token, databaseId);
      if (existing) {
        await updatePage(existing.id, a, token, includeDescription);
        results.push({ ...a, status: 'updated' });
      } else {
        await createPage(a, token, databaseId, includeDescription);
        results.push({ ...a, status: 'created' });
      }
    } catch (err) {
      console.error('[D2L→Notion] Sync error for', a.name, err);
      results.push({ ...a, status: 'error', error: err.message });
    }
  }
  return results;
}

async function findExisting(name, token, databaseId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({ filter: { property: 'Name', title: { equals: name } }, page_size: 1 })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Notion query failed');
  return data.results[0] || null;
}

async function createPage(a, token, databaseId, includeDescription) {
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildProperties(a, includeDescription)
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Create page failed');
  return data;
}

async function updatePage(pageId, a, token, includeDescription) {
  const props = buildProperties(a, includeDescription);
  delete props.Status;
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ properties: props })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Update page failed');
  return data;
}

function buildProperties(a, includeDescription) {
  const props = {
    Name: { title: [{ text: { content: a.name } }] },
    Status: { status: { name: a.status || 'Not started' } }
  };
  if (a.dueDate) props['Due Date'] = { date: { start: a.dueDate } };
  if (a.course) props['Class'] = { select: { name: a.course } };
  if (includeDescription && a.description) {
    props['Description'] = { rich_text: [{ text: { content: a.description.slice(0, 2000) } }] };
  }
  return props;
}

function notionHeaders(token) {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Notion-Version': '2022-06-28'
  };
}
