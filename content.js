chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getCalendarInfo') {
    try {
      const baseUrl = window.location.origin;
      let ouId = null;
      const calLink = document.querySelector('a[href*="/d2l/le/calendar/"]');
      if (calLink) {
        const m = calLink.href.match(/\/d2l\/le\/calendar\/(\d+)/);
        if (m) ouId = m[1];
      }
      if (!ouId) {
        const pageMatch = window.location.pathname.match(/\/d2l\/le\/calendar\/(\d+)/);
        if (pageMatch) ouId = pageMatch[1];
      }
      sendResponse({ baseUrl, ouId });
    } catch (err) {
      console.error('[D2L→Notion] Content script error:', err);
      sendResponse({ baseUrl: window.location.origin, ouId: null, error: err.message });
    }
    return true;
  }

  if (msg.action === 'scrapePearson') {
    try {
      const assignments = scrapePearsonPage();
      console.log('[D2L→Notion] Pearson scraped', assignments.length, 'assignment(s):', assignments);
      sendResponse({ assignments });
    } catch (err) {
      console.error('[D2L→Notion] Pearson scrape error:', err);
      sendResponse({ assignments: [], error: err.message });
    }
    return true;
  }

  return true;
});

// -----------------------------------------------------------
// Pearson scraper
// -----------------------------------------------------------
function scrapePearsonPage() {
  const results = [];
  const course = 'PEARSON';
  const dueRegex = /\bDUE\s+([A-Z]{3,9}\s+\d{1,2})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?\b/i;
  const seen = new Set();
  const { currentMarker, endMarker } = getPearsonSectionMarkers();
  const links = Array.from(document.querySelectorAll('a'));

  for (const link of links) {
    const name = normalizeText(link.textContent);
    if (!isLikelyAssignmentName(name)) continue;
    if (!isInsideCurrentAssignments(link, currentMarker, endMarker)) continue;

    const due = findDueInAncestor(link, dueRegex);
    if (!due) continue;

    const dueDate = parsePearsonDueDate(due.datePart, due.timePart);
    const key = `${name}|${dueDate || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      name,
      course,
      dueDate,
      description: '',
      status: 'Not started'
    });
  }

  if (results.length === 0) {
    return scrapePearsonFromText(course, dueRegex);
  }

  return results;
}

function normalizeText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

function isLikelyAssignmentName(name) {
  if (!name || name.length < 4 || name.length > 300) return false;
  if (/^(course home|assignments?|student gradebook|etextbook contents|interactive etextbook|study plan|video & resource library|purchase options|accessible resources|study prep|help|today|month|week)$/i.test(name)) return false;
  if (/^(current|completed|past due)\s+assignments?/i.test(name)) return false;
  if (/^(due|score)$/i.test(name)) return false;
  return true;
}

function getPearsonSectionMarkers() {
  const candidates = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, div, span, p'));
  const currentMarker = candidates.find(el => {
    const text = normalizeText(el.textContent);
    return !!text && text.length <= 80 && /^current assignments?\b/i.test(text);
  }) || null;
  let endMarker = null;

  if (currentMarker) {
    for (const el of candidates) {
      if (!nodeComesBefore(currentMarker, el)) continue;
      const text = normalizeText(el.textContent);
      if (!text || text.length > 80) continue;
      if (/^(completed assignments?|past due assignments?)\b/i.test(text)) {
        endMarker = el;
        break;
      }
    }
  }

  return { currentMarker, endMarker };
}

function nodeComesBefore(a, b) {
  if (!a || !b) return false;
  const pos = a.compareDocumentPosition(b);
  return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING);
}

function isInsideCurrentAssignments(link, currentMarker, endMarker) {
  if (!currentMarker) return true;
  if (!nodeComesBefore(currentMarker, link)) return false;
  if (endMarker && !nodeComesBefore(link, endMarker)) return false;
  return true;
}

function findDueInAncestor(startNode, dueRegex) {
  let node = startNode;
  for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
    const text = normalizeText(node.innerText || node.textContent);
    if (!text || text.length > 2000) continue;
    const m = text.match(dueRegex);
    if (m) {
      return {
        datePart: m[1],
        timePart: m[2] || ''
      };
    }
  }
  return null;
}

function parsePearsonDueDate(datePart, timePart) {
  const m = normalizeText(datePart).toUpperCase().match(/^([A-Z]{3,9})\s+(\d{1,2})$/);
  if (!m) return null;

  const monthNames = {
    JAN: 0, JANUARY: 0,
    FEB: 1, FEBRUARY: 1,
    MAR: 2, MARCH: 2,
    APR: 3, APRIL: 3,
    MAY: 4,
    JUN: 5, JUNE: 5,
    JUL: 6, JULY: 6,
    AUG: 7, AUGUST: 7,
    SEP: 8, SEPT: 8, SEPTEMBER: 8,
    OCT: 9, OCTOBER: 9,
    NOV: 10, NOVEMBER: 10,
    DEC: 11, DECEMBER: 11
  };

  const month = monthNames[m[1]];
  const day = parseInt(m[2], 10);
  if (month == null || !Number.isFinite(day)) return null;

  const now = new Date();
  let year = now.getFullYear();

  let hours = 0;
  let minutes = 0;
  let hasTime = false;
  if (timePart) {
    const tm = normalizeText(timePart).toUpperCase().match(/^(\d{1,2}):(\d{2})\s*([AP]M)$/);
    if (tm) {
      hasTime = true;
      hours = parseInt(tm[1], 10) % 12;
      minutes = parseInt(tm[2], 10);
      if (tm[3] === 'PM') hours += 12;
    }
  }

  let parsed = new Date(year, month, day, hours, minutes, 0, 0);
  // If the parsed date is far in the past, assume it's for the next calendar year.
  if (parsed.getTime() < now.getTime() - 120 * 24 * 60 * 60 * 1000) {
    year += 1;
    parsed = new Date(year, month, day, hours, minutes, 0, 0);
  }

  if (isNaN(parsed.getTime())) return null;
  return hasTime ? parsed.toISOString() : parsed.toISOString().split('T')[0];
}

function scrapePearsonFromText(course, dueRegex) {
  const text = document.body ? document.body.innerText || '' : '';
  if (!text) return [];

  const section = extractCurrentAssignmentsSection(text);
  const lines = section.split('\n').map(normalizeText).filter(Boolean);
  const results = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const due = line.match(dueRegex);
    if (!due) continue;

    const name = findNearbyAssignmentName(lines, i);
    if (!isLikelyAssignmentName(name)) continue;

    const dueDate = parsePearsonDueDate(due[1], due[2] || '');
    const key = `${name}|${dueDate || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      name,
      course,
      dueDate,
      description: '',
      status: 'Not started'
    });
  }

  return results;
}

function findNearbyAssignmentName(lines, dueLineIndex) {
  for (let i = dueLineIndex - 1; i >= 0 && i >= dueLineIndex - 8; i--) {
    const candidate = normalizeText(lines[i]);
    if (!candidate) continue;
    if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)$/i.test(candidate)) continue;
    if (/^\d{1,2}$/.test(candidate)) continue;
    if (/^\d+\s+of\s+\d+\s+questions$/i.test(candidate)) continue;
    if (/^score\s*:/i.test(candidate)) continue;
    if (isLikelyAssignmentName(candidate)) return candidate;
  }
  return '';
}

function extractCurrentAssignmentsSection(fullText) {
  const normalized = fullText.replace(/\r/g, '');
  const start = normalized.search(/Current Assignments?\b/i);
  if (start < 0) return normalized;

  const tail = normalized.slice(start);
  const endMatch = tail.match(/(?:Completed Assignments?|Past Due Assignments?)\b/i);
  if (!endMatch) return tail;
  return tail.slice(0, endMatch.index);
}
