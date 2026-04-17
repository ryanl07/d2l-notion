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

  // Find all elements that contain a "DUE <date>" text pattern
  const dueRegex = /DUE\s+([A-Z]{3,9}\s+\d{1,2})(?:\s+(\d{1,2}:\d{2}\s*[AP]M))?/i;
  const allRows = document.querySelectorAll('li, tr, div, section, article');

  const seenNames = new Set();
  let inCurrentSection = false;

  for (const row of allRows) {
    const rawText = row.textContent || '';
    const text = rawText.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    // Detect section transitions
    if (/^current assignments?\b/i.test(text) && text.length < 80) {
      inCurrentSection = true;
    } else if (/^(completed assignments?|past due assignments?)\b/i.test(text) && text.length < 80) {
      inCurrentSection = false;
    }

    const dueMatch = text.match(dueRegex);
    if (!dueMatch) continue;

    // Skip rows that are too big (likely container elements with many children)
    if (text.length > 500) continue;

    // Try to find the assignment name — a link, strong text, or the first meaningful text
    let name = null;
    const link = row.querySelector('a');
    if (link && link.textContent.trim()) {
      name = link.textContent.trim();
    } else {
      const strong = row.querySelector('strong, b, [class*="title"], [class*="name"]');
      if (strong && strong.textContent.trim()) {
        name = strong.textContent.trim();
      }
    }
    if (!name) continue;

    name = name.replace(/\s+/g, ' ').trim();
    if (name.length < 2 || name.length > 300) continue;
    if (/^(current|completed|past due|due|score)/i.test(name)) continue;
    if (seenNames.has(name)) continue;
    seenNames.add(name);

    // Parse the due date — "APR 23" or "APR 23 11:59 PM"
    const datePart = dueMatch[1];
    const timePart = dueMatch[2] || '';
    const year = new Date().getFullYear();
    const fullDateStr = timePart
      ? `${datePart} ${year} ${timePart}`
      : `${datePart} ${year}`;
    const parsed = new Date(fullDateStr);
    const dueDate = isNaN(parsed)
      ? null
      : (timePart ? parsed.toISOString() : parsed.toISOString().split('T')[0]);

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