// `__DEV__` is a compile-time constant substituted by esbuild's `define`
// (see scripts/build.mjs). In a production build it becomes the literal
// `false`, esbuild constant-folds `if (false)` and drops the branch entirely
// — so unlike the old `ENV = "development"` string constant, "forgot to
// flip it before publishing" is no longer possible.
/* global __DEV__ */

export function log(...args) {
  if (__DEV__) console.log("[cto]", ...args);
}

// Deliberately NOT gated on __DEV__ and NOT in esbuild's `drop` list: a
// caught exception in production should leave a visible trace. Silent
// failure is the right posture for the *user* (never nag, never break the
// portal); leaving zero diagnostic signal behind is a bad posture for
// debugging a report of "the column stopped working."
export function warn(...args) {
  console.warn("[cto]", ...args);
}
