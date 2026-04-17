// Runs in the context of the Brightspace page.
// Listens for a message from the popup and returns scraped assignments.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'scrape') {
    try {
      const assignments = scrapeAssignments();
      sendResponse({ assignments });
    } catch (err) {
      console.error('Scrape error:', err);
      sendResponse({ assignments: [], error: err.message });
    }
  }
  return true; // keep channel open
});

function scrapeAssignments() {
  const results = [];
  const courseName = detectCourseName();

  // --- Strategy 1: Assignment Dropbox page (d2l/lms/dropbox/...) ---
  // Rows usually contain assignment name + due date
  document.querySelectorAll('table tr').forEach(row => {
    const nameLink = row.querySelector('a[href*="dropbox"], a[href*="quizzing"], a[href*="activities"]');
    if (!nameLink) return;

    const name = nameLink.textContent.trim();
    if (!name) return;

    // Look for a due date anywhere in the row
    const rowText = row.textContent;
    const due = extractDueDate(rowText);
    const description = row.querySelector('.d2l-table-cell-last, .d2l-description')?.textContent?.trim() || '';

    if (name) {
      results.push({
        name,
        course: courseName,
        dueDate: due,
        description: description.slice(0, 500),
        status: 'Not started'
      });
    }
  });

  // --- Strategy 2: Course content / upcoming events widget ---
  document.querySelectorAll('d2l-activity-name, .d2l-le-upcomingevents li, .d2l-activityitem').forEach(el => {
    const name = el.textContent.trim().split('\n')[0];
    if (!name || results.some(r => r.name === name)) return;

    const containerText = el.closest('li, tr, .d2l-datalist-item')?.textContent || el.textContent;
    const due = extractDueDate(containerText);

    results.push({
      name,
      course: courseName,
      dueDate: due,
      description: '',
      status: 'Not started'
    });
  });

  // --- Strategy 3: Calendar/events list ---
  document.querySelectorAll('.d2l-calendar-event, [data-type="event"]').forEach(el => {
    const nameEl = el.querySelector('.d2l-calendar-event-title, a');
    if (!nameEl) return;
    const name = nameEl.textContent.trim();
    if (!name || results.some(r => r.name === name)) return;

    const due = extractDueDate(el.textContent);
    results.push({
      name,
      course: courseName,
      dueDate: due,
      description: '',
      status: 'Not started'
    });
  });

  // Dedupe by name
  const seen = new Set();
  return results.filter(r => {
    if (seen.has(r.name)) return false;
    seen.add(r.name);
    return true;
  });
}

function detectCourseName() {
  // Try common places where course name appears
  const candidates = [
    document.querySelector('.d2l-navigation-s-title'),
    document.querySelector('h1.d2l-page-title'),
    document.querySelector('[data-course-name]'),
    document.querySelector('.d2l-breadcrumb-text'),
    document.querySelector('.d2l-navigation-s-title-container')
  ];

  for (const el of candidates) {
    if (el && el.textContent.trim()) {
      return normalizeCourseName(el.textContent.trim());
    }
  }

  // Fallback: parse from page title
  const title = document.title;
  const match = title.match(/([A-Z]{2,4}\s?\d{3,4})/);
  return match ? match[1].replace(/\s+/g, ' ') : (title.split('-')[0].trim() || 'Unknown');
}

function normalizeCourseName(name) {
  // Extract things like "CS 193" or "MA 261" from longer strings
  const match = name.match(/([A-Z]{2,4})\s*(\d{3,4})/);
  if (match) return `${match[1]} ${match[2]}`;
  return name.slice(0, 40);
}

function extractDueDate(text) {
  if (!text) return null;

  // Patterns like "Due: Apr 17, 2026" or "Due April 17, 2026 11:59 PM"
  const patterns = [
    /Due[:\s]+([A-Za-z]+ \d{1,2},? \d{4}(?:\s+\d{1,2}:\d{2}\s*[AP]M)?)/i,
    /Available until\s+([A-Za-z]+ \d{1,2},? \d{4})/i,
    /(\d{1,2}\/\d{1,2}\/\d{4})/,
    /([A-Za-z]{3,9} \d{1,2},? \d{4})/
  ];

  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const parsed = new Date(m[1]);
      if (!isNaN(parsed)) return parsed.toISOString().split('T')[0]; // YYYY-MM-DD
    }
  }
  return null;
}
