// The observer-reentrancy guard, extracted from index.js so that BOTH
// features (the attendance column/panel and, later, the members-directory
// bar) share ONE depth counter. Two counters would let an inner call clear
// the flag out from under an outer one — the exact bug the depth counter
// exists to prevent.
//
// The coupling here is circular by nature and the seam is deliberate:
//   - withApplying()'s finally needs the observer, to drain our own writes.
//   - the observer's callback needs the flag, and needs schedule() (which
//     stays in index.js).
// So index.js CONSTRUCTS the observer and hands it here via
// registerObserver(), and its callback asks isApplying() — a function call,
// never a bare imported binding read into a local. Reading `applying` into a
// local would capture the value at import time and fail SILENTLY: the guard
// would always read false, every one of our own writes would schedule
// another sync, and the takeRecords invariant below would die in the one way
// that leaves no trace.

let applying = false;
let applyingDepth = 0;
let observer = null;

/** @param {MutationObserver} obs */
export function registerObserver(obs) {
  observer = obs;
}

/**
 * Whether a guarded write is in progress. MUST be called as a function from
 * the observer callback — see the module docblock for why an imported
 * `applying` binding is not a substitute.
 */
export function isApplying() {
  return applying;
}

/**
 * Run `fn` with the observer-reentrancy guard held. Reentrant-safe via a
 * depth counter: the panel's per-second render can run while a table sync is
 * already inside this wrapper (ensurePanel is called from sync()) without
 * the inner call prematurely clearing `applying` for the outer one.
 *
 * `fn` MUST be synchronous. Passing an async function releases the guard and
 * fires takeRecords() at the first `await`, leaving every write after that
 * point outside the guard — which feeds the observer, which trips the burst
 * guard, which stops the extension for the rest of the session. Do async
 * work first, then call a synchronous repaint wrapped in this.
 *
 * @param {() => void} fn
 */
export function withApplying(fn) {
  applyingDepth += 1;
  applying = true;
  try {
    fn();
  } finally {
    applyingDepth -= 1;
    if (applyingDepth === 0) {
      // Our own writes above just queued mutation records against the
      // observer we're about to re-arm. Drain them now: the "notify
      // mutation observers" microtask only invokes the callback if the
      // queue is non-empty, so an empty queue means our own edits can't
      // re-trigger schedule() a moment later. The `applying` flag alone
      // isn't enough — it's already false again by the time that
      // microtask would run.
      observer?.takeRecords();
      applying = false;
    }
  }
}
