# D2L → Notion Sync

A browser extension that syncs assignments from **D2L Brightspace** to your **Notion** database. No API key from your school required — it scrapes assignments directly from the Brightspace calendar page using your existing logged-in session.

## 🚀 Installation

### Prerequisites

- **Brave**, **Chrome**, or **Edge** (any Chromium-based browser)
- A **Notion** account with a database ready to receive assignments
- An active D2L Brightspace account

### Step 1 — Clone or Download This Repo

```bash
git clone https://github.com/YOUR_USERNAME/d2l-notion-sync.git
```

Or download the ZIP from GitHub and extract it.

### Step 2 — Set Up Your Notion Integration

1. Go to [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Click **New integration** → give it a name (e.g. "D2L Sync") → copy the **Internal Integration Token** (starts with `secret_` or `ntn_`)
3. Open your Notion database page → click **"..."** (top-right) → **Connections** → add the integration you just created
4. Copy the database ID from the URL. If your URL is:
   ```
   https://notion.so/workspace/abc123def456...?v=xyz
   ```
   The database ID is `abc123def456...` — **only the 32-character part before `?v=`**

### Step 3 — Configure Your Notion Database

Your database needs these properties:

| Property Name | Type | Required |
| --- | --- | --- |
| `Name` | Title | ✅ Yes |
| `Due Date` | Date | ✅ Yes |
| `Class` | Select *or* Multi-select | ✅ Yes |
| `Status` | Status *or* Select | ✅ Yes |
| `Description` | Text | Optional |

The extension auto-detects whether `Class` and `Status` are `select` or `multi_select`/`status` types, so you don't need to change your existing database.

### Step 4 — Load the Extension

1. Open `brave://extensions` (or `chrome://extensions`)
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `d2l-notion-sync` folder

### Step 5 — Configure and Test

1. Click the extension icon → ⚙️ **Settings**
2. Paste your Notion token and database ID → **Save**
3. Click **🔌 Test Notion Connection** — this creates a test entry in your database to verify everything works
4. If the test succeeds, you're ready to sync!

## 📖 Usage

1. In Brightspace, go to **Calendar** (top navigation)
2. Use either **List view** (recommended) or **Agenda view**
3. Make sure **All Calendars** is selected in the top-right dropdown
4. Click the extension icon → **Sync Assignments**
5. Wait ~10-20 seconds on the first sync (it fetches course info for each event)

Re-run the sync anytime to pick up new assignments or updated due dates. Your `Status` column is never overwritten, so your progress is preserved.

## 🐛 Troubleshooting

**"Could not establish connection. Receiving end does not exist."**
The content script isn't loaded on the current tab. Hard-refresh the Brightspace page (`Cmd+Shift+R` on Mac, `Ctrl+Shift+R` on Windows) after reloading the extension.

**"No assignments found"**
Make sure you're on the Brightspace **Calendar** page with List or Agenda view selected. Verify **All Calendars** is selected in the top-right filter.

**"Invalid Notion token"**
Your integration token is wrong or has been regenerated. Check at [notion.so/my-integrations](https://www.notion.so/my-integrations).

**"Database not found"**
The database ID is wrong, OR your integration hasn't been connected to the database. Open the database → "..." → Connections → add your integration.

**"Class is expected to be multi_select" / "X is not a property that exists"**
The extension auto-adapts to your schema — make sure you're on the latest version of `background.js`.

**Class column shows "Unknown"**
The course code isn't being extracted from the calendar row. Open DevTools (F12) on the calendar page and check the console for `[D2L→Notion]` logs to see what was scraped.

**Settings page won't open / popup is broken**
You likely have a syntax error from partially-updated files. Delete `popup.js` entirely and replace it with the latest version, then reload the extension.

## 🔐 Privacy

This extension:
- ✅ Only runs on Brightspace and Notion API domains (see `manifest.json`)
- ✅ Stores your Notion token locally using `chrome.storage.local` (never sent anywhere except Notion's API)
- ✅ Uses your existing Brightspace session cookies (no login credentials stored)
- ❌ Does NOT send data to any third-party server
- ❌ Does NOT include any analytics or tracking

All scraping happens in your own browser. Your Notion token never leaves your device except when making direct calls to `api.notion.com`.
