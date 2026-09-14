// @ts-check
// Pure time math for the "Secure End Time" column. No DOM in this file —
// that's what makes it the one thing in this extension worth unit testing.

/**
 * Parse an "HH:MM" string from the portal into numeric parts.
 * Treats "00:00", empty, "-" and anything not shaped like HH:MM as "no entry"
 * (the portal renders 00:00/00:00 for leave days and not-logged-in days).
 * @param {string} value
 * @returns {{h:number,m:number}|null}
 */
export function parseHm(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{1,2}:\d{2}$/.test(trimmed)) return null;
  if (trimmed === "00:00") return null;
  const [h, m] = trimmed.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

/** @param {number} n */
function pad2(n) {
  return String(n).padStart(2, "0");
}

/** @param {{h:number,m:number}} t */
export function formatHm(t) {
  return `${pad2(t.h)}:${pad2(t.m)}`;
}

/**
 * Add a duration (in minutes) to a 24h time, wrapping across midnight.
 * The portal renders 24-hour times, so this replaces the old `hours %= 12`
 * + hardcoded " PM" logic, which was wrong the moment a start time was in
 * the evening (20:59 -> would have printed "08:59 PM" instead of 05:29 +1d).
 * @param {{h:number,m:number}} start
 * @param {number} durationMinutes
 * @returns {{h:number,m:number,crossesMidnight:boolean}}
 */
export function addMinutes(start, durationMinutes) {
  const DAY = 24 * 60;
  const total = start.h * 60 + start.m + durationMinutes;
  const wrapped = ((total % DAY) + DAY) % DAY;
  return { h: Math.floor(wrapped / 60), m: wrapped % 60, crossesMidnight: total >= DAY };
}

/**
 * Compute the "Secure End Time" cell text for a raw Start Time cell value.
 * @param {string} startTimeText
 * @param {number} durationMinutes
 * @returns {string} e.g. "18:29", "05:29 (+1d)", or "—" for no entry
 */
export function computeSecureEndTime(startTimeText, durationMinutes) {
  const start = parseHm(startTimeText);
  if (!start) return "—";
  const end = addMinutes(start, durationMinutes);
  return end.crossesMidnight ? `${formatHm(end)} (+1d)` : formatHm(end);
}

/**
 * Format a Date as a local "YYYY-MM-DD" key. Deliberately NOT toISOString()
 * — that reads UTC, so before ~06:00 local in Dhaka (UTC+6) it would return
 * yesterday's date and silently move "today"'s row.
 * @param {Date} date
 */
export function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Extract a "YYYY-MM-DD" date from an AntD row key such as
 * "3726-2026-09-14T00:00:00". Matches the date pattern anywhere in the
 * string (rather than "everything after the first dash") so it survives a
 * different user-id shape.
 * @param {string} rowKey
 * @returns {string|null}
 */
export function rowDateFromKey(rowKey) {
  const match = /(\d{4}-\d{2}-\d{2})/.exec(rowKey || "");
  return match ? match[1] : null;
}

/**
 * Minutes elapsed between a start time and now, clamped to zero to absorb
 * clock skew or a future-looking start time.
 * @param {string} startTimeText
 * @param {Date} now
 * @returns {{hours:number,minutes:number}|null} null if start is not a real entry
 */
export function elapsedSince(startTimeText, now) {
  const start = parseHm(startTimeText);
  if (!start) return null;
  const target = new Date(now);
  target.setHours(start.h, start.m, 0, 0);
  const diffMs = Math.max(0, now.getTime() - target.getTime());
  const totalMinutes = Math.floor(diffMs / 60000);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
}

/** @param {{hours:number,minutes:number}} elapsed */
export function formatElapsed(elapsed) {
  return `${elapsed.hours}h ${elapsed.minutes}m in`;
}

/**
 * Build a local Date for a portal row's own date plus an "HH:MM" time. Used
 * instead of anchoring everything to `now`'s date, which is what makes an
 * overnight shift (started yesterday, still open after midnight) compute
 * correctly instead of being indistinguishable from ordinary clock skew —
 * see derivePanelState.
 * @param {string} dateKey "YYYY-MM-DD"
 * @param {{h:number,m:number}} hm
 * @returns {Date}
 */
function dateTimeAt(dateKey, hm) {
  const [y, mo, d] = dateKey.split("-").map(Number);
  return new Date(y, mo - 1, d, hm.h, hm.m, 0, 0);
}

/**
 * Format a non-negative millisecond duration as zero-padded "HH:MM:SS".
 * @param {number} ms
 */
export function formatCountdown(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
}

/**
 * Fraction of the work day elapsed, clamped to [0,1] so overtime can't push
 * a progress bar past full.
 * @param {number} elapsedMs
 * @param {number} totalMs
 */
export function progressRatio(elapsedMs, totalMs) {
  if (totalMs <= 0) return 0;
  return Math.min(1, Math.max(0, elapsedMs / totalMs));
}

/**
 * Pure state for the "Today" countdown panel. Never claims a figure that
 * contradicts the portal: running/overtime report presence ("in office"
 * time), not the portal's own counted total, and done echoes the portal's
 * own Total Work Hour text verbatim instead of recomputing a rival number.
 *
 * `rowDateKey` — the date the matched row itself belongs to, not `now`'s
 * date — is what lets this tell an overnight shift ("start 20:59 yesterday,
 * now 01:00" -> positive remaining) apart from ordinary clock skew ("start
 * 09:59 today, now 09:30 today" -> zero elapsed, not a day added). Passing
 * only `now`'s date for both would make one of those two cases wrong.
 *
 * @param {{
 *   hasRow: boolean,
 *   rowDateKey: string|null,
 *   startText: string,
 *   endText: string,
 *   portalTotalText?: string,
 *   statusText?: string,
 *   now: Date,
 *   durationMinutes: number,
 * }} args
 */
export function derivePanelState({
  hasRow,
  rowDateKey,
  startText,
  endText,
  portalTotalText,
  statusText,
  now,
  durationMinutes,
}) {
  const status = statusText || "";
  if (!hasRow || !rowDateKey) return { kind: "loading" };

  const start = parseHm(startText);
  if (!start) return { kind: "waiting", statusText: status };

  const end = addMinutes(start, durationMinutes);
  const endDate = dateTimeAt(rowDateKey, end);
  if (end.crossesMidnight) endDate.setDate(endDate.getDate() + 1);

  const startDate = dateTimeAt(rowDateKey, start);
  const elapsedMs = Math.max(0, now.getTime() - startDate.getTime());
  const inOffice = formatCountdown(elapsedMs);

  // A real (non-00:00) End Time means the portal already has the final
  // word — quote its own checkout time and total rather than showing the
  // *target* secure end time next to them (that's `end` above, used by
  // running/overtime — reusing it here would print "Out 18:29" beside a
  // portal card that says the actual checkout was 14:03).
  const actualEnd = parseHm(endText);
  if (actualEnd) {
    return {
      kind: "done",
      statusText: status,
      start: formatHm(start),
      end: formatHm(actualEnd),
      portalTotal: portalTotalText || "",
    };
  }

  const remainingMs = endDate.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return {
      kind: "overtime",
      statusText: status,
      start: formatHm(start),
      end: formatHm(end),
      inOffice,
      over: formatCountdown(-remainingMs),
    };
  }

  return {
    kind: "running",
    statusText: status,
    start: formatHm(start),
    end: formatHm(end),
    inOffice,
    remaining: formatCountdown(remainingMs),
    ratio: progressRatio(elapsedMs, durationMinutes * 60_000),
  };
}
