#!/usr/bin/env node
// Zips each dist/<target> for store upload. Critical property: manifest.json
// must sit at the ARCHIVE ROOT, not inside a folder — that's the layout the
// Chrome Web Store rejects, and why Finder's "Compress" (which wraps the
// selection in a folder) doesn't work. Zipping FROM INSIDE dist/<target>
// guarantees the correct layout without special-casing it.

import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const releaseDir = path.join(ROOT, "release");
mkdirSync(releaseDir, { recursive: true });

for (const target of ["chrome", "firefox"]) {
  const distDir = path.join(ROOT, "dist", target);
  if (!existsSync(path.join(distDir, "manifest.json"))) {
    console.error(`dist/${target} has no manifest.json — run "npm run build" first`);
    process.exit(1);
  }

  const zipPath = path.join(releaseDir, `cefalo-timeout-${target}-${pkg.version}.zip`);
  if (existsSync(zipPath)) unlinkSync(zipPath);

  execSync(`zip -r -X "${zipPath}" . -x '*.DS_Store' -x '__MACOSX/*'`, {
    cwd: distDir,
    stdio: "inherit",
  });
  console.log(`created release/${path.basename(zipPath)}`);
}
