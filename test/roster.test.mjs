import { test } from "node:test";
import assert from "node:assert/strict";
import {
  emptyStore,
  diffRoster,
  applySnap,
  deleteSnap,
  peopleFor,
  formerMembers,
  lastDepartureSnap,
  personKey,
  formatSnapTime,
  migrate,
} from "../src/lib/roster.js";

function person(userId, overrides = {}) {
  return {
    userId,
    name: `Person ${userId}`,
    username: `@p${userId}`,
    designation: "Software Engineer",
    teams: ["Snapper"],
    photo: `https://hrportal.cefalolab.com/api/avatars/${userId}.jpg`,
    ...overrides,
  };
}

const T0 = "2026-09-14T12:00:00.000Z";
const T1 = "2026-10-01T09:00:00.000Z";
const T2 = "2026-10-15T09:00:00.000Z";

test("baseline snap records everyone, sets firstSeen, and yields added:[] with kind:'baseline'", () => {
  const store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  assert.equal(store.snaps.length, 1);
  assert.equal(store.snaps[0].kind, "baseline");
  assert.deepEqual(store.snaps[0].added, []);
  assert.deepEqual(store.snaps[0].removed, []);
  assert.equal(store.snaps[0].total, 2);
  assert.equal(store.people["1"].firstSeen, T0);
  assert.equal(store.people["2"].firstSeen, T0);
  assert.equal(store.people["1"].present, true);
});

test("a joiner lands in added and gets firstSeen", () => {
  let store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  store = applySnap(store, [person(1), person(2)], T1, "snap");
  assert.deepEqual(store.snaps[1].added, [2]);
  assert.deepEqual(store.snaps[1].removed, []);
  assert.equal(store.people["2"].firstSeen, T1);
});

test("a leaver lands in removed, gets present:false, and their profile is retained for display", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap");
  assert.deepEqual(store.snaps[1].removed, [2]);
  assert.equal(store.people["2"].present, false);
  assert.equal(store.people["2"].name, "Person 2"); // retained, not deleted
});

test("a rejoin lands in added again, sets present:true, and preserves the original firstSeen", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap"); // 2 leaves
  store = applySnap(store, [person(1), person(2)], T2, "snap"); // 2 rejoins
  assert.deepEqual(store.snaps[2].added, [2]);
  assert.equal(store.people["2"].present, true);
  assert.equal(store.people["2"].firstSeen, T0); // NOT T2 — first observed, not this join
});

test("a no-change snap appends an entry with two empty arrays", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1), person(2)], T1, "snap");
  assert.equal(store.snaps.length, 2);
  assert.deepEqual(store.snaps[1].added, []);
  assert.deepEqual(store.snaps[1].removed, []);
});

test("an updated profile overwrites in place — Object.keys(people).length does not grow", () => {
  let store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  store = applySnap(store, [person(1, { designation: "Senior Software Engineer" })], T1, "snap");
  assert.equal(Object.keys(store.people).length, 1);
  assert.equal(store.people["1"].designation, "Senior Software Engineer");
});

test("a member with empty teams round-trips (the real 3-<p> card)", () => {
  const store = applySnap(emptyStore(), [person(1, { teams: [] })], T0, "baseline");
  assert.deepEqual(store.people["1"].teams, []);
});

test("personKey coercion: number ids in snaps resolve against string keys in people", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap");
  const removedId = store.snaps[1].removed[0]; // a Number, as stored
  assert.equal(typeof removedId, "number");
  assert.equal(personKey(removedId), "2");
  assert.ok(store.people[personKey(removedId)]);
});

test("formatSnapTime renders a UTC timestamp in the correct LOCAL date and time across a midnight boundary", () => {
  // A fixed offset far enough from UTC that a naive toISOString()-style
  // render would show the wrong date, not just the wrong time. We can't
  // pin the test's own timezone, so assert against what the SAME
  // Intl.DateTimeFormat call (the thing under test) is built on: a
  // Date constructed from the ISO string, formatted with no timeZone
  // override, must NOT equal the raw UTC digits when local != UTC, and
  // must always equal the browser/node's own local rendering.
  const iso = "2026-09-14T18:20:00.000Z";
  const expected = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
  assert.equal(formatSnapTime(iso), expected);
});

test("migrate() is identity for v:1 and refuses an unknown version", () => {
  const store = emptyStore();
  assert.deepEqual(migrate(store), store);
  assert.equal(migrate(null).v, 1); // no prior data -> a fresh empty store
  assert.equal(migrate({ v: 2, snaps: [], people: {} }), null);
});

test("snap ordering: appended oldest-first", () => {
  let store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap");
  store = applySnap(store, [person(1)], T2, "snap");
  assert.deepEqual(
    store.snaps.map((s) => s.at),
    [T0, T1, T2]
  );
});

test("'when did X leave' derives from snaps[].removed, not from a field on the person", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap"); // 2 leaves at T1
  const snap = lastDepartureSnap(store, 2);
  assert.equal(snap.at, T1);
  // no goneAt-style field anywhere on the stored person
  assert.equal("goneAt" in store.people["2"], false);
});

test("lastDepartureSnap reports the MOST RECENT departure after a leave-rejoin-leave cycle", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap"); // 2 leaves
  store = applySnap(store, [person(1), person(2)], T2, "snap"); // 2 rejoins
  store = applySnap(store, [person(1)], "2026-11-01T00:00:00.000Z", "snap"); // 2 leaves again
  const snap = lastDepartureSnap(store, 2);
  assert.equal(snap.at, "2026-11-01T00:00:00.000Z"); // not T1
});

test("a stored person carries no email, phone or joinedAt key — regression guard for the rejected fiber path", () => {
  const store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  const stored = store.people["1"];
  assert.equal("email" in stored, false);
  assert.equal("phone" in stored, false);
  assert.equal("joinedAt" in stored, false);
});

test("peopleFor skips ids the store has no record for, rather than throwing", () => {
  const store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  const found = peopleFor(store, [1, 999]);
  assert.equal(found.length, 1);
  assert.equal(found[0].name, "Person 1");
});

test("formerMembers returns only present:false people", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap");
  const former = formerMembers(store);
  assert.equal(former.length, 1);
  assert.equal(former[0].name, "Person 2");
});

test("diffRoster does not mutate the input store", () => {
  const store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  const before = JSON.stringify(store);
  diffRoster(store, [person(1), person(2)]);
  assert.equal(JSON.stringify(store), before);
});

test("deleteSnap is a no-op on the baseline (index 0) or an out-of-range index", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap");
  assert.deepEqual(deleteSnap(store, 0), store);
  assert.deepEqual(deleteSnap(store, 5), store);
  assert.deepEqual(deleteSnap(store, -1), store);
});

test("deleteSnap drops the last snap outright, restoring the prior present state", () => {
  let store = applySnap(emptyStore(), [person(1), person(2)], T0, "baseline");
  store = applySnap(store, [person(1)], T1, "snap"); // 2 leaves
  const after = deleteSnap(store, 1);
  assert.equal(after.snaps.length, 1);
  assert.equal(after.people["2"].present, true); // the removal never happened
});

test("deleteSnap on a middle snap merges its effect forward — a mid-history joiner's firstSeen shifts to the surviving snap", () => {
  let store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  store = applySnap(store, [person(1), person(2)], T1, "snap"); // 2 joins at T1 (to be deleted)
  store = applySnap(store, [person(1), person(2), person(3)], T2, "snap"); // 3 joins at T2
  const after = deleteSnap(store, 1); // delete T1
  assert.equal(after.snaps.length, 2);
  assert.equal(after.snaps[0].at, T0);
  assert.equal(after.snaps[1].at, T2);
  // 2's join is now attributed to the surviving T2 snap, alongside 3's
  assert.deepEqual(after.snaps[1].added.sort(), [2, 3]);
  assert.equal(after.people["2"].firstSeen, T2);
  // final present state is unaffected by which snap recorded the join
  assert.equal(after.people["1"].present, true);
  assert.equal(after.people["2"].present, true);
  assert.equal(after.people["3"].present, true);
});

test("deleteSnap on a join-then-leave pair (deleting the join) drops both from the surviving snap's diff — never present, never recorded as removed", () => {
  let store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  store = applySnap(store, [person(1), person(2)], T1, "snap"); // 2 joins (to be deleted)
  store = applySnap(store, [person(1)], T2, "snap"); // 2 leaves again
  const after = deleteSnap(store, 1); // delete the join
  assert.equal(after.snaps.length, 2);
  // 2 was never present between T0 and T2 in the reconstructed history, so
  // the surviving snap has nothing to say about them either way
  assert.equal(after.snaps[1].added.includes(2), false);
  assert.equal(after.snaps[1].removed.includes(2), false);
  assert.equal(after.people["2"].present, false);
});

test("deleteSnap preserves profile fields (name/designation/etc.) untouched", () => {
  let store = applySnap(emptyStore(), [person(1)], T0, "baseline");
  store = applySnap(store, [person(1), person(2, { designation: "Designer" })], T1, "snap");
  store = applySnap(store, [person(1), person(2, { designation: "Designer" })], T2, "snap"); // no-op snap, to delete
  const after = deleteSnap(store, 2);
  assert.equal(after.people["2"].designation, "Designer");
  assert.equal(after.people["2"].name, "Person 2");
});
