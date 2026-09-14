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
