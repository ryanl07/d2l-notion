chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'fetchAndSync') {
    fetchAndSync(msg)
      .then(results => sendResponse({ results }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
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

// -----------------------------------------------------------
// BRIGHTSPACE: fetch multiple months and sync
// -----------------------------------------------------------
async function fetchAndSync({ baseUrl, ouId, syncWindow, notionToken, databaseId, syncDescription }) {
  const monthsToFetch = getMonthsForWindow(syncWindow || '3m');
  console.log(`[D2L→Notion] Fetching ${monthsToFetch.length} month(s) from ${baseUrl}/d2l/le/calendar/${ouId}`);

  const fetches = monthsToFetch.map(d => fetchCalendarMonth(baseUrl, ouId, d));
  const responses = await Promise.all(fetches);

  const allAssignments = [];
  for (let i = 0; i < responses.length; i++) {
    const response = responses[i];
    if (!response) {
      console.warn(`[D2L→Notion] Month ${i + 1} returned no data`);
      continue;
    }
    const parsed = parseCalendarHtml(response.html);
    console.log(`[D2L→Notion] Month ${i + 1}: parsed ${parsed.length} events`);
    allAssignments.push(...parsed);
  }

  const seen = new Set();
  const deduped = allAssignments.filter(a => {
    const key = `${a.name}|${a.dueDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !!a.name;
  });
  console.log(`[D2L→Notion] After dedupe: ${deduped.length} unique assignments`);

  if (deduped.length === 0) return [];
  return await syncAll(deduped, notionToken, databaseId, syncDescription);
}

function getMonthsForWindow(win) {
  const counts = { '2w': 1, '1m': 1, '3m': 3, '6m': 6, '1y': 12 };
  const count = counts[win] || 3;
  const months = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    months.push(d);
  }
  return months;
}

async function fetchCalendarMonth(baseUrl, ouId, date) {
  const day = 1;
  const month = date.getMonth() + 1;
  const year = date.getFullYear();

  const url = `${baseUrl}/d2l/le/calendar/${ouId}/home/eventspanepartial?` +
    `searchInfo=&year=${year}&month=${month}&day=${day}` +
    `&_d2l_prc%24headingLevel=2&_d2l_prc%24scope=&_d2l_prc%24hasActiveForm=false&isXhr=true`;

  console.log(`[D2L→Notion] Fetching: ${url}`);
  try {
    const res = await fetch(url, {
      credentials: 'include',
      headers: {
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    if (!res.ok) {
      console.warn(`[D2L→Notion] ${res.status} for ${url}`);
      return null;
    }
    let body = await res.text();
    body = body.replace(/^while\(1\);\s*/, '');
    const data = JSON.parse(body);
    const html = data && data.Payload && data.Payload.Html;
    if (!html) {
      console.warn('[D2L→Notion] No Html in payload');
      return null;
    }
    console.log(`[D2L→Notion] Got ${html.length} chars of event HTML`);
    return { html };
  } catch (err) {
    console.warn(`[D2L→Notion] Fetch error:`, err.message);
    return null;
  }
}

function parseCalendarHtml(html) {
  const results = [];
  const processed = new Set();

  // Each event has: <a ... title="Homework 6 – Due" ... class="d2l-offscreen">
  const titleRegex = /<a[^>]+title="([^"]+)"[^>]*class="d2l-offscreen"/gi;

  let titleMatch;
  while ((titleMatch = titleRegex.exec(html)) !== null) {
    const fullTitle = decodeHtmlEntities(titleMatch[1]).trim();
    if (processed.has(fullTitle)) continue;
    processed.add(fullTitle);

    // D2L uses en-dash (–) not hyphen (-) between name and event type
    const evMatch = fullTitle.match(
      /^(.+?)\s+[\-\u2013\u2014]\s+(Due|Availability Ends|Available Until|Submission|End Date|Start Date|Ends|Starts|Available)\s*$/i
    );
    if (!evMatch) continue;

    const name = evMatch[1].trim();
    const eventType = evMatch[2].trim();
    if (/^(available|start|starts)$/i.test(eventType)) continue;

    const searchRegion = html.slice(titleMatch.index, titleMatch.index + 3000);

    const courseMatch = searchRegion.match(/d2l-le-calendar-dot-circle[^>]*title="([^"]+)"/i);
    let course = 'Unknown';
    if (courseMatch) {
      course = cleanCourseName(decodeHtmlEntities(courseMatch[1])) || 'Unknown';
    }

    const datePattern = /([A-Z][a-z]{2,8}\s+\d{1,2},\s+\d{4}\s+\d{1,2}:\d{2}\s*[AP]M)/i;
    const dateMatch = searchRegion.match(datePattern);
    if (!dateMatch) continue;

    const parsed = new Date(dateMatch[1]);
    if (isNaN(parsed)) continue;

    results.push({
      name,
      course,
      dueDate: parsed.toISOString(),
      description: '',
      status: 'Not started'
    });
  }

  console.log(`[D2L→Notion] Parser found ${results.length} events`);
  return results;
}

function decodeHtmlEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function cleanCourseName(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, ' ').trim();
  s = s.replace(/^(Spring|Summer|Fall|Winter|Autumn)\s+\d{4}\s+/i, '');
  s = s.replace(/\s*-\s*(Merge|Section\s*\d+|Sec\s*\d+|DIS|LEC|REC|LAB|Online).*$/i, '');
  if (s.length < 2 || s.length > 100) return null;
  return s;
}

// -----------------------------------------------------------
// NOTION SYNC
// -----------------------------------------------------------
async function testNotionConnection(token, databaseId) {
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: 'GET',
    headers: notionHeaders(token)
  });
  const dbData = await dbRes.json();
  if (!dbRes.ok) {
    if (dbRes.status === 401) {
      return { success: false, error: 'Invalid Notion token.' };
    }
    if (dbRes.status === 404) {
      return { success: false, error: 'Database not found. Make sure your integration is connected to the database.' };
    }
    return { success: false, error: `Notion error (${dbRes.status}): ${dbData.message || 'Unknown'}` };
  }

  await chrome.storage.local.set({ [`schema_${databaseId}`]: dbData.properties });

  const testName = `🔌 Test — ${new Date().toLocaleString()}`;
  const testAssignment = {
    name: testName,
    course: 'Extension Test',
    dueDate: new Date().toISOString().split('T')[0],
    description: 'Test entry. Safe to delete.',
    status: 'Not started'
  };

  try {
    await createPage(testAssignment, token, databaseId, true, dbData.properties);
    return { success: true, testName };
  } catch (err) {
    return { success: false, error: `Connected, but couldn't create entry: ${err.message}.` };
  }
}

async function syncAll(assignments, token, databaseId, includeDescription) {
  const schema = await getSchema(token, databaseId);

  const results = [];
  for (const a of assignments) {
    try {
      if (!a.name) { results.push({ ...a, status: 'skipped' }); continue; }
      const existing = await findExisting(a.name, token, databaseId);
      if (existing) {
        await updatePage(existing.id, a, token, includeDescription, schema, databaseId);
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

async function getSchema(token, databaseId) {
  const cached = await chrome.storage.local.get(`schema_${databaseId}`);
  if (cached[`schema_${databaseId}`]) return cached[`schema_${databaseId}`];

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

async function updatePage(pageId, a, token, includeDescription, schema, databaseId) {
  if (!schema) schema = await getSchema(token, databaseId);
  const props = buildProperties(a, includeDescription, schema);
  delete props.Status; // preserve user's progress
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: notionHeaders(token),
    body: JSON.stringify({ properties: props })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Update page failed');
  return data;
}

function buildProperties(a, includeDescription, schema) {
  const props = {};
  const find = (wanted) => {
    if (!schema) return null;
    const key = Object.keys(schema).find(k => k.toLowerCase() === wanted.toLowerCase());
    return key ? { name: key, type: schema[key].type } : null;
  };

  const titleProp = find('Name') || (schema && { name: Object.keys(schema).find(k => schema[k].type === 'title'), type: 'title' });
  if (titleProp && titleProp.name) {
    props[titleProp.name] = { title: [{ text: { content: a.name } }] };
  }

  const statusProp = find('Status');
  if (statusProp) {
    if (statusProp.type === 'status') {
      props[statusProp.name] = { status: { name: a.status || 'Not started' } };
    } else if (statusProp.type === 'select') {
      props[statusProp.name] = { select: { name: a.status || 'Not started' } };
    }
  }

  const dueProp = find('Due Date') || find('Due');
  if (dueProp && a.dueDate && dueProp.type === 'date') {
    props[dueProp.name] = { date: { start: a.dueDate } };
  }

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