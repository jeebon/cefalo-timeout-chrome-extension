// @ts-check
// Pure roster diffing for the members-directory tracker. No DOM, no storage
// — mirrors lib/time.js's role: this is the one thing in this feature worth
// unit testing, and everything else (directory.js, members.js) hands it
// already-scraped data and paints what it returns.

/**
 * Coerce any id (number from a scrape, or a `snaps[].added/removed` entry)
 * to the string key `people` is keyed by. One helper, used everywhere, so
 * `Array.includes`/`Set` membership and JSON round-trips never quietly
 * disagree about number-vs-string.
 * @param {number|string} id
 * @returns {string}
 */
export function personKey(id) {
  return String(id);
}

/** @returns {{v: number, startedAt: null, snaps: Array, people: Object}} */
export function emptyStore() {
  return { v: 1, startedAt: null, snaps: [], people: {} };
}

/**
 * @typedef {{userId: number, name: string, username: string, designation: string, teams: string[], photo: string}} ScrapedPerson
 */

/**
 * Compute the added/removed ids for one scrape against the current store,
 * WITHOUT mutating anything. `added` includes both brand-new people and
 * rejoiners (`present === false` in the stored record) — a rejoin is not
 * distinguishable from a join by this function, by design: both are things
 * that just started being true again, and both belong in `added`.
 * @param {ReturnType<typeof emptyStore>} store
 * @param {ScrapedPerson[]} scraped
 * @returns {{added: number[], removed: number[]}}
 */
export function diffRoster(store, scraped) {
  const scrapedIds = new Set(scraped.map((p) => p.userId));
  const added = [];
  for (const p of scraped) {
    const existing = store.people[personKey(p.userId)];
    if (!existing || existing.present === false) added.push(p.userId);
  }
  const removed = [];
  for (const [key, person] of Object.entries(store.people)) {
    if (person.present === true && !scrapedIds.has(Number(key))) removed.push(Number(key));
  }
  return { added, removed };
}

/**
 * Apply one snap: upsert every scraped person, flip `present` on anyone who
 * dropped out, and append the snap record. Returns a NEW store (the input is
 * not mutated), matching the rest of this codebase's preference for pure
 * transforms over in-place writes.
 *
 * `kind` is `"baseline"` for the very first snap (Track) and `"snap"` for
 * every one after. A baseline's `added` is forced to `[]` — it is a starting
 * point, not 257 simultaneous arrivals — even though `diffRoster` would
 * otherwise report every scraped person as added against an empty store.
 *
 * @param {ReturnType<typeof emptyStore>} store
 * @param {ScrapedPerson[]} scraped
 * @param {string} at ISO timestamp
 * @param {"baseline"|"snap"} kind
 */
export function applySnap(store, scraped, at, kind) {
  const { added: rawAdded, removed } = diffRoster(store, scraped);
  const added = kind === "baseline" ? [] : rawAdded;

  const people = { ...store.people };
  const removedSet = new Set(removed);

  for (const p of scraped) {
    const key = personKey(p.userId);
    const existing = people[key];
    people[key] = {
      name: p.name,
      username: p.username,
      designation: p.designation,
      teams: p.teams,
      photo: p.photo,
      firstSeen: existing?.firstSeen ?? at,
      lastSeen: at,
      present: true,
    };
  }
  for (const id of removedSet) {
    const key = personKey(id);
    if (people[key]) people[key] = { ...people[key], present: false };
  }

  const snaps = [...store.snaps, { at, kind, total: scraped.length, added, removed }];

  return {
    ...store,
    startedAt: store.startedAt ?? at,
    snaps,
    people,
  };
}

/**
 * Look up stored profiles for a list of ids (from a snap's `added`/`removed`),
 * skipping any id the store has no record for rather than throwing. Ids may
 * be numbers (as stored in `snaps[]`) or strings — personKey() normalizes.
 * @param {ReturnType<typeof emptyStore>} store
 * @param {(number|string)[]} ids
 */
export function peopleFor(store, ids) {
  return ids
    .map((id) => store.people[personKey(id)])
    .filter(Boolean);
}

/**
 * Everyone currently marked `present: false`, for the Former Members strip.
 * @param {ReturnType<typeof emptyStore>} store
 */
export function formerMembers(store) {
  return Object.values(store.people).filter((p) => p.present === false);
}

/**
 * Find the snap whose `removed` list contains this id — "when did X leave".
 * Searches newest-first so a person who left, rejoined, and left again
 * reports their MOST RECENT departure rather than their first.
 * @param {ReturnType<typeof emptyStore>} store
 * @param {number|string} id
 */
export function lastDepartureSnap(store, id) {
  const target = Number(id);
  for (let i = store.snaps.length - 1; i >= 0; i--) {
    if (store.snaps[i].removed.includes(target)) return store.snaps[i];
  }
  return null;
}

/**
 * Format a stored ISO-UTC timestamp for display, in the VIEWER's local time
 * — never the raw UTC digits. Printing "18:20:00.000Z" as "18:20" would show
 * a snap taken at 00:20 on the 15th in Dhaka (UTC+6) as 18:20 on the 14th:
 * wrong date AND time. This is the same class of bug localDateKey() in
 * time.js exists to avoid, applied to a timestamp instead of a date key.
 * `Intl.DateTimeFormat` with no `timeZone` option defaults to the runtime's
 * local zone, which is what makes this correct without hand-rolled math.
 * @param {string} iso
 */
export function formatSnapTime(iso) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Validate/upgrade a raw value loaded from storage. Identity for the current
 * version; refuses (returns null) anything it doesn't recognize rather than
 * silently reinterpreting a shape it wasn't written for. A future v2 gets a
 * real migration step added here, in front of this check.
 * @param {any} raw
 * @returns {ReturnType<typeof emptyStore>|null}
 */
export function migrate(raw) {
  if (raw == null) return emptyStore();
  if (raw.v === 1) return raw;
  return null;
}

/**
 * Reconstruct "who was present" after each snap, purely from what's already
 * stored — no snap carries a full roster (only `added`/`removed` deltas), so
 * this replays them. The one gap is the baseline: its `added` is forced to
 * `[]` by design (see applySnap), so the baseline roster is recovered the
 * other way stored data makes it recoverable — anyone whose `firstSeen`
 * equals the baseline's own timestamp was in it, and firstSeen is NEVER
 * rewritten after that first observation, so this stays correct forever
 * regardless of how many times that person has left and rejoined since.
 * @param {ReturnType<typeof emptyStore>} store
 * @returns {Set<number>[]} present-id-set after store.snaps[i], one per snap
 */
function computeTimeline(store) {
  const timeline = [];
  const present = new Set();
  const baselineAt = store.snaps[0]?.at;
  if (baselineAt) {
    for (const [key, p] of Object.entries(store.people)) {
      if (p.firstSeen === baselineAt) present.add(Number(key));
    }
  }
  for (let i = 0; i < store.snaps.length; i++) {
    if (i > 0) {
      for (const id of store.snaps[i].added) present.add(id);
      for (const id of store.snaps[i].removed) present.delete(id);
    }
    timeline.push(new Set(present));
  }
  return timeline;
}

/**
 * Recompute every person's `present`/`firstSeen`/`lastSeen` from a (possibly
 * shortened) snap list, replaying it the same way applySnap's diffRoster
 * calls would have. Only those three fields change — name/username/
 * designation/teams/photo are "latest known value" fields, not tied to which
 * snap surfaced them, so they carry over untouched even for a person whose
 * only appearance was in the deleted snap.
 * @param {ReturnType<typeof emptyStore>} store the ORIGINAL store (for baseline membership + existing profiles)
 * @param {Array} newSnaps the snap list after deletion/merge
 */
function rebuildPeople(store, newSnaps) {
  const present = new Set();
  const firstSeen = {};
  const lastSeen = {};

  const baselineAt = store.snaps[0]?.at;
  if (baselineAt) {
    for (const [key, p] of Object.entries(store.people)) {
      if (p.firstSeen === baselineAt) present.add(Number(key));
    }
  }
  for (const id of present) {
    firstSeen[id] = baselineAt;
    lastSeen[id] = baselineAt;
  }

  for (let i = 1; i < newSnaps.length; i++) {
    const snap = newSnaps[i];
    for (const id of snap.added) present.add(id);
    for (const id of snap.removed) present.delete(id);
    for (const id of present) {
      if (!(id in firstSeen)) firstSeen[id] = snap.at;
      lastSeen[id] = snap.at;
    }
  }

  const people = {};
  for (const [key, p] of Object.entries(store.people)) {
    const id = Number(key);
    if (!(id in firstSeen)) {
      people[key] = p; // never present in the reconstructed timeline — keep the record rather than drop history
      continue;
    }
    people[key] = { ...p, firstSeen: firstSeen[id], lastSeen: lastSeen[id], present: present.has(id) };
  }
  return people;
}

/**
 * Delete one snapshot that is NOT the baseline (index 0) — the baseline is
 * only removable by Untrack (which deletes the whole history), since there
 * is no earlier state to fall back to. Deleting snap[index] merges its
 * transition into whichever snap comes right after it, so that survivor's
 * `added`/`removed` read as "vs two snaps back" instead of referencing a
 * state that no longer exists in the record — everyone's final `present`
 * status is unchanged by this (see computeTimeline's replay), only the
 * recorded SHAPE of how they got there changes for the merged pair.
 * A no-op (returns `store` as-is) for the baseline or an out-of-range index.
 * @param {ReturnType<typeof emptyStore>} store
 * @param {number} index
 */
export function deleteSnap(store, index) {
  const n = store.snaps.length;
  if (!Number.isInteger(index) || index <= 0 || index >= n) return store;

  const timeline = computeTimeline(store);
  const beforeState = timeline[index - 1];

  const newSnaps = store.snaps
    .filter((_, i) => i !== index)
    .map((snap, newPos) => {
      const oldPos = newPos >= index ? newPos + 1 : newPos;
      if (oldPos !== index + 1) return snap; // only the snap right after the gap needs re-deriving
      const afterState = timeline[oldPos];
      return {
        ...snap,
        added: [...afterState].filter((id) => !beforeState.has(id)),
        removed: [...beforeState].filter((id) => !afterState.has(id)),
      };
    });

  return { ...store, snaps: newSnaps, people: rebuildPeople(store, newSnaps) };
}
