// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

/**
 * Utilities for translating gs:// URIs into Google Cloud Console URLs.
 */

export const CONSOLE_ORIGIN = "https://console.cloud.google.com";

export interface ParsedGsPath {
  /** The bucket name (first path segment after `gs://`). */
  bucket: string;
  /** The object path inside the bucket (may be empty for bucket-root links). Never has leading/trailing slash. */
  objectPath: string;
  /**
   * Whether the parsed path should be treated as a "folder" (prefix) in GCS.
   * We treat it as a folder when the input ended with a trailing slash or when
   * there is no object path at all (i.e. the bucket root).
   */
  isFolder: boolean;
}

export class GsPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GsPathError";
  }
}

/**
 * Parse a `gs://bucket[/object/path]` URI.
 *
 * Bucket naming rules are loose here on purpose — we only enforce what the
 * Cloud Console URL structure requires: a non-empty bucket segment.
 */
export function parseGsPath(input: string): ParsedGsPath {
  if (typeof input !== "string") {
    throw new GsPathError("Path must be a string.");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    throw new GsPathError("Path is empty.");
  }

  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("gs://")) {
    throw new GsPathError("Path must start with 'gs://'.");
  }

  // Preserve the original casing of the remainder — bucket names are
  // lowercase in practice, but object names are case-sensitive.
  const remainder = trimmed.slice("gs://".length);
  if (!remainder) {
    throw new GsPathError("Missing bucket name after 'gs://'.");
  }

  const slashIdx = remainder.indexOf("/");
  let bucket: string;
  let objectPath: string;
  let isFolder: boolean;

  if (slashIdx === -1) {
    bucket = remainder;
    objectPath = "";
    isFolder = true;
  } else {
    bucket = remainder.slice(0, slashIdx);
    const rest = remainder.slice(slashIdx + 1);
    isFolder = rest === "" || rest.endsWith("/");
    // Normalize: drop any leading/trailing slashes, collapse doubles.
    objectPath = rest.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/{2,}/g, "/");
  }

  if (!bucket) {
    throw new GsPathError("Missing bucket name after 'gs://'.");
  }
  // Bucket names don't contain slashes, spaces, or uppercase. We only flag
  // whitespace here because it's almost certainly a paste error.
  if (/\s/.test(bucket)) {
    throw new GsPathError(`Invalid bucket name: '${bucket}'.`);
  }

  return { bucket, objectPath, isFolder };
}

export interface BuildUrlOptions {
  /** Optional GCP project ID to include in the query string. */
  project?: string;
}

/**
 * Build the Cloud Console URL corresponding to a parsed gs:// path.
 *
 * - A folder/prefix (or a bare bucket) maps to the Storage browser view:
 *     https://console.cloud.google.com/storage/browser/<bucket>[/<prefix>]
 * - An object maps to the object details view:
 *     https://console.cloud.google.com/storage/browser/_details/<bucket>/<object>
 */
export function buildConsoleUrl(parsed: ParsedGsPath, options: BuildUrlOptions = {}): string {
  const { bucket, objectPath, isFolder } = parsed;

  // Each path segment must be percent-encoded individually so forward slashes
  // remain structural separators in the Console URL.
  const encodedBucket = encodeURIComponent(bucket);
  const encodedObject = objectPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join("/");

  let pathname: string;
  if (!objectPath || isFolder) {
    pathname = encodedObject
      ? `/storage/browser/${encodedBucket}/${encodedObject}`
      : `/storage/browser/${encodedBucket}`;
  } else {
    pathname = `/storage/browser/_details/${encodedBucket}/${encodedObject}`;
  }

  const url = new URL(pathname, CONSOLE_ORIGIN);
  const project = options.project?.trim();
  if (project) {
    url.searchParams.set("project", project);
  }
  return url.toString();
}

/** Convenience: parse + build in one call. */
export function gsPathToConsoleUrl(input: string, options: BuildUrlOptions = {}): string {
  return buildConsoleUrl(parseGsPath(input), options);
}
