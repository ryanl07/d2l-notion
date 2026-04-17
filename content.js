chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'getCalendarInfo') {
    try {
      const baseUrl = window.location.origin;

      // Try to find the calendar org unit ID from a calendar link on the page
      let ouId = null;
      const calLink = document.querySelector('a[href*="/d2l/le/calendar/"]');
      if (calLink) {
        const m = calLink.href.match(/\/d2l\/le\/calendar\/(\d+)/);
        if (m) ouId = m[1];
      }

      // If the user is already on the calendar page, grab it from the URL
      if (!ouId) {
        const pageMatch = window.location.pathname.match(/\/d2l\/le\/calendar\/(\d+)/);
        if (pageMatch) ouId = pageMatch[1];
      }

      sendResponse({ baseUrl, ouId });
    } catch (err) {
      console.error('[D2L→Notion] Content script error:', err);
      sendResponse({ baseUrl: window.location.origin, ouId: null, error: err.message });
    }
  }
  return true;
});