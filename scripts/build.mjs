#!/usr/bin/env node
// One devDependency (esbuild), one ~100-line script: bundling, per-target
// manifest generation, static copying, dev/prod defines, and watch mode.
// See CLAUDE.md for why esbuild was chosen over WXT/Vite+crxjs/webpack.

import { build, context } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createManifest } from "../src/manifest.config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const hasFlag = (name) => args.includes(`--${name}`);

if (hasFlag("clean")) {
  rmSync(path.join(ROOT, "dist"), { recursive: true, force: true });
  rmSync(path.join(ROOT, "release"), { recursive: true, force: true });
  console.log("cleaned dist/ and release/");
  process.exit(0);
}

const targetArg = flag("target", "chrome");
const mode = flag("mode", "development");
const watch = hasFlag("watch");
const targets = targetArg === "all" ? ["chrome", "firefox"] : [targetArg];

async function buildTarget(target) {
  const outDir = path.join(ROOT, "dist", target);
  mkdirSync(outDir, { recursive: true });

  const options = {
    entryPoints: [path.join(ROOT, "src/content/index.js")],
    outfile: path.join(outDir, "content.js"),
    bundle: true,
    // Required: MV3 content scripts cannot be declared "type":"module" in
    // either browser, so cross-file import/export needs a bundler. IIFE
    // also keeps every symbol out of the page's global scope — the old
    // flat content.js declared ENV/SAFE_DURATION/etc. as page globals.
    format: "iife",
    target: ["chrome111", "firefox115"],
    define: {
      __DEV__: JSON.stringify(mode !== "production"),
      __TARGET__: JSON.stringify(target),
      __VERSION__: JSON.stringify(pkg.version),
    },
    // Deliberately never minified, in either mode: for ~300 lines the byte
    // savings are irrelevant, a readable bundle keeps AMO review trivial,
    // and a production bug is debuggable directly in the browser.
    minify: false,
    sourcemap: mode === "production" ? false : "inline",
    // Only `debugger` is dropped. `console.log` calls are already gone via
    // the __DEV__ dead-code elimination above (see src/lib/log.js);
    // console.warn is deliberately left in so a caught exception still
    // leaves a trace in a production build.
    drop: mode === "production" ? ["debugger"] : [],
    logLevel: "info",
  };

  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log(`watching ${target} -> dist/${target}`);
  } else {
    await build(options);
  }

  copyFileSync(path.join(ROOT, "src/styles.css"), path.join(outDir, "styles.css"));

  const manifest = createManifest(target, pkg.version);
  writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  console.log(`built ${target} -> dist/${target} (version ${pkg.version}, mode ${mode})`);
}

for (const target of targets) {
  await buildTarget(target);
}

if (watch) {
  await new Promise(() => {}); // keep the process alive for esbuild's watcher
}
