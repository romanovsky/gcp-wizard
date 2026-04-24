// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

/**
 * Content script for console.cloud.google.com:
 *
 * Scans the page for Dataproc driver-output log file references
 * (e.g. `driveroutput.000000000`) and adds a "📄 View log" pill button
 * next to each one.  Clicking the button opens the full file content
 * in a dedicated viewer tab.
 *
 * Works with both:
 *   • gs:// links already annotated by content.ts (.gcp-wizard-gs-link)
 *   • Raw text nodes containing a full gs://…driveroutput… path
 */

import { parseGsPath } from "./lib/gcsPath";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches a driveroutput filename (with or without a zero-padded chunk number). */
const DRIVEROUTPUT_RE = /driveroutput(?:\.\d+)?/;

/**
 * Matches a complete gs:// URI that contains driveroutput anywhere in the path.
 * Stops at whitespace and common surrounding punctuation (same rules as gcsPath.ts).
 */
const DRIVEROUTPUT_GS_RE = /gs:\/\/[^\s"'<>)\]},;|`\\]*driveroutput[^\s"'<>)\]},;|`\\]*/g;

const BUTTON_CLASS = "gcp-wizard-log-btn";

/** Attribute set on elements we have already processed. */
const PROCESSED_ATTR = "data-gcp-wizard-dp";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildViewerUrl(gsPath: string): string {
  return chrome.runtime.getURL(`viewer.html?gs=${encodeURIComponent(gsPath)}`);
}

/**
 * Insert a "📄 View log" pill immediately after `anchor` unless we have
 * already done so (idempotent via PROCESSED_ATTR).
 */
function injectButton(anchor: Element, gsPath: string): void {
  if (anchor.hasAttribute(PROCESSED_ATTR)) return;

  // Validate before committing.
  try {
    parseGsPath(gsPath);
  } catch {
    return;
  }

  anchor.setAttribute(PROCESSED_ATTR, "1");

  const btn = document.createElement("a");
  btn.className = BUTTON_CLASS;
  btn.href = buildViewerUrl(gsPath);
  btn.target = "_blank";
  btn.rel = "noopener noreferrer";
  btn.title = `View log: ${gsPath}`;
  btn.textContent = "📄 View log";

  anchor.after(btn);
}

// ---------------------------------------------------------------------------
// Scanning strategies
// ---------------------------------------------------------------------------

/**
 * Strategy 1 — look for .gcp-wizard-gs-link anchors (produced by content.ts)
 * whose text content is a gs:// path containing "driveroutput".
 */
function scanGsLinks(root: ParentNode = document): void {
  const links = root.querySelectorAll<HTMLAnchorElement>("a.gcp-wizard-gs-link");
  for (const link of links) {
    const text = (link.textContent ?? "").trim();
    if (text.startsWith("gs://") && DRIVEROUTPUT_RE.test(text)) {
      injectButton(link, text);
    }
  }
}

/**
 * Strategy 2 — walk raw text nodes and extract a full gs://…driveroutput…
 * URI from the node value.  Covers pages where content.ts hasn't run yet
 * or where the path appears inside a non-linkified element (e.g. a GCS
 * browse table cell or a Dataproc job-details panel).
 */
function scanTextNodes(root: Node = document.body): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      const val = node.nodeValue ?? "";
      if (!val.includes("driveroutput")) return NodeFilter.FILTER_REJECT;
      const parent = (node as Text).parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (
        parent.hasAttribute(PROCESSED_ATTR) ||
        parent.classList.contains(BUTTON_CLASS) ||
        parent.classList.contains("gcp-wizard-gs-link") ||
        ["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "A"].includes(parent.tagName)
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const hits: Array<[Element, string]> = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    const textNode = node as Text;
    const parent = textNode.parentElement;
    if (!parent) continue;

    DRIVEROUTPUT_GS_RE.lastIndex = 0;
    const match = DRIVEROUTPUT_GS_RE.exec(textNode.nodeValue ?? "");
    if (match) hits.push([parent, match[0]]);
  }

  for (const [el, gsPath] of hits) {
    injectButton(el, gsPath);
  }
}

function runScan(): void {
  scanGsLinks();
  scanTextNodes();
}

// ---------------------------------------------------------------------------
// MutationObserver — handle dynamic content
// ---------------------------------------------------------------------------

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added.nodeType !== Node.ELEMENT_NODE) continue;
        const el = added as Element;

        // Fast path: a new gs-link was added directly.
        if (el.classList.contains("gcp-wizard-gs-link")) {
          const text = (el.textContent ?? "").trim();
          if (text.startsWith("gs://") && DRIVEROUTPUT_RE.test(text)) {
            injectButton(el, text);
            continue;
          }
        }

        scanGsLinks(el);
        scanTextNodes(el);
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): void {
  // Immediate pass (picks up anything content.ts has already linkified).
  runScan();

  // A deferred pass gives content.ts time to finish linkifying if it
  // started after us (the two scripts run at document_idle from separate
  // content_scripts entries so ordering is not guaranteed).
  setTimeout(runScan, 600);

  startObserver();
}

main();
