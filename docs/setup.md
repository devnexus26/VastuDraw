# VastuDraw Pro — Setup & Deployment Guide

## File Structure

```
vastudraw-pro/
├── src/
│   ├── index.html          ← Main app (open this in a browser or host it)
│   └── appsscript.gs       ← Google Apps Script backend (paste into Apps Script editor)
└── docs/
    └── SETUP.md            ← This file
```

---

## Prerequisites

- A Google account
- A Google Sheet (you'll create one in Step 1)
- Any static file host (or just open `index.html` locally)

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a **new blank spreadsheet**
2. Name it: `VastuDraw Pro Database`
3. Copy the **Sheet ID** from the URL bar:
   ```
   https://docs.google.com/spreadsheets/d/  <<<SHEET_ID>>>  /edit
   ```
   It's the long string between `/d/` and `/edit`

---

## Step 2 — Set Up the Apps Script

1. In your Google Sheet, go to **Extensions → Apps Script**
2. Delete all existing code in the editor
3. Paste the entire contents of `appsscript.gs` into the editor
4. At the top of the file, replace:
   ```javascript
   const SHEET_ID = 'YOUR_GOOGLE_SHEET_ID_HERE';
   ```
   with your actual Sheet ID from Step 1:
   ```javascript
   const SHEET_ID = '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms';
   ```
5. Click **Save** (Ctrl+S / Cmd+S)

---

## Step 3 — Create Sheet Tabs & Headers

1. In the Apps Script editor, select the function `setupSheets` from the dropdown
2. Click **▶ Run**
3. A permissions dialog will appear — click **Review permissions** → **Allow**
4. Back in your Google Sheet, you should now see 3 tabs:
   - `Users`
   - `Comments`
   - `Layouts`

---

## Step 4 — Add Users

### Option A: Use the seed function (quickest for testing)

1. In the Apps Script editor, select `seedTestUsers` from the dropdown
2. Click **▶ Run**
3. This creates these test accounts:

   | Email | Password | Role |
   |-------|----------|------|
   | consultant@vastudraw.com | Vastu@2024 | consultant |
   | client1@example.com | Client@123 | client (CLI001) |
   | client2@example.com | Client@456 | client (CLI002) |

### Option B: Add users manually (for production)

1. In the Apps Script editor, open the **Console** (bottom panel)
2. Call `addUser()` from a temporary function, for example:
   ```javascript
   function myAddUser() {
     addUser('newclient@example.com', 'SecurePass123', 'client', 'Amit Patel', 'CLI003');
   }
   ```
3. Run `myAddUser()` — it hashes the password and writes the row to the Users sheet

> **Never type passwords directly into the Sheet** — always use `addUser()` so passwords get hashed.

---

## Step 5 — Deploy the Apps Script as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**
2. Click the ⚙️ gear icon next to "Select type" → choose **Web app**
3. Configure:
   - **Description**: VastuDraw Pro API v1
   - **Execute as**: Me (your Google account)
   - **Who has access**: Anyone
4. Click **Deploy**
5. Copy the **Web App URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

---

## Step 6 — Connect the App to the API

1. Open `src/index.html` in a text editor
2. Find this line near the top of the `<script>` section:
   ```javascript
   const API_URL = 'YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
   ```
3. Replace it with your Web App URL:
   ```javascript
   const API_URL = 'https://script.google.com/macros/s/AKfycb.../exec';
   ```
4. Save the file

---

## Step 7 — Run the App

Open `src/index.html` in any modern browser (Chrome, Firefox, Edge, Safari).

That's it. No server needed.

> **Tip for hosting**: Drop `index.html` onto any static host:
> - [GitHub Pages](https://pages.github.com)
> - [Netlify Drop](https://app.netlify.com/drop)
> - [Vercel](https://vercel.com)
> - Google Drive (share publicly, open with preview)

---

## How Roles Work

### Consultant
- Sees the full canvas editor (left tools panel, right properties panel)
- Can select any client from the **Client dropdown** in the top bar
- Can draw, edit, save layouts, export PDFs
- Can **reply** to client comments
- Layout auto-saves to the cloud every 5 seconds after a change

### Client
- Logs in and sees their own layout (read-only canvas)
- Cannot draw or modify anything
- Can open the **💬 Comments panel** and leave questions/feedback
- Cannot see other clients' data

---

## Google Sheets Structure Reference

### `Users` tab
| Column | Description |
|--------|-------------|
| email | Login email (lowercase) |
| hashed_password | SHA-256 hash of password |
| role | `consultant` or `client` |
| name | Display name |
| client_id | Unique ID for clients (e.g. CLI001), blank for consultants |

### `Comments` tab
| Column | Description |
|--------|-------------|
| id | Auto-generated unique ID |
| client_id | Which client this comment belongs to |
| room_tab | Which room tab the comment is about |
| author | Name of the commenter |
| role | `client` or `consultant` |
| message | Comment text |
| timestamp | ISO 8601 datetime |
| parent_id | ID of parent comment (for replies), blank for top-level |

### `Layouts` tab
| Column | Description |
|--------|-------------|
| client_id | Which client owns this layout |
| layout_json | Full JSON snapshot of the canvas state |
| updated_at | Last save timestamp |

---

## Re-deploying After Code Changes

If you update `appsscript.gs`:
1. Go to **Deploy → Manage deployments**
2. Click the ✏️ Edit icon
3. Change version to **New version**
4. Click **Deploy**

> The Web App URL stays the same — no need to update `index.html`

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Login says "Connection failed" | Check that `API_URL` is set correctly and the Web App is deployed with "Anyone" access |
| Login says "Invalid email or password" | Make sure you used `addUser()` (not manual entry) so the password is hashed |
| Comments not loading | Check that the `Comments` sheet tab name matches exactly |
| Layout not saving | Check that the `Layouts` sheet tab exists and has the right headers |
| CORS errors in browser | Redeploy the Apps Script with "Anyone" access |
| Apps Script asks for permission every time | Run `setupSheets` once manually to grant permissions |