# gcp-wizard

A Chrome extension that makes working with Google Cloud Storage faster:

- **Clickable `gs://` links** on any web page — click to jump straight to the Cloud Console.
- **Omnibox & popup shortcuts** — type a `gs://` path without leaving the keyboard.
- **Dataproc log viewer** — one click to read `driveroutput.*` files as plain text, right in the browser.

---

## Features

### 1 — `gs://` link detection (all pages)

Every `gs://bucket/path` that appears as plain text on any page is automatically turned into a clickable link. Clicking opens the path in the Cloud Storage browser (or the object-details view for individual files).

Works on GitHub, internal wikis, Jira, Confluence, CI dashboards, log viewers — anywhere `gs://` paths appear as text.

### 2 — Omnibox keyword shortcut

Type `gs` in the Chrome address bar, press <kbd>Tab</kbd>, paste a `gs://bucket/path`, hit <kbd>Enter</kbd>.

The `gs://` prefix is optional — `gs` <kbd>Tab</kbd> `my-bucket/path/file` works too.

### 3 — Toolbar popup

Click the toolbar icon (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>) to open a small form. Paste a `gs://` path, optionally override the project, hit **Open in Console**.

### 4 — Per-user default project

Open the extension's **Options** page and set a default GCP project ID (e.g. `wmt-adtech-reporting-dev`). It is appended as `?project=…` to every Console URL when you don't specify one explicitly.

### 5 — Dataproc log viewer (console.cloud.google.com)

On any Cloud Console page, `driveroutput.000000000` (and `driveroutput.000000001`, etc.) references are annotated with a **📄 View log** pill button.

Clicking the pill:

1. Authenticates via `chrome.identity` (OAuth2 / `devstorage.read_only`).
2. Fetches the requested chunk **and all subsequent numbered chunks** (`…001`, `…002`, …) until a 404 — multi-part Dataproc outputs are concatenated automatically.
3. Opens a dedicated viewer tab showing the log as formatted text:
   - Line numbers
   - Log-level colouring — `FATAL` / `ERROR` (red), `WARN` (yellow), `INFO` (normal), `DEBUG` (grey)
   - Timestamp highlighting
   - **Copy** button and **Open raw** fallback link

---

## URL translation

| `gs://` path | Cloud Console URL |
|---|---|
| `gs://my-bucket` | `.../storage/browser/my-bucket?project=<default>` |
| `gs://my-bucket/logs/2026/04/` | `.../storage/browser/my-bucket/logs/2026/04?project=<default>` |
| `gs://my-bucket/logs/2026/04/events.json` | `.../storage/browser/_details/my-bucket/logs/2026/04/events.json` |

---

## Project layout

```
gcp-wizard/
├── public/                    Static assets copied verbatim into dist/
│   ├── manifest.json          Chrome extension manifest (MV3)
│   ├── popup.html / .css      Toolbar popup
│   ├── options.html           Options page
│   ├── content.css            Styles for gs:// links & "View log" pills
│   ├── viewer.html / .css     Dataproc log viewer page
│   └── icons/                 16/32/48/128 px icons
├── src/
│   ├── background.ts          Service worker — omnibox wiring
│   ├── popup.ts               Popup controller
│   ├── options.ts             Options-page controller
│   ├── content.ts             gs:// link detector (all pages)
│   ├── dataproc.ts            driveroutput annotator (console.cloud.google.com)
│   ├── viewer.ts              Dataproc log viewer logic
│   └── lib/
│       ├── gcsPath.ts         gs:// ↔ Cloud Console URL translation
│       └── settings.ts        chrome.storage.sync helpers
├── package.json
├── tsconfig.json
├── CHANGELOG.md
└── README.md
```

---

## Development

**Prerequisites:** Node.js 18+

```bash
npm install
npm run build        # compile TypeScript + copy static assets → dist/
npm run watch        # rebuild on every save
npm run typecheck    # strict tsc --noEmit (no emit, type-check only)
```

### Load the extension in Chrome

1. `npm run build`
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** → select the `dist/` folder.
5. Open the extension **Options** and set your default project ID.

---

## OAuth2 setup for the log viewer

The Dataproc log viewer fetches GCS objects using `chrome.identity.getAuthToken` with the `devstorage.read_only` scope. For **developer-mode extensions** this works automatically as long as Chrome is signed in with a Google account that has access to the bucket.

If you see an authentication error, register an OAuth2 client:

1. Open [GCP Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials).
2. **Create credentials → OAuth 2.0 Client ID → Chrome App**.
3. Paste the extension's ID (shown in `chrome://extensions`).
4. Copy the generated **Client ID** and add it to `public/manifest.json`:

```json
"oauth2": {
  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",
  "scopes": ["https://www.googleapis.com/auth/devstorage.read_only"]
}
```

5. `npm run build` and reload the extension.

---

## Notes

- Uses **Manifest V3** with a module service worker.
- Permissions requested: `storage`, `tabs`, `identity`, and `host_permissions` for `<all_urls>` (content script injection) and `https://storage.googleapis.com/*` (log fetch).
- Each path segment is `encodeURIComponent`-encoded individually so `/` characters stay structural in Console URLs.
- The `MutationObserver` in both content scripts ensures that `gs://` paths and `driveroutput.*` references added by SPAs or streaming UIs are picked up without a page reload.
