chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrape') {
    scrapeCalendarPage()
      .then(assignments => {
        console.log('[D2L→Notion] Scraped', assignments.length, 'assignment(s):', assignments);
        sendResponse({ assignments });
      })
      .catch(err => {
        console.error('[D2L→Notion] Scrape error:', err);
        sendResponse({ assignments: [], error: err.message });
      });
  }
  return true;
});

async function scrapeCalendarPage() {
  let results = scrapeListView();
  if (results.length === 0) results = scrapeAgendaView();
  await enrichWithCourseInfo(results);

  const seen = new Set();
  return results.filter(r => {
    const key = `${r.name}|${r.dueDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return !!r.name;
  });
}

function scrapeListView() {
  const results = [];
  const rows = document.querySelectorAll('a[href*="event/"], [role="button"], li');

  for (const row of rows) {
    const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 10 || text.length > 1000) continue;

    // Brightspace List view rows look like:
    //   "Asynchronous Quiz 20 - Availability Ends Apr 19, 2026 11:59 PM"
    // OR (when the row also contains course info in the text):
    //   "Asynchronous Quiz 20 - Availability Ends Spring 2026 EAPS 105 DIS - Merge Asynchronous Quiz 20"
    //
    // We look for the FIRST event-type keyword ("Due", "Availability Ends", etc.)
    // and split around it. Then extract date/time from whatever comes after.

    const eventTypeRegex = /\s+-\s+(Due|Availability Ends|Available Until|Submission|End Date|Start Date|Ends|Starts)\b/i;
    const evMatch = text.match(eventTypeRegex);
    if (!evMatch) continue;

    const name = text.slice(0, evMatch.index).trim();
    const eventType = evMatch[1];
    const afterEventType = text.slice(evMatch.index + evMatch[0].length).trim();

    if (/^(start|starts)/i.test(eventType)) continue;
    if (!name || name.length < 2 || name.length > 200) continue;

    // Find the date within whatever comes after the event type.
    // Pattern: "Month Day, Year [Time AM/PM]" — may be preceded by course info.
    const dateRegex = /([A-Za-z]+\s+\d{1,2},?\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/i;
    const dateMatch = afterEventType.match(dateRegex);
    if (!dateMatch) continue;

    const dateStr = dateMatch[1].trim();
    const parsed = new Date(dateStr);
    if (isNaN(parsed)) continue;

    const hasTime = /\d{1,2}:\d{2}/.test(dateStr);
    const dueDate = hasTime ? parsed.toISOString() : parsed.toISOString().split('T')[0];

    // Anything between the event type and the date MIGHT be course info.
    // Example: "Spring 2026 EAPS 105 DIS - Merge" appearing before the date.
    const beforeDate = afterEventType.slice(0, dateMatch.index).trim();
    const afterDate = afterEventType.slice(dateMatch.index + dateMatch[0].length).trim();
    const courseCandidates = [beforeDate, afterDate];
    let inlineCourse = null;
    for (const candidate of courseCandidates) {
      if (!candidate) continue;
      const cleaned = cleanCourseName(candidate);
      if (cleaned) { inlineCourse = cleaned; break; }
    }

    // Capture the event detail link for fetching course info if not inline
    const link = row.tagName === 'A'
      ? row.href
      : (row.querySelector && row.querySelector('a[href*="event"]') || {}).href
        || (row.closest && row.closest('a') || {}).href;

    results.push({
      name,
      course: inlineCourse || 'Unknown',
      dueDate,
      description: '',
      status: 'Not started',
      _eventUrl: link || null
    });
  }

  return results;
}

function scrapeAgendaView() {
  const results = [];
  const mainContent = document.querySelector('main, #d2l_body_content') || document.body;
  const lines = extractLinesFromVisibleElements(mainContent);

  let currentDate = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    const dateHeader = line.match(/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    if (dateHeader) {
      const parsed = new Date(dateHeader[2]);
      if (!isNaN(parsed)) currentDate = parsed.toISOString().split('T')[0];
      i++;
      continue;
    }

    const titleMatch = line.match(/^(.+?)\s+-\s+(Due|Availability Ends|Available Until|Submission|End Date|Ends)\s*$/i);
    if (titleMatch && currentDate) {
      const name = titleMatch[1].trim();
      let course = 'Unknown';
      const descLines = [];
      let dueDateTime = currentDate;
      let j = i + 1;
      const lookaheadLimit = Math.min(lines.length, i + 20);

      while (j < lookaheadLimit) {
        const next = lines[j];
        if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),/i.test(next)) break;
        if (/^.+\s+-\s+(Due|Availability Ends|Available Until|Submission|End Date|Ends)\s*$/i.test(next)) break;

        if (course === 'Unknown') {
          const c = cleanCourseName(next);
          if (c) { course = c; j++; continue; }
        }

        const dueFull = next.match(/Due\s+([A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?)\s+at\s+(\d{1,2}:\d{2}\s*[AP]M)/i);
        if (dueFull) {
          const ds = /\d{4}/.test(dueFull[1]) ? dueFull[1] : `${dueFull[1]}, ${new Date().getFullYear()}`;
          const full = new Date(`${ds} ${dueFull[2]}`);
          if (!isNaN(full)) dueDateTime = full.toISOString();
          j++;
          continue;
        }

        if (/^(starts|ends)\s+/i.test(next)) { j++; continue; }
        if (/^\d{1,2}:\d{2}\s*[AP]M$/i.test(next)) { j++; continue; }
        if (next.length > 3 && next.length < 500) descLines.push(next);
        j++;
      }

      results.push({
        name,
        course,
        dueDate: dueDateTime,
        description: descLines.join(' ').slice(0, 1500),
        status: 'Not started'
      });
      i = j;
      continue;
    }
    i++;
  }
  return results;
}

async function enrichWithCourseInfo(results) {
  const toFetch = results.filter(r => r.course === 'Unknown' && r._eventUrl);
  if (toFetch.length === 0) {
    results.forEach(r => delete r._eventUrl);
    return;
  }

  const BATCH = 4;
  for (let i = 0; i < toFetch.length; i += BATCH) {
    const batch = toFetch.slice(i, i + BATCH);
    await Promise.all(batch.map(async (r) => {
      try {
        const html = await fetchPage(r._eventUrl);
        const info = parseEventDetailHtml(html);
        if (info.course) r.course = info.course;
        if (info.description && !r.description) r.description = info.description.slice(0, 1500);
      } catch (err) {
        console.warn('[D2L→Notion] Could not fetch event details for', r.name, err);
      }
    }));
  }
  results.forEach(r => delete r._eventUrl);
}

async function fetchPage(url) {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

function parseEventDetailHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const text = doc.body ? (doc.body.innerText || doc.body.textContent || '') : '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let course = null;
  const descLines = [];
  for (const line of lines) {
    if (!course) {
      const c = cleanCourseName(line);
      if (c) course = c;
    }
    if (line.length > 30 && line.length < 500 && !/^(due|starts|ends|available)/i.test(line)) {
      descLines.push(line);
    }
  }
  return { course, description: descLines.slice(0, 3).join(' ') };
}

function extractLinesFromVisibleElements(root) {
  const lines = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (el) => (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName))
      ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
  });
  let node;
  while ((node = walker.nextNode())) {
    const directText = Array.from(node.childNodes)
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .filter(Boolean)
      .join(' ');
    if (directText && directText.length < 1000) lines.push(directText);
  }
  return lines.filter((l, idx) => l !== lines[idx - 1]);
}

function cleanCourseName(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, ' ').trim();
  const hasCourseCode = /[A-Z]{2,5}\s*\d{3,5}/.test(s);
  const hasSemester = /^(Spring|Summer|Fall|Winter|Autumn)\s+\d{4}/i.test(s);
  if (!hasCourseCode && !hasSemester) return null;
  s = s.replace(/^(Spring|Summer|Fall|Winter|Autumn)\s+\d{4}\s+/i, '');
  s = s.replace(/\s*-\s*(Merge|Section\s*\d+|Sec\s*\d+|DIS|LEC|REC|LAB|Online).*$/i, '');
  if (s.length < 2 || s.length > 100) return null;
  return s;
}
