// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

/**
 * Log viewer page for Dataproc driver-output files.
 *
 * URL format:  viewer.html?gs=gs%3A%2F%2Fbucket%2Fpath%2Fdriveroutput.000000000
 *
 * Auth:  chrome.identity.getAuthToken (requires the extension's oauth2.scopes
 * to include devstorage.read_only — see README for setup instructions).
 *
 * Chunk discovery:  if the requested path ends with a zero-padded number
 * (e.g. driveroutput.000000000) the viewer automatically fetches subsequent
 * chunks (…001, …002, …) until it hits a 404, then concatenates them all.
 */

import { parseGsPath } from "./lib/gcsPath";

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChunkResult {
  index: number;
  text: string;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

function getAuthToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message ?? "getAuthToken failed"));
      if (!token) return reject(new Error("No OAuth token was returned."));
      resolve(token);
    });
  });
}

// ---------------------------------------------------------------------------
// GCS fetch
// ---------------------------------------------------------------------------

/** Fetch one GCS object.  Returns null on 404, throws on other errors. */
async function fetchChunk(
  bucket: string,
  objectPath: string,
  token: string,
): Promise<string | null> {
  // Each segment must be encoded individually so '/' stays structural in the URL.
  const encodedObject = objectPath
    .split("/")
    .map(encodeURIComponent)
    .join("/");

  const url =
    `https://storage.googleapis.com/storage/v1/b/` +
    `${encodeURIComponent(bucket)}/o/${encodedObject}?alt=media`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}${body ? `: ${body}` : ""}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// Chunk discovery
// ---------------------------------------------------------------------------

interface ParsedChunkPath {
  /** Full object path up to (but not including) the numeric suffix. */
  base: string;
  /** Starting numeric suffix, e.g. "000000000". */
  startSuffix: string | null;
  /** Number of zero-padding digits. */
  digits: number;
}

const NUMERIC_SUFFIX_RE = /^(.*?)\.(\d{3,})$/;

function parseChunkPath(objectPath: string): ParsedChunkPath {
  const m = objectPath.match(NUMERIC_SUFFIX_RE);
  if (!m) return { base: objectPath, startSuffix: null, digits: 0 };
  return { base: m[1], startSuffix: m[2], digits: m[2].length };
}

function buildChunkPath(base: string, index: number, digits: number): string {
  return `${base}.${String(index).padStart(digits, "0")}`;
}

/**
 * Fetch the requested chunk and all subsequent numbered chunks in order.
 * Returns an array of { index, text } sorted by index.
 */
async function fetchAllChunks(
  bucket: string,
  objectPath: string,
  token: string,
  onProgress: (fetched: number) => void,
): Promise<ChunkResult[]> {
  const { base, startSuffix, digits } = parseChunkPath(objectPath);

  // No numeric suffix → single file.
  if (startSuffix === null) {
    const text = await fetchChunk(bucket, objectPath, token);
    return text !== null ? [{ index: 0, text }] : [];
  }

  const startIndex = parseInt(startSuffix, 10);
  const MAX_CHUNKS = 200; // guard rail
  const results: ChunkResult[] = [];

  for (let i = startIndex; i < startIndex + MAX_CHUNKS; i++) {
    const path = buildChunkPath(base, i, digits);
    const text = await fetchChunk(bucket, path, token);
    if (text === null) break; // 404 → end of chunks
    results.push({ index: i, text });
    onProgress(results.length);
  }

  return results;
}

// ---------------------------------------------------------------------------
// Log highlighting
// ---------------------------------------------------------------------------

const HIGHLIGHT_RULES: Array<{ re: RegExp; cls: string }> = [
  { re: /\b(FATAL|CRITICAL)\b/,  cls: "lvl-fatal"   },
  { re: /\b(ERROR|SEVERE)\b/,    cls: "lvl-error"   },
  { re: /\b(WARN(?:ING)?)\b/,   cls: "lvl-warn"    },
  { re: /\b(INFO)\b/,            cls: "lvl-info"    },
  { re: /\b(DEBUG|TRACE)\b/,     cls: "lvl-debug"   },
];

/** Timestamp patterns: ISO-8601, or Java-style (yy/mm/dd hh:mm:ss). */
const TIMESTAMP_RE =
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/;

function classifyLine(line: string): string {
  for (const rule of HIGHLIGHT_RULES) {
    if (rule.re.test(line)) return rule.cls;
  }
  return "";
}

/** Render the entire log text into the pre#log element with line numbers. */
function renderLog(pre: HTMLPreElement, text: string): void {
  const lines = text.split("\n");
  // Trim a single trailing empty line produced by a final newline.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const padWidth = String(lines.length).length;
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const cls = classifyLine(raw);

    const row = document.createElement("span");
    row.className = `log-line${cls ? ` ${cls}` : ""}`;

    const num = document.createElement("span");
    num.className = "ln";
    num.textContent = String(i + 1).padStart(padWidth, " ");

    const content = document.createElement("span");
    content.className = "lc";

    // Highlight timestamp in the line.
    const tsMatch = raw.match(TIMESTAMP_RE);
    if (tsMatch && tsMatch.index !== undefined) {
      content.appendChild(document.createTextNode(raw.slice(0, tsMatch.index)));
      const ts = document.createElement("span");
      ts.className = "ts";
      ts.textContent = tsMatch[0];
      content.appendChild(ts);
      content.appendChild(document.createTextNode(raw.slice(tsMatch.index + tsMatch[0].length)));
    } else {
      content.textContent = raw;
    }

    row.appendChild(num);
    row.appendChild(content);
    fragment.appendChild(row);
    fragment.appendChild(document.createTextNode("\n"));
  }

  pre.innerHTML = "";
  pre.appendChild(fragment);
}

// ---------------------------------------------------------------------------
// Copy to clipboard
// ---------------------------------------------------------------------------

async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btn.textContent;
    btn.textContent = "✓ Copied!";
    btn.disabled = true;
    setTimeout(() => {
      btn.textContent = orig;
      btn.disabled = false;
    }, 1500);
  } catch {
    // Fallback for older browsers / sandboxed contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const gsParam = params.get("gs");

  const titleEl        = byId<HTMLHeadingElement>("title");
  const subtitleEl     = byId<HTMLParagraphElement>("subtitle");
  const statusEl       = byId<HTMLDivElement>("status");
  const logContainer   = byId<HTMLDivElement>("log-container");
  const logPre         = byId<HTMLPreElement>("log");
  const copyBtn        = byId<HTMLButtonElement>("copyBtn");
  const rawBtn         = byId<HTMLButtonElement>("rawBtn");
  const retryBtn       = byId<HTMLButtonElement>("retryBtn");

  function showStatus(msg: string, isError = false): void {
    statusEl.textContent = msg;
    statusEl.className = isError ? "status error" : "status";
    statusEl.hidden = false;
    logContainer.hidden = true;
  }

  function showLog(fullText: string, chunkCount: number, gsPath: string): void {
    const { bucket, objectPath } = parseGsPath(gsParam ?? "") as {
      bucket: string;
      objectPath: string;
    };

    subtitleEl.textContent =
      chunkCount > 1
        ? `${chunkCount} chunks · ${formatBytes(fullText.length)}`
        : formatBytes(fullText.length);

    statusEl.hidden = true;
    logContainer.hidden = false;
    renderLog(logPre, fullText);

    copyBtn.addEventListener("click", () => void copyToClipboard(fullText, copyBtn));

    const rawUrl = `https://storage.cloud.google.com/${bucket}/${objectPath}`;
    rawBtn.addEventListener("click", () => window.open(rawUrl, "_blank"));
  }

  function formatBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  // Validate the gs param.
  if (!gsParam) {
    showStatus("No gs:// path provided in the URL.", true);
    return;
  }

  let parsed: ReturnType<typeof parseGsPath>;
  try {
    parsed = parseGsPath(gsParam);
  } catch (err) {
    showStatus(`Invalid gs:// path: ${err instanceof Error ? err.message : String(err)}`, true);
    return;
  }

  titleEl.textContent = gsParam;

  async function load(): Promise<void> {
    showStatus("Authenticating…");
    retryBtn.hidden = true;

    let token: string;
    try {
      token = await getAuthToken();
    } catch (err) {
      showStatus(
        `Authentication failed: ${err instanceof Error ? err.message : String(err)}\n\n` +
          "To fix this, follow the OAuth2 setup instructions in the README.",
        true,
      );
      retryBtn.hidden = false;
      return;
    }

    showStatus("Fetching log chunks…");

    let chunks: ChunkResult[];
    try {
      chunks = await fetchAllChunks(
        parsed.bucket,
        parsed.objectPath || parsed.bucket, // objectPath is empty only for bare bucket refs
        token,
        (n) => showStatus(`Fetching log chunks… (${n} so far)`),
      );
    } catch (err) {
      showStatus(
        `Failed to fetch log: ${err instanceof Error ? err.message : String(err)}`,
        true,
      );
      retryBtn.hidden = false;
      return;
    }

    if (chunks.length === 0) {
      showStatus("File not found (404). The log may have been deleted or the path is incorrect.", true);
      retryBtn.hidden = false;
      return;
    }

    const fullText = chunks.map((c) => c.text).join("");
    showLog(fullText, chunks.length, gsParam);
  }

  retryBtn.addEventListener("click", () => void load());

  await load();
}

void main();
