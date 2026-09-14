// chrome.storage.local access for the members-directory tracker. Chosen over
// the portal's own localStorage/IndexedDB (both live in the PAGE's origin,
// so the portal's own JS could read or clobber them, and both are wiped by
// "clear site data") — see the plan for the full comparison. This is the
// only file in the codebase that touches chrome.storage.local, mirroring how
// lib/time.js is the only file that touches Date math.
//
// Every exported function returns a Promise that RESOLVES even on failure
// (`{ok: false, error}` instead of a rejection). A content script with no
// background script is orphaned whenever the extension reloads or
// auto-updates with the page still open, and from that point every
// chrome.storage call rejects with "Extension context invalidated" — letting
// that propagate as an unhandled rejection would surface in the PORTAL's own
// console, which this project's "never throw into the portal page" posture
// (see CLAUDE.md) forbids just as much for this feature as for the sync loop.

import { STORAGE_KEY } from "./config.js";
import { emptyStore, migrate } from "./roster.js";
import { warn } from "./log.js";

/** Promise-style on both Chrome (MV3) and Firefox — no webextension-polyfill needed. */
function api() {
  return globalThis.browser ?? globalThis.chrome;
}

/**
 * @returns {Promise<{ok: true, store: ReturnType<typeof emptyStore>} | {ok: false, error: string}>}
 */
export async function loadStore() {
  try {
    const result = await api().storage.local.get(STORAGE_KEY);
    const raw = result?.[STORAGE_KEY];
    if (raw == null) return { ok: true, store: emptyStore() };
    const store = migrate(raw);
    if (store === null) {
      return { ok: false, error: "This history was written by a newer version of the extension." };
    }
    return { ok: true, store };
  } catch (e) {
    warn("loadStore failed", e);
    return { ok: false, error: "Couldn't read tracking history." };
  }
}

/**
 * @param {ReturnType<typeof emptyStore>} store
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function saveStore(store) {
  try {
    await api().storage.local.set({ [STORAGE_KEY]: store });
    return { ok: true };
  } catch (e) {
    warn("saveStore failed", e);
    return { ok: false, error: "Couldn't save — try again." };
  }
}

/** @returns {Promise<{ok: true} | {ok: false, error: string}>} */
export async function clearStore() {
  try {
    await api().storage.local.remove(STORAGE_KEY);
    return { ok: true };
  } catch (e) {
    warn("clearStore failed", e);
    return { ok: false, error: "Couldn't clear tracking history." };
  }
}

/**
 * Fires when ANY tab's write lands, including this one's own — the caller
 * repaints from the fresh value either way, which is simpler and cheaper
 * than trying to distinguish "my own write echoing back" from "another tab
 * changed something", and either way the on-screen state ends up correct.
 * @param {(store: ReturnType<typeof emptyStore>) => void} onChange
 * @returns {() => void} unsubscribe
 */
export function watchStore(onChange) {
  const listener = (changes, areaName) => {
    if (areaName !== "local" || !(STORAGE_KEY in changes)) return;
    const raw = changes[STORAGE_KEY].newValue;
    const store = raw == null ? emptyStore() : migrate(raw);
    if (store) onChange(store);
  };
  api().storage.onChanged.addListener(listener);
  return () => api().storage.onChanged.removeListener(listener);
}
