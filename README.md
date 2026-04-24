# gcp-wizard

A Chrome extension that gives you a **shortcut to open any `gs://` path** directly in the Google Cloud Console — no manual URL rewriting.

## Features

- **Omnibox keyword shortcut.** Type `gs` in the address bar, press <kbd>Tab</kbd>, paste a `gs://bucket/path` and hit <kbd>Enter</kbd>. You land on the matching bucket / folder / object in the Cloud Console.
- **Popup UI.** Click the toolbar icon (or <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>) to paste a path into a small form and open it.
- **Per-user default project.** Set a default GCP project in the options page; it will be appended as `?project=…` whenever you don't specify one explicitly.
- **Smart URL mapping.** Buckets and prefixes open the Storage browser view; individual objects open the object-details view.

## URL translation

| gs:// path                                  | Cloud Console URL                                                                                             |
|---------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| `gs://my-bucket`                            | `https://console.cloud.google.com/storage/browser/my-bucket?project=<default>`                                |
| `gs://my-bucket/logs/2026/04/`              | `https://console.cloud.google.com/storage/browser/my-bucket/logs/2026/04?project=<default>`                   |
| `gs://my-bucket/logs/2026/04/events.json`   | `https://console.cloud.google.com/storage/browser/_details/my-bucket/logs/2026/04/events.json?project=<…>`    |

The `?project=…` query parameter is only added if you set a default project or type one in the popup.

## Project layout

```
gcp-wizard/
├── public/                Static assets copied verbatim into dist/
│   ├── manifest.json      Chrome extension manifest (MV3)
│   ├── popup.html / .css  Toolbar popup
│   ├── options.html       Options page
│   └── icons/             16/32/48/128 px icons
├── src/
│   ├── background.ts      Service worker — omnibox wiring
│   ├── popup.ts           Popup controller
│   ├── options.ts         Options-page controller
│   └── lib/
│       ├── gcsPath.ts     gs:// ↔ Cloud Console URL translation
│       └── settings.ts    chrome.storage.sync helpers
├── package.json
├── tsconfig.json
└── README.md
```

## Development

Prerequisites: Node.js 18+.

```bash
npm install
npm run build        # produces ./dist
npm run watch        # rebuild on change
npm run typecheck    # strict tsc --noEmit
```

### Load the extension in Chrome

1. `npm run build`
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right).
4. Click **Load unpacked** and pick the `dist/` folder.
5. (Optional) Open the extension's **Options** and set your default project ID, e.g. `wmt-adtech-reporting-dev`.

### Using the shortcut

- **Omnibox:** `gs` <kbd>Tab</kbd> `gs://my-bucket/path/to/file` <kbd>Enter</kbd>
  (the `gs://` prefix is optional — `gs` <kbd>Tab</kbd> `my-bucket/path` also works).
- **Toolbar popup:** click the icon or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>, paste the path, hit **Open in Console**.

## Notes

- Uses **Manifest V3** with a module service worker.
- Only requests the `storage` and `tabs` permissions — no host permissions are needed because the extension merely opens URLs.
- Bucket/object path segments are percent-encoded individually so that `/` characters remain structural separators in the Console URL.
