// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

/**
 * Content script: scans every page for bare gs://… URIs in text nodes and
 * wraps them in a clickable <a> that opens the path in the Cloud Console.
 *
 * Handles dynamic pages via MutationObserver so gs:// URIs that are injected
 * after the initial page load (e.g. in SPAs, log viewers, CI dashboards) are
 * also linkified.
 */

import { gsPathToConsoleUrl, GsPathError } from "./lib/gcsPath";
import { getSettings } from "./lib/settings";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Class applied to every <a> we inject so we can skip already-processed nodes. */
const LINK_CLASS = "gcp-wizard-gs-link";

/**
 * Matches a gs:// URI up to the first character that can't be part of a
 * well-formed GCS path in plain text:
 *   - whitespace
 *   - common surrounding punctuation: " ' < > ) ] } , ; | ` \
 *   - a trailing period / comma that is almost certainly sentence punctuation
 *
 * The regex is intentionally greedy so it captures the longest possible path,
 * then we trim trailing punctuation in the replacement step.
 */
const GS_PATTERN = /gs:\/\/[^\s"'<>)\]},;|`\\]+/g;

/** Tags whose text content must never be linkified. */
const SKIP_TAGS = new Set([
  "A", "SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "BUTTON",
  "NOSCRIPT", "SVG", "MATH",
]);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let defaultProject = "";

// ---------------------------------------------------------------------------
// Core linkification
// ---------------------------------------------------------------------------

/**
 * Given a Text node, replace any gs:// occurrences with a sequence of
 * Text + HTMLAnchorElement nodes and return the replacement nodes (or null if
 * there were no matches).
 */
function linkifyTextNode(text: Text): Node[] | null {
  const raw = text.nodeValue ?? "";
  GS_PATTERN.lastIndex = 0;

  const result: Node[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let found = false;

  while ((match = GS_PATTERN.exec(raw)) !== null) {
    // Trim trailing sentence-ending punctuation that is almost certainly not
    // part of the GCS path (e.g. "see gs://bucket/file." or "gs://bucket/f,").
    let gsUri = match[0];
    const trailingPunct = gsUri.match(/[.,!?:]+$/)?.[0] ?? "";
    if (trailingPunct) {
      gsUri = gsUri.slice(0, -trailingPunct.length);
      GS_PATTERN.lastIndex -= trailingPunct.length;
    }
    if (!gsUri) continue;

    // Build the console URL; skip on parse error.
    let href: string;
    try {
      href = gsPathToConsoleUrl(gsUri, { project: defaultProject });
    } catch (err) {
      if (err instanceof GsPathError) continue;
      throw err;
    }

    // Text before this match.
    if (match.index > lastIndex) {
      result.push(document.createTextNode(raw.slice(lastIndex, match.index)));
    }

    // The anchor.
    const a = document.createElement("a");
    a.className = LINK_CLASS;
    a.href = href;
    a.textContent = gsUri;
    a.title = "Open in Cloud Console";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    result.push(a);

    lastIndex = match.index + gsUri.length + trailingPunct.length;
    found = true;

    // Re-adjust lastIndex in case we consumed trailing punctuation.
    GS_PATTERN.lastIndex = lastIndex;
  }

  if (!found) return null;

  // Remainder of the string.
  if (lastIndex < raw.length) {
    result.push(document.createTextNode(raw.slice(lastIndex)));
  }

  return result;
}

/**
 * Walk all text nodes under `root` and linkify gs:// URIs.
 * Skips subtrees that are inside elements we must never touch.
 */
function processNode(root: Node): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node: Node): number {
      // Walk up to check if any ancestor is in the skip list or already a
      // GCP-Wizard-injected link.
      let el: Node | null = node.parentElement;
      while (el && el !== root) {
        if (el instanceof HTMLElement) {
          if (SKIP_TAGS.has(el.tagName)) return NodeFilter.FILTER_REJECT;
          if (el.classList.contains(LINK_CLASS)) return NodeFilter.FILTER_REJECT;
        }
        el = el.parentElement;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect before mutating — live iteration is unsafe.
  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    textNodes.push(node as Text);
  }

  for (const textNode of textNodes) {
    const replacements = linkifyTextNode(textNode);
    if (!replacements) continue;

    const parent = textNode.parentNode;
    if (!parent) continue;

    const fragment = document.createDocumentFragment();
    for (const r of replacements) fragment.appendChild(r);
    parent.replaceChild(fragment, textNode);
  }
}

// ---------------------------------------------------------------------------
// MutationObserver — handle dynamic content
// ---------------------------------------------------------------------------

function startObserver(): void {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          // A bare text node was added; wrap it in a temporary span to let
          // processNode walk it (TreeWalker needs an Element root).
          const span = document.createElement("span");
          node.parentNode?.insertBefore(span, node);
          span.appendChild(node);
          processNode(span);
          // Unwrap the span if it is now a transparent wrapper.
          if (span.parentNode) {
            while (span.firstChild) span.parentNode.insertBefore(span.firstChild, span);
            span.remove();
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          processNode(node);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const settings = await getSettings();
  defaultProject = settings.defaultProject;

  // Linkify what's already in the DOM.
  processNode(document.body);

  // Watch for future additions.
  startObserver();

  // If the user later changes the default project in Options, refresh.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && "defaultProject" in changes) {
      defaultProject = (changes["defaultProject"].newValue as string) ?? "";
    }
  });
}

void main();
