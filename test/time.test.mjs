import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseHm,
  formatHm,
  addMinutes,
  computeSecureEndTime,
  localDateKey,
  rowDateFromKey,
  elapsedSince,
  formatElapsed,
  formatCountdown,
  progressRatio,
  derivePanelState,
} from "../src/lib/time.js";

const SAFE_DURATION_MINUTES = 8 * 60 + 30;

test("parseHm rejects 00:00, empty, and non-HH:MM values", () => {
  assert.equal(parseHm("00:00"), null);
  assert.equal(parseHm(""), null);
  assert.equal(parseHm("-"), null);
  assert.equal(parseHm("not a time"), null);
  assert.deepEqual(parseHm("09:59"), { h: 9, m: 59 });
  assert.deepEqual(parseHm(" 20:59 "), { h: 20, m: 59 });
});

test("formatHm zero-pads", () => {
  assert.equal(formatHm({ h: 5, m: 9 }), "05:09");
  assert.equal(formatHm({ h: 18, m: 29 }), "18:29");
});

test("addMinutes wraps across midnight", () => {
  assert.deepEqual(addMinutes({ h: 20, m: 59 }, SAFE_DURATION_MINUTES), {
    h: 5,
    m: 29,
    crossesMidnight: true,
  });
  assert.deepEqual(addMinutes({ h: 9, m: 59 }, SAFE_DURATION_MINUTES), {
    h: 18,
    m: 29,
    crossesMidnight: false,
  });
});

test("computeSecureEndTime — the bug this rewrite exists to fix", () => {
  // Old code: hours %= 12 + hardcoded " PM" -> would have printed "08:59 PM"
  // for a 20:59 entry time. Correct 24h answer, crossing midnight:
  assert.equal(computeSecureEndTime("20:59", SAFE_DURATION_MINUTES), "05:29 (+1d)");
  assert.equal(computeSecureEndTime("09:59", SAFE_DURATION_MINUTES), "18:29");
  assert.equal(computeSecureEndTime("00:00", SAFE_DURATION_MINUTES), "—");
  assert.equal(computeSecureEndTime("", SAFE_DURATION_MINUTES), "—");
});

test("localDateKey formats local date components with zero-padding", () => {
  assert.equal(localDateKey(new Date(2026, 0, 5)), "2026-01-05"); // Jan 5 — single-digit month & day
  assert.equal(localDateKey(new Date(2026, 8, 14)), "2026-09-14");
});

test("rowDateFromKey extracts the date regardless of the user-id shape", () => {
  assert.equal(rowDateFromKey("3726-2026-09-14T00:00:00"), "2026-09-14");
  assert.equal(rowDateFromKey("-1-2026-09-14T00:00:00"), "2026-09-14"); // leading dash
  assert.equal(rowDateFromKey("garbage"), null);
});

test("elapsedSince clamps to zero and treats non-entries as null", () => {
  const now = new Date(2026, 8, 14, 12, 30, 0);
  assert.deepEqual(elapsedSince("09:59", now), { hours: 2, minutes: 31 });
  assert.deepEqual(elapsedSince("12:30", now), { hours: 0, minutes: 0 });
  // "future" start (clock skew) clamps rather than going negative
  assert.deepEqual(elapsedSince("23:00", now), { hours: 0, minutes: 0 });
  assert.equal(elapsedSince("00:00", now), null);
});

test("formatElapsed", () => {
  assert.equal(formatElapsed({ hours: 4, minutes: 12 }), "4h 12m in");
});

test("formatCountdown zero-pads all three fields", () => {
  assert.equal(formatCountdown(0), "00:00:00");
  assert.equal(formatCountdown(3_661_000), "01:01:01"); // 1h 1m 1s
  assert.equal(formatCountdown(-500), "00:00:00"); // never negative
});

test("progressRatio clamps to [0,1]", () => {
  assert.equal(progressRatio(0, 100), 0);
  assert.equal(progressRatio(50, 100), 0.5);
  assert.equal(progressRatio(150, 100), 1); // overtime doesn't overflow a bar
  assert.equal(progressRatio(-10, 100), 0);
  assert.equal(progressRatio(50, 0), 0); // no divide-by-zero
});

test("derivePanelState: loading when there's no row yet", () => {
  assert.deepEqual(
    derivePanelState({
      hasRow: false,
      rowDateKey: null,
      startText: "",
      endText: "",
      now: new Date(2026, 8, 14, 10, 0),
      durationMinutes: SAFE_DURATION_MINUTES,
    }),
    { kind: "loading" }
  );
});

test("derivePanelState: waiting when the row has no real start time", () => {
  for (const startText of ["00:00", "", "-"]) {
    const state = derivePanelState({
      hasRow: true,
      rowDateKey: "2026-09-14",
      startText,
      endText: "00:00",
      statusText: "Casual Leave",
      now: new Date(2026, 8, 14, 10, 0),
      durationMinutes: SAFE_DURATION_MINUTES,
    });
    assert.deepEqual(state, { kind: "waiting", statusText: "Casual Leave" });
  }
});

test("derivePanelState: running, mid-shift", () => {
  const state = derivePanelState({
    hasRow: true,
    rowDateKey: "2026-09-14",
    startText: "09:59",
    endText: "",
    statusText: "Normal",
    now: new Date(2026, 8, 14, 12, 30),
    durationMinutes: SAFE_DURATION_MINUTES,
  });
  assert.equal(state.kind, "running");
  assert.equal(state.start, "09:59");
  assert.equal(state.end, "18:29");
  assert.equal(state.inOffice, "02:31:00");
  assert.equal(state.remaining, "05:59:00");
  assert.ok(state.ratio > 0 && state.ratio < 1);
});

test("derivePanelState: overtime, past end time and still clocked in", () => {
  const state = derivePanelState({
    hasRow: true,
    rowDateKey: "2026-09-14",
    startText: "09:59",
    endText: "",
    now: new Date(2026, 8, 14, 19, 6),
    durationMinutes: SAFE_DURATION_MINUTES,
  });
  assert.equal(state.kind, "overtime");
  assert.equal(state.end, "18:29");
  assert.equal(state.over, "00:37:00");
});

test("derivePanelState: done once a real End Time is present — reports the ACTUAL checkout time, not the computed secure-end target, and quotes the portal's own total instead of recomputing one", () => {
  const state = derivePanelState({
    hasRow: true,
    rowDateKey: "2026-09-14",
    startText: "09:59",
    endText: "14:03",
    portalTotalText: "3h: 4m",
    now: new Date(2026, 8, 14, 20, 0),
    durationMinutes: SAFE_DURATION_MINUTES,
  });
  assert.deepEqual(state, {
    kind: "done",
    statusText: "",
    start: "09:59",
    end: "14:03", // the actual checkout time — NOT "18:29" (start + 8h30)
    portalTotal: "3h: 4m",
  });
});

test("derivePanelState: overnight shift (start yesterday) computes a positive remaining, not a wrapped-negative one", () => {
  // start 20:59 on the 14th -> secure end 05:29 on the 15th. Observed at
  // 01:00 on the 15th, 4h29m should remain — this is the case a
  // date-naive implementation gets backwards.
  const state = derivePanelState({
    hasRow: true,
    rowDateKey: "2026-09-14",
    startText: "20:59",
    endText: "",
    now: new Date(2026, 8, 15, 1, 0),
    durationMinutes: SAFE_DURATION_MINUTES,
  });
  assert.equal(state.kind, "running");
  assert.equal(state.end, "05:29");
  assert.equal(state.remaining, "04:29:00");
  assert.equal(state.inOffice, "04:01:00");
});

test("derivePanelState: clock skew (now before start) clamps elapsed to zero instead of adding a day", () => {
  // Same shape of inputs as the overnight case above (now < start-of-day
  // arithmetic could wrap either way) but here `now` is simply earlier the
  // same day as a stale/skewed reading — elapsed must clamp to zero, not
  // become "23h31m", and remaining must be the full shift, not negative.
  const state = derivePanelState({
    hasRow: true,
    rowDateKey: "2026-09-14",
    startText: "09:59",
    endText: "",
    now: new Date(2026, 8, 14, 9, 30),
    durationMinutes: SAFE_DURATION_MINUTES,
  });
  assert.equal(state.kind, "running");
  assert.equal(state.inOffice, "00:00:00");
  assert.equal(state.remaining, "08:59:00");
});
