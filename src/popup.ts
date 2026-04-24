// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

import { gsPathToConsoleUrl, GsPathError } from "./lib/gcsPath";
import { getSettings } from "./lib/settings";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

async function init(): Promise<void> {
  const form = $("gsForm") as HTMLFormElement;
  const pathInput = $("gsPath") as HTMLInputElement;
  const projectInput = $("project") as HTMLInputElement;
  const statusEl = $("status") as HTMLParagraphElement;
  const optionsBtn = $("openOptions") as HTMLButtonElement;

  const settings = await getSettings();
  if (settings.defaultProject) {
    projectInput.placeholder = `${settings.defaultProject} (default)`;
  }

  // If the user had anything on the clipboard that looks like a gs:// path,
  // do NOT auto-read it (requires extra permissions); just focus the input.
  pathInput.focus();

  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    statusEl.textContent = "";

    const rawPath = pathInput.value.trim();
    const explicitProject = projectInput.value.trim();
    const project = explicitProject || settings.defaultProject;

    try {
      const url = gsPathToConsoleUrl(rawPath, { project });
      await chrome.tabs.create({ url });
      window.close();
    } catch (err) {
      const message = err instanceof GsPathError ? err.message : "Failed to open path.";
      statusEl.textContent = message;
    }
  });

  optionsBtn.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });
}

void init();
