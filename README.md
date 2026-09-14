# Cefalo Timeout Extension

The Cefalo Timeout Extension enhances the attendance reports in the Cefalo HR Portal by adding a
"Secure End Time" column and, for today's row, how long you've been clocked in.

Available for **Chrome and Firefox**, built from one source tree.

## Features

- **Secure End Time column**: automatically calculates and displays the recommended leave time
  based on the minimum required hours, shown in 24-hour time with a `(+1d)` marker if it crosses
  midnight.

- **Elapsed time, for today only**: while you're still clocked in today, the column also shows how
  long you've been in. Once you check out, the portal's own Total Work Hour is authoritative and
  the extension gets out of the way.

- **Local processing only**: all data processing happens locally in your browser, by reading the
  attendance table already on the page. Nothing is transmitted anywhere, and the extension makes
  no network requests of its own.

## Installation

- **Chrome**: install from the Chrome Web Store once published, or load `dist/chrome` unpacked
  via `chrome://extensions` → Developer mode → Load unpacked (see Development below to build it).
- **Firefox**: install the signed add-on from addons.mozilla.org once published, or load
  `dist/firefox/manifest.json` as a temporary add-on via
  `about:debugging#/runtime/this-firefox` for development (temporary add-ons don't survive a
  Firefox restart).

## Development

```bash
npm install
npm run build          # builds both dist/chrome and dist/firefox
npm run build:chrome    # Chrome only
npm run build:firefox   # Firefox only
npm run dev             # Chrome, watch mode
npm test                # runs the unit tests (pure time-math logic only)
npm run zip              # builds, then produces release/*.zip for store upload
```

There is one devDependency (`esbuild`). See `CLAUDE.md` for the full architecture writeup.

## Contributing

1. Fork the repository and clone it locally:

    ```bash
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2. Create a new branch for your feature or bug fix:

    ```bash
    git checkout -b feature/new-feature
    ```

3. Make your changes, run `npm test` and `npm run build`, and verify in a real browser (load the
   relevant `dist/<target>` unpacked) before committing.

4. Commit and push:

    ```bash
    git add .
    git commit -m "Add new feature: describe your changes"
    git push origin feature/new-feature
    ```

## Permissions Justification

This extension declares **no `permissions` and no `host_permissions`**. Its only manifest entry
relevant to access is a `content_scripts.matches` pattern scoped to
`https://hrportal.cefalolab.com/*` — a statically declared content script derives its host access
from that match pattern alone, and nothing broader is requested. The extension:

- never makes a network request of its own (no `fetch`, no `XMLHttpRequest`);
- never reads `localStorage`, cookies, or any authentication token;
- only reads and modifies the DOM of the attendance table already rendered on the page, and only
  on the Cefalo HR Portal.

The content script is loaded on the whole portal host, not only the `/attendance/` path, because
the portal is a single-page app: navigating between its tabs never triggers a full page load, so
a path-restricted match pattern would miss users who land on (say) the login page and click
through to Attendance without a hard reload. The extension only takes any visible action on the
Attendance page itself — this is enforced in code, not by the manifest.

## Privacy Policy

For information about how we handle your data, please refer to our [Privacy Policy](https://jeebon.github.io/cefalo-timeout-chrome-extension/privacy.html).

## Packaging for store upload

```bash
npm run zip
```

This builds both targets and produces `release/cefalo-timeout-chrome-<version>.zip` and
`release/cefalo-timeout-firefox-<version>.zip`, each zipped from inside its `dist/<target>`
directory so `manifest.json` sits at the archive root — the layout both the Chrome Web Store and
AMO expect. Do **not** use Finder's "Compress" (it wraps the selection in a folder and will be
rejected).

Neither build is minified: the code stays human-readable in the browser and on store review.

## License

This project is licensed under the MIT License.
