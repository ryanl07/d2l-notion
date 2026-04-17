chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'syncToNotion') {
    syncAll(msg.assignments, msg.notionToken, msg.databaseId, msg.syncDescription)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ results: [{ status: 'error', name: 'SYNC', error: err.message }] }));
    return true; // async
  }
});

async function syncAll(assignments, token, databaseId, includeDescription) {
  const results = [];

  for (const a of assignments) {
    try {
      if (!a.name) {
        results.push({ ...a, status: 'skipped', reason: 'no name' });
        continue;
      }

      // Check if assignment already exists
      const existing = await findExisting(a.name, a.course, token, databaseId);

      if (existing) {
        await updatePage(existing.id, a, token, includeDescription);
        results.push({ ...a, status: 'updated' });
      } else {
        await createPage(a, token, databaseId, includeDescription);
        results.push({ ...a, status: 'created' });
      }
    } catch (err) {
      console.error('Sync error for', a.name, err);
      results.push({ ...a, status: 'error', error: err.message });
    }
  }
  return results;
}

async function findExisting(name, course, token, databaseId) {
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      filter: {
        and: [
          { property: 'Name', title: { equals: name } }
        ]
      },
      page_size: 1
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Notion query failed');
  return data.results[0] || null;
}

async function createPage(a, token, databaseId, includeDescription) {
  const properties = buildProperties(a, includeDescription);

  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Create page failed');
  return data;
}

async function updatePage(pageId, a, token, includeDescription) {
  const properties = buildProperties(a, includeDescription);
  // Don't overwrite Status when updating — preserve user's progress
  delete properties.Status;

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ properties })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Update page failed');
  return data;
}

function buildProperties(a, includeDescription) {
  const props = {
    Name: { title: [{ text: { content: a.name } }] }
  };

  if (a.dueDate) {
    props['Due Date'] = { date: { start: a.dueDate } };
  }

  if (a.course) {
    props.Class = { select: { name: a.course } };
  }

  props.Status = { status: { name: a.status || 'Not started' } };

  if (includeDescription && a.description) {
    props.Description = { rich_text: [{ text: { content: a.description.slice(0, 2000) } }] };
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
