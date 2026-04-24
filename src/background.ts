// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

/**
 * Service worker: wires up the omnibox keyword ("gs") so users can type
 *     gs <Tab> gs://bucket/path/to/object
 * in the address bar and be taken straight to that path in the Cloud Console.
 */

import { gsPathToConsoleUrl, parseGsPath, GsPathError, CONSOLE_ORIGIN } from "./lib/gcsPath";
import { getSettings } from "./lib/settings";

const DEFAULT_SUGGESTION =
  "Type a <match>gs://bucket/path</match> to open it in the Cloud Console.";

chrome.runtime.onInstalled.addListener(() => {
  chrome.omnibox.setDefaultSuggestion({ description: DEFAULT_SUGGESTION });
});

// When Chrome starts up, also (re)set the default suggestion — the service
// worker may be spun up fresh without onInstalled firing.
chrome.omnibox.setDefaultSuggestion({ description: DEFAULT_SUGGESTION });

/**
 * Normalize a raw omnibox query into a gs:// path.
 * Users may type the path with or without the leading `gs://` after the keyword.
 */
function normalizeQuery(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  return /^gs:\/\//i.test(text) ? text : `gs://${text}`;
}

chrome.omnibox.onInputChanged.addListener((rawText, suggest) => {
  const text = normalizeQuery(rawText);
  if (!text) {
    suggest([]);
    return;
  }

  try {
    const parsed = parseGsPath(text);
    const description = parsed.objectPath
      ? `Open <match>${escapeOmniboxXml(text)}</match> — ${parsed.isFolder ? "prefix" : "object"} in bucket <dim>${escapeOmniboxXml(parsed.bucket)}</dim>`
      : `Open bucket <match>${escapeOmniboxXml(parsed.bucket)}</match> in the Cloud Console`;
    suggest([
      {
        content: text,
        description,
      },
    ]);
  } catch {
    suggest([]);
  }
});

chrome.omnibox.onInputEntered.addListener(async (rawText, disposition) => {
  const text = normalizeQuery(rawText);
  if (!text) return;

  try {
    const settings = await getSettings();
    const url = gsPathToConsoleUrl(text, { project: settings.defaultProject });
    await openUrl(url, disposition);
  } catch (err) {
    const message =
      err instanceof GsPathError ? err.message : "Failed to open the gs:// path.";
    // As a fallback, land on the Console's storage overview so the user at
    // least ends up somewhere useful, and log the reason for debugging.
    console.warn("[gcp-wizard] omnibox error:", message);
    const fallback = `${CONSOLE_ORIGIN}/storage/overview`;
    await openUrl(fallback, disposition);
  }
});

async function openUrl(
  url: string,
  disposition: chrome.omnibox.OnInputEnteredDisposition,
): Promise<void> {
  switch (disposition) {
    case "currentTab":
      await chrome.tabs.update({ url });
      return;
    case "newForegroundTab":
      await chrome.tabs.create({ url, active: true });
      return;
    case "newBackgroundTab":
      await chrome.tabs.create({ url, active: false });
      return;
  }
}

/**
 * Chrome's omnibox descriptions use a tiny XML-like markup; any user-supplied
 * text interpolated into it must be escaped so stray '<' and '&' don't break rendering.
 */
function escapeOmniboxXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
