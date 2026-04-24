# Changelog

All notable changes to **gcp-wizard** are documented here.  
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

---

## [0.1.0] — 2026-04-24

### Added

#### `gs://` link detection — all pages
- New content script (`content.ts`) runs on every page at `document_idle`.
- Scans all text nodes for `gs://bucket[/path]` URIs using a `TreeWalker`.
- Wraps each match in a clickable `<a class="gcp-wizard-gs-link">` that opens the path in the Cloud Storage browser (bucket/prefix) or the object-details view (individual files), with the configured default project appended as `?project=…`.
- Trailing sentence punctuation (`.`, `,`, `!`, etc.) is stripped from the match so prose like "see `gs://bucket/file.`" linkifies correctly.
- A `MutationObserver` ensures paths injected by SPAs or log-streaming UIs are linkified without a page reload.
- Skips `<script>`, `<style>`, `<textarea>`, `<input>`, `<a>`, and other non-content tags.
- Dark-mode aware via `@media (prefers-color-scheme: dark)` in `content.css`.

#### Dataproc log viewer — `console.cloud.google.com`
- New content script (`dataproc.ts`) runs exclusively on `console.cloud.google.com` at `document_idle`.
- Detects `driveroutput.XXXXXXXXX` (and `driveroutput` without a numeric suffix) in:
  - `.gcp-wizard-gs-link` anchors already annotated by `content.ts`.
  - Raw text nodes containing a full `gs://…driveroutput…` URI.
- Injects a **📄 View log** pill button (`<a class="gcp-wizard-log-btn">`) immediately after each detected reference. The pill is idempotent — repeated DOM mutations never produce duplicate buttons.
- A `MutationObserver` handles dynamically rendered job-details panels and SPA navigation. A 600 ms deferred re-scan covers the case where `dataproc.ts` starts before `content.ts` has finished linkifying.

#### Log viewer page (`viewer.html`)
- Opens as a full browser tab at `chrome-extension://.../viewer.html?gs=<encoded-path>`.
- Authenticates via `chrome.identity.getAuthToken` (`devstorage.read_only` scope).
- Fetches the requested chunk and all subsequent zero-padded chunks (`…000`, `…001`, `…002`, …) sequentially, stopping at the first 404. Supports up to 200 chunks per session.
- Concatenates all chunks and renders the combined log with:
  - **Line numbers** (right-aligned, non-selectable).
  - **Log-level colouring**: `FATAL`/`CRITICAL` (bold red), `ERROR`/`SEVERE` (red), `WARN`/`WARNING` (yellow), `INFO` (default), `DEBUG`/`TRACE` (grey).
  - **Timestamp highlighting** — ISO-8601 and Java-style (`yy/mm/dd hh:mm:ss`) patterns coloured in blue.
- **Copy** button — copies the full raw text to the clipboard.
- **Open raw** fallback — opens `https://storage.cloud.google.com/{bucket}/{object}` in a new tab (uses browser cookies; works without OAuth setup).
- **Retry** button shown on auth or fetch failures, with a descriptive error message.
- Terminal-style dark theme with full light-mode support via `prefers-color-scheme`.

#### Omnibox keyword shortcut (`background.ts`)
- Keyword `gs` registered in the Chrome address bar.
- Type `gs` <kbd>Tab</kbd> `gs://bucket/path` <kbd>Enter</kbd> to navigate instantly.
- The `gs://` prefix is optional — bare `bucket/path` is accepted.
- Inline suggestions show whether the target is a bucket, prefix, or object.
- Respects `currentTab` / `newForegroundTab` / `newBackgroundTab` disposition.
- Falls back to the Cloud Storage overview page on parse errors.

#### Toolbar popup (`popup.html` / `popup.ts`)
- Keyboard shortcut <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> opens the popup.
- Accepts a `gs://` path and an optional project override.
- Pre-fills the project placeholder with the saved default if one is set.
- Opens the translated URL in a new tab and closes the popup.

#### Options page (`options.html` / `options.ts`)
- Persists a default GCP project ID in `chrome.storage.sync`.
- The stored project is appended as `?project=…` to all Console URLs produced by the popup, omnibox, and link-detector features.

#### Build tooling
- TypeScript 5.x with strict mode (`noImplicitAny`, `noUnusedLocals`, `noUnusedParameters`).
- esbuild bundles each entry point to a self-contained IIFE targeting Chrome 120+.
- `copyfiles` copies static assets (`manifest.json`, HTML, CSS, icons) to `dist/`.
- `npm run watch` for incremental development builds.
- `npm run typecheck` for type-only validation without emitting files.

### Technical notes
- Manifest V3 with a module service worker (`"type": "module"`).
- Permissions: `storage`, `tabs`, `identity`.
- Host permissions: `<all_urls>` (content script injection), `https://storage.googleapis.com/*` (GCS API calls from the viewer).
- `oauth2.scopes`: `https://www.googleapis.com/auth/devstorage.read_only` — no `client_id` required for developer-mode installs; see README for production OAuth2 setup.
