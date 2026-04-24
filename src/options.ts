// Copyright 2026 Sergey Romanovskiy
// SPDX-License-Identifier: Apache-2.0

import { getSettings, setSettings } from "./lib/settings";

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

async function init(): Promise<void> {
  const form = $("optionsForm") as HTMLFormElement;
  const defaultProjectInput = $("defaultProject") as HTMLInputElement;
  const statusEl = $("status") as HTMLParagraphElement;

  const settings = await getSettings();
  defaultProjectInput.value = settings.defaultProject;

  form.addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const defaultProject = defaultProjectInput.value.trim();
    await setSettings({ defaultProject });
    statusEl.style.color = "var(--muted)";
    statusEl.textContent = "Saved.";
    setTimeout(() => {
      statusEl.textContent = "";
    }, 1500);
  });
}

void init();
