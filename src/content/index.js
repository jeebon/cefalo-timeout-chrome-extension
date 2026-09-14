// Entry point. Bundled by esbuild into a single IIFE (dist/<target>/content.js)
// — MV3 content scripts can't be "type":"module", and format:'iife' also
// keeps every name below out of the page's global scope, unlike the old
// flat content.js which declared ENV/SAFE_DURATION/etc. as page globals.
/* global __DEV__, __VERSION__, __TARGET__ */

import { findTable, getHeaderTexts, computeIndices, removeInjected, injectColumn } from "./table.js";
import {
  computeSecureEndTime,
  elapsedSince,
  formatElapsed,
  rowDateFromKey,
  localDateKey,
} from "../lib/time.js";
import {
  ROUTE_RE,
  SAFE_DURATION_MINUTES,
  MARKER_ATTR,
  SYNC_DEBOUNCE_MS,
  TICK_INTERVAL_MS,
  SYNC_BURST_LIMIT,
  SYNC_BURST_WINDOW_MS,
} from "../lib/config.js";
import { log, warn } from "../lib/log.js";

let applying = false;
let debounceTimer = null;
let tickTimer = null;
let observer = null;
let stopped = false;
let syncCount = 0;
const syncTimestamps = [];

/**
 * Build the per-row cell-text function for one sync pass. Closes over the
 * column indices so table.js never needs to know about start/end times.
 * @param {number} srcIdx
 * @param {number} endIdx
 */
function makeCellTextFn(srcIdx, endIdx) {
  const today = localDateKey(new Date());
  return function cellTextFor(row) {
    const startTimeText = row.children[srcIdx]?.textContent.trim() ?? "";
    const secureEnd = computeSecureEndTime(startTimeText, SAFE_DURATION_MINUTES);
    if (secureEnd === "—") return secureEnd;

    const rowKey = row.getAttribute("data-row-key") || "";
    if (rowDateFromKey(rowKey) !== today) return secureEnd;

    // Only show elapsed time for today while still clocked in. Once End
    // Time is populated the portal's own Total Work Hour is authoritative.
    const endTimeText = row.children[endIdx]?.textContent.trim() ?? "";
    const stillClockedIn = endTimeText === "" || endTimeText === "00:00";
    if (!stillClockedIn) return secureEnd;

    const elapsed = elapsedSince(startTimeText, new Date());
    return elapsed ? `${secureEnd} · ${formatElapsed(elapsed)}` : secureEnd;
  };
}

/**
 * Remove-then-rebuild, never a "does the column already exist" guard. A
 * guard prevents duplicates but never refreshes, and measurement against
 * the live portal showed why that matters: a data refetch (e.g. toggling
 * the Weekends filter) changes the row set in place — new rows arrive
 * without our cell while old rows keep theirs, producing a ragged table
 * that a guard-based early-return would leave permanently broken.
 */
function sync() {
  removeInjected();
  if (!ROUTE_RE.test(location.pathname)) return;

  const wrapper = findTable();
  if (!wrapper) return;

  const indices = computeIndices(getHeaderTexts(wrapper));
  if (!indices) return;

  injectColumn(wrapper, indices.insertAt, makeCellTextFn(indices.srcIdx, indices.endIdx));

  syncCount += 1;
  wrapper.setAttribute("data-cto-syncs", String(syncCount));
  wrapper.querySelector(`th[${MARKER_ATTR}]`)?.setAttribute("data-cto-v", __VERSION__);

  log("synced", { syncCount, target: __TARGET__ });
}

/** Rolling-window burst guard: true if syncs are happening too fast to be user-driven. */
function isBursting() {
  const now = Date.now();
  syncTimestamps.push(now);
  while (syncTimestamps.length && now - syncTimestamps[0] > SYNC_BURST_WINDOW_MS) {
    syncTimestamps.shift();
  }
  return syncTimestamps.length > SYNC_BURST_LIMIT;
}

function runSync() {
  if (stopped) return;
  applying = true;
  try {
    if (isBursting()) {
      warn(`sync loop detected (>${SYNC_BURST_LIMIT} syncs in ${SYNC_BURST_WINDOW_MS}ms) — disconnecting`);
      stopped = true;
      observer?.disconnect();
      clearInterval(tickTimer);
      return;
    }
    sync();
  } catch (e) {
    // Never let a bug here escape into the portal page or nag the user —
    // the correct failure mode is "quietly stop helping this one time."
    warn("sync failed", e);
  } finally {
    // Our own writes above just queued mutation records against the
    // observer we're about to re-arm below. Drain them now: the "notify
    // mutation observers" microtask only invokes the callback if the queue
    // is non-empty, so an empty queue means our own edits can't re-trigger
    // schedule() a moment later. The `applying` flag alone isn't enough —
    // it's already false again by the time that microtask would run.
    observer?.takeRecords();
    applying = false;
  }
}

function schedule() {
  if (stopped) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSync, SYNC_DEBOUNCE_MS);
}

/**
 * Lightweight per-minute refresh of just today's elapsed-time text. This is
 * a plain textContent write, not a structural rebuild — no colgroup/measure
 * row churn, so it can't feed the observer loop the way a full sync() would
 * if run every 60s regardless of whether anything changed.
 *
 * This also bounds a real (if narrow) staleness gap: if AntD ever re-renders
 * a row's cell text in place without a childList mutation, our injected
 * value would go stale with no observer callback to catch it. This tick is
 * what caps that at 60 seconds — not just a nicety for the "Xh Ym in" label.
 */
function tick() {
  if (stopped) return;
  try {
    if (!ROUTE_RE.test(location.pathname)) return;
    const wrapper = findTable();
    if (!wrapper) return;

    const indices = computeIndices(getHeaderTexts(wrapper));
    if (!indices) return;
    const cellTextFor = makeCellTextFn(indices.srcIdx, indices.endIdx);

    const today = localDateKey(new Date());
    const rows = wrapper.querySelectorAll(".ant-table-tbody > tr[data-row-key]:not(.ant-table-measure-row)");
    for (const row of rows) {
      if (rowDateFromKey(row.getAttribute("data-row-key") || "") !== today) continue;
      const cell = row.querySelector(`td[${MARKER_ATTR}]`);
      if (cell) cell.textContent = cellTextFor(row);
      break; // exactly one row is "today"
    }
  } catch (e) {
    warn("tick failed", e);
  }
}

function bootstrap() {
  try {
    observer = new MutationObserver(() => {
      if (!applying) schedule();
    });
    runSync(); // initial pass — the table is populated by an authenticated
               // XHR after this script runs, so this first call is expected
               // to be a no-op; the observer is what actually catches it.
    observer.observe(document.body, { childList: true, subtree: true });
    // popstate only covers back/forward (it never fires on pushState, which
    // is how the SPA navigates forward) — schedule(), not sync() directly,
    // since the new view hasn't rendered yet when popstate fires.
    window.addEventListener("popstate", schedule);
    tickTimer = setInterval(tick, TICK_INTERVAL_MS);
    log("bootstrapped", { version: __VERSION__, target: __TARGET__ });
  } catch (e) {
    // An exception here (before observer.observe()) would otherwise kill the
    // extension permanently with no recovery path.
    warn("bootstrap failed", e);
  }
}

bootstrap();
