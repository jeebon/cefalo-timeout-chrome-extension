// Generates the manifest per target instead of maintaining one file with
// both browsers' keys — a shared manifest makes Chrome log "Unrecognized
// manifest key" for browser_specific_settings, and trips the AMO linter on
// Chrome-only keys.
//
// The whole Chrome/Firefox delta is one key (browser_specific_settings),
// because there is no background script in either build: the old
// background.js was three unused console.log listeners, and deleting it
// removes both the only chrome.* usage in the codebase and the largest
// possible manifest divergence (service_worker vs scripts).

/**
 * @param {"chrome"|"firefox"} target
 * @param {string} version
 */
export function createManifest(target, version) {
  const manifest = {
    manifest_version: 3,
    name: "Cefalo Timeout",
    version,
    description:
      "Adds a computed Secure End Time column and a live Today countdown panel to the Cefalo HR portal attendance report.",
    author: "Anowar Hossain Jeebon",
    // `storage` is the only permission this extension declares. It backs the
    // members-directory tracker's local history (chrome.storage.local) —
    // never a network permission, never a host permission beyond `matches`
    // below. Neither browser shows the user a warning for `storage`.
    permissions: ["storage"],
    // No `host_permissions`: a statically declared content script derives
    // its host access from `matches` below and is its own grant. Broad host
    // (rather than /attendance/* only) is intentional — the route gate lives
    // in the script at sync() time, not in the manifest, so the script (and
    // its MutationObserver) is present on every portal page and can catch
    // client-side navigation into /attendance/ or /members-directory/ that
    // never fires a document load event.
    content_scripts: [
      {
        matches: ["https://hrportal.cefalolab.com/*"],
        js: ["content.js"],
        css: ["styles.css"],
        run_at: "document_idle",
      },
    ],
  };

  if (target === "firefox") {
    manifest.browser_specific_settings = {
      gecko: {
        id: "cefalo-timeout@jeebon.github.io",
        strict_min_version: "115.0",
      },
    };
  }

  return manifest;
}
