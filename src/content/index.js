// Entry point. Bundled by esbuild into a single IIFE (dist/<target>/content.js)
// — MV3 content scripts can't be "type":"module", and format:'iife' also
// keeps every name below out of the page's global scope, unlike the old
// flat content.js which declared ENV/SAFE_DURATION/etc. as page globals.
//
// This module owns only the machinery shared by every feature: the single
// MutationObserver, the debounced sync loop, the burst guard, and the 60s
// tick timer. Feature-specific policy and DOM mechanics live in their own
// modules (attendance.js, members.js) so this file doesn't grow without
// bound as features are added. See applying.js for why the reentrancy guard
// is ALSO shared rather than duplicated per feature.
//
// The tick loop only ever calls tickAttendance() — the members-directory
// feature has no per-second/per-minute repaint of its own (it only repaints
// on a user click or a storage change), so it has nothing for tick() to do.
/* global __DEV__, __VERSION__, __TARGET__ */

import { syncAttendance, tickAttendance, stopAttendance } from "./attendance.js";
import { syncMembers, stopMembers } from "./members.js";
import { registerObserver, isApplying, withApplying } from "./applying.js";
import {
  SYNC_DEBOUNCE_MS,
  TICK_INTERVAL_MS,
  SYNC_BURST_LIMIT,
  SYNC_BURST_WINDOW_MS,
} from "../lib/config.js";
import { log, warn } from "../lib/log.js";

let debounceTimer = null;
let tickTimer = null;
let observer = null;
let stopped = false;
const syncTimestamps = [];

/**
 * One sync pass, dispatched to every feature. Each feature owns its own
 * route gate and its own remove/rebuild-or-update-in-place lifecycle; this
 * function only sequences them under the shared reentrancy guard.
 *
 * Each dispatch gets its OWN try/catch: with a single feature that would be
 * moot (the caller in runSync() already wraps the whole call), but with two
 * features sharing this dispatcher, one throwing must not skip whichever
 * feature was queued after it in the same pass.
 */
function sync() {
  try {
    syncAttendance();
  } catch (e) {
    warn("attendance sync failed", e);
  }
  try {
    syncMembers();
  } catch (e) {
    warn("members sync failed", e);
  }
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
  if (isBursting()) {
    warn(`sync loop detected (>${SYNC_BURST_LIMIT} syncs in ${SYNC_BURST_WINDOW_MS}ms) — disconnecting`);
    stopped = true;
    observer?.disconnect();
    clearInterval(tickTimer);
    // If the extension has given up, every feature's own timers must stop
    // too — "quietly stop helping" means ALL of it stops, not just the
    // observer. Each feature owns its own teardown; this only calls it.
    stopAttendance();
    stopMembers();
    return;
  }
  withApplying(() => {
    try {
      sync();
    } catch (e) {
      // Never let a bug here escape into the portal page or nag the user —
      // the correct failure mode is "quietly stop helping this one time."
      warn("sync failed", e);
    }
  });
}

function schedule() {
  if (stopped) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSync, SYNC_DEBOUNCE_MS);
}

function tick() {
  if (stopped) return;
  try {
    tickAttendance();
  } catch (e) {
    warn("tick failed", e);
  }
}

function bootstrap() {
  try {
    observer = new MutationObserver(() => {
      if (!isApplying()) schedule();
    });
    registerObserver(observer);
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
