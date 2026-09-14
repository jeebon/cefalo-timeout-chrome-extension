// Shared constants. Kept as plain values (not chrome.storage) — this is a
// single-user utility and SAFE_DURATION is fixed by company policy, so a
// rebuild-to-change constant is the right amount of configurability.

export const COLUMN_TITLE = "Secure End Time";
export const SAFE_DURATION_MINUTES = 8 * 60 + 30; // 8h30m

// Every node we inject carries this attribute. It is what makes sync()
// idempotent (remove everything marked, then rebuild) instead of relying on
// a "does the column already exist" guard that never refreshes.
export const MARKER_ATTR = "data-cto";

// Only run on the Attendance page. Checked against location.pathname (not
// location.href), so query-string changes from sorting/filtering don't
// affect it.
export const ROUTE_RE = /^\/attendance\/?$/;

export const HEADER_TEXT = {
  date: "date",
  startTime: "start time",
  endTime: "end time",
};

export const SYNC_DEBOUNCE_MS = 200;
export const TICK_INTERVAL_MS = 60_000;

// Safety valve for a re-render loop that measurement did not find in
// practice, but that costs five lines to make structurally impossible.
export const SYNC_BURST_LIMIT = 20;
export const SYNC_BURST_WINDOW_MS = 10_000;
