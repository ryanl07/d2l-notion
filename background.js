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

  // Cache the schema for this database so we know what property types exist
  await chrome.storage.local.set({
    [`schema_${databaseId}`]: dbData.properties
  });

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
      error: `Connected, but couldn't create entry: ${err.message}.`
    };
  }
}

async function syncAll(assignments, token, databaseId, includeDescription) {
  // Load the database schema so we know what each property's type is
  const schema = await getSchema(token, databaseId);

  const results = [];
  for (const a of assignments) {
    try {
      if (!a.name) { results.push({ ...a, status: 'skipped' }); continue; }
      const existing = await findExisting(a.name, token, databaseId);
      if (existing) {
        await updatePage(existing.id, a, token, includeDescription, schema);
        results.push({ ...a, status: 'updated' });
      } else {
        await createPage(a, token, databaseId, includeDescription, schema);
        results.push({ ...a, status: 'created' });
      }
    } catch (err) {
      console.error('[D2L→Notion] Sync error for', a.name, err);
      results.push({ ...a, status: 'error', error: err.message });
    }
  }
  return results;
}

// Fetch the database schema (property names + types) and cache it
async function getSchema(token, databaseId) {
  const cached = await chrome.storage.local.get(`schema_${databaseId}`);
  if (cached[`schema_${databaseId}`]) {
    return cached[`schema_${databaseId}`];
  }
  const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers: notionHeaders(token)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Could not fetch schema');
  await chrome.storage.local.set({ [`schema_${databaseId}`]: data.properties });
  return data.properties;
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

async function createPage(a, token, databaseId, includeDescription, schema) {
  if (!schema) schema = await getSchema(token, databaseId);
  const res = await fetch('https://api.notion.com/v1/pages', {
    method: 'POST',
    headers: notionHeaders(token),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: buildProperties(a, includeDescription, schema)
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Create page failed');
  return data;
}

async function updatePage(pageId, a, token, includeDescription, schema) {
  if (!schema) schema = await getSchema(token, databaseId);
  const props = buildProperties(a, includeDescription, schema);
  delete props.Status; // preserve user's existing progress
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ properties: props })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Update page failed');
  return data;
}

// Build properties payload based on what actually exists in the user's database.
// Adapts automatically to select vs multi_select, skips missing properties, etc.
function buildProperties(a, includeDescription, schema) {
  const props = {};

  // Find property names case-insensitively so variations like "name" or "NAME" still work
  const find = (wanted) => {
    if (!schema) return null;
    const key = Object.keys(schema).find(k => k.toLowerCase() === wanted.toLowerCase());
    return key ? { name: key, type: schema[key].type } : null;
  };

  // Title (Name)
  const titleProp = find('Name') || (schema && Object.keys(schema).find(k => schema[k].type === 'title'));
  const titleKey = typeof titleProp === 'string' ? titleProp : titleProp?.name;
  if (titleKey) {
    props[titleKey] = { title: [{ text: { content: a.name } }] };
  }

  // Status
  const statusProp = find('Status');
  if (statusProp) {
    if (statusProp.type === 'status') {
      props[statusProp.name] = { status: { name: a.status || 'Not started' } };
    } else if (statusProp.type === 'select') {
      props[statusProp.name] = { select: { name: a.status || 'Not started' } };
    }
  }

  // Due Date
  const dueProp = find('Due Date') || find('Due');
  if (dueProp && a.dueDate && dueProp.type === 'date') {
    props[dueProp.name] = { date: { start: a.dueDate } };
  }

  // Class (handle both select and multi_select)
  const classProp = find('Class') || find('Course') || find('Subject');
  if (classProp && a.course) {
    if (classProp.type === 'select') {
      props[classProp.name] = { select: { name: a.course } };
    } else if (classProp.type === 'multi_select') {
      props[classProp.name] = { multi_select: [{ name: a.course }] };
    } else if (classProp.type === 'rich_text') {
      props[classProp.name] = { rich_text: [{ text: { content: a.course } }] };
    }
  }

  // Description (only if enabled AND property exists)
  if (includeDescription && a.description) {
    const descProp = find('Description') || find('Notes') || find('Details');
    if (descProp && descProp.type === 'rich_text') {
      props[descProp.name] = { rich_text: [{ text: { content: a.description.slice(0, 2000) } }] };
    }
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
