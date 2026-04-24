// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

/**
 * Thin wrapper around chrome.storage.sync for extension settings.
 */

export interface Settings {
  /** Default GCP project ID to apply when the user doesn't specify one. */
  defaultProject: string;
}

const DEFAULTS: Settings = {
  defaultProject: "",
};

export async function getSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get(DEFAULTS);
  return { ...DEFAULTS, ...(stored as Partial<Settings>) };
}

export async function setSettings(patch: Partial<Settings>): Promise<void> {
  await chrome.storage.sync.set(patch);
}
