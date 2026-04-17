# D2L + Pearson → Notion Sync

A browser extension that syncs assignments from **D2L Brightspace** and **Pearson MyLab** into a single **Notion** database. No API keys from your school required — it scrapes data directly from each platform using your existing logged-in session.

## 🚀 Installation

### Prerequisites

- **Brave**, **Chrome**, or **Edge** (any Chromium-based browser)
- A **Notion** account with a database ready to receive assignments
- An active D2L Brightspace account (optional if you only want Pearson)
- An active Pearson MyLab account (optional if you only want Brightspace)

### Step 1 — Clone or Download This Repo

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
3. (Optional) Set your **Sync window** — how far ahead to pull Brightspace assignments (2 weeks to 1 year)
4. Click **🔌 Test Notion Connection** — this creates a test entry in your database to verify everything works
5. If the test succeeds, you're ready to sync!

## 📖 Usage

### Syncing from Brightspace

1. Open any Brightspace page while logged in
2. Click the extension icon → **Sync Assignments (Brightspace)**
3. The extension fetches all assignments within your configured sync window across every course

Your course code (e.g. `CS 19300`, `EAPS 105 DIS`) is automatically extracted and used as the `Class` tag in Notion.

### Syncing from Pearson MyLab

1. Navigate to your course home page on `mylabmastering.pearson.com`
2. Make sure the **Current Assignments** section is expanded
3. Click the extension icon → **Sync Assignments (Pearson)**
4. Only assignments in the "Current Assignments" section are synced

All Pearson assignments are tagged with `PEARSON` as their `Class` in Notion, so you can easily filter for them or distinguish them from Brightspace items.

### Re-syncing

You can run either sync as often as you want. Entries are deduplicated by name, and your `Status` column is preserved when an existing entry is updated — so progress you've made ("In progress", "Done") won't be overwritten.

## 🐛 Troubleshooting

**"Could not establish connection. Receiving end does not exist."**
The content script isn't loaded on the current tab. Hard-refresh the page (`Cmd+Shift+R` on Mac, `Ctrl+Shift+R` on Windows) after reloading the extension.

**"No assignments found in the selected window" (Brightspace)**
Make sure you're logged into Brightspace. Check the service worker console (at `brave://extensions` → "Inspect views: service worker") for `[D2L→Notion]` log messages. If the log shows `Parser found 0 events` but the fetch returned HTML, your school's Brightspace may use a different layout — open an issue with the log output.

**"No current assignments found on this Pearson page"**
- Make sure you're on your course's **home page**, not a specific assignment
- Ensure the **Current Assignments** section is expanded (click the `∧` arrow to toggle it open)
- The extension needs `all_frames` permission because Pearson renders course content in an iframe — if you recently installed or reloaded the extension, hard-refresh the Pearson page

**"Invalid Notion token"**
Your integration token is wrong or has been regenerated. Check at [notion.so/my-integrations](https://www.notion.so/my-integrations).

**"Database not found"**
The database ID is wrong, OR your integration hasn't been connected to the database. Open the database → "..." → Connections → add your integration.

**"Class is expected to be multi_select" / "X is not a property that exists"**
The extension auto-adapts to your schema — make sure you're on the latest version of `background.js`.

**Class column shows "Unknown" for Brightspace assignments**
The course code isn't being extracted from the calendar row. Open the service worker console and check the `[D2L→Notion]` logs to see what was scraped. If this keeps happening, your school's Brightspace may label courses differently — open an issue with a sample of the raw HTML.

**Settings page won't open / popup is broken**
You likely have a syntax error from partially-updated files. Delete `popup.js` entirely and replace it with the latest version, then reload the extension.

## 🔐 Privacy

This extension:
- ✅ Only runs on Brightspace, Pearson MyLab, and Notion API domains (see `manifest.json`)
- ✅ Stores your Notion token locally using `chrome.storage.local` (never sent anywhere except Notion's API)
- ✅ Uses your existing Brightspace and Pearson session cookies (no login credentials stored)
- ❌ Does NOT send data to any third-party server
- ❌ Does NOT include any analytics or tracking

All scraping happens in your own browser. Your Notion token never leaves your device except when making direct calls to `api.notion.com`.
