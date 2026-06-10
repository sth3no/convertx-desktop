import { spawnSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const VENDOR_SRC = join(PROJECT_ROOT, "vendor");
const BUILD_DIR = join(PROJECT_ROOT, "build");

/** App name from electrobun.config.ts (app.name). Kept in sync by hand. */
const APP_NAME = "ConvertX";

/**
 * Top-level entries of vendor/convertx that must never ship: `data` holds the
 * developer's runtime state (sqlite DB, uploads, conversion outputs) and
 * `.git` the clone history. Mirrors the exclusion in src/bun/bundle.ts —
 * duplicated on purpose so this script stays self-contained.
 */
const EXCLUDED_CONVERTX_ENTRIES = [".git", "data"];

// The dev bundle's app code dir (Resources/app), resolved deterministically —
// never by searching build/, which could hit a stale bundle from another env.
// Only the dev env is supported: a flagless 'electrobun build' (what
// 'bun run package' runs) builds dev, and electrobun 1.18.1 tars-and-DELETES
// the bundle folder of canary/stable builds before this script could run
// (node_modules/electrobun/src/cli/index.ts, artifact block) — baking vendor
// into those would need an electrobun postBuild hook instead.
const BUNDLE_DIR = join(BUILD_DIR, "dev-win-x64", `${APP_NAME}-dev`);
const APP_CODE_DIR = join(BUNDLE_DIR, "Resources", "app");

/**
 * Build a cpSync filter that skips the given top-level entries of `srcRoot`.
 * Filtering out a directory prunes everything beneath it, so matching the
 * first path segment is sufficient.
 */
function excludeTopLevel(srcRoot: string, excluded: string[]): (source: string) => boolean {
  const root = resolve(srcRoot);
  return (source) => {
    const topSegment = relative(root, resolve(source)).split(sep)[0]!;
    return !excluded.includes(topSegment);
  };
}

const appCodeDir = APP_CODE_DIR;
if (!existsSync(join(appCodeDir, "views"))) {
  console.error(
    `No built dev app bundle at ${appCodeDir} (missing views/).\n` +
      `Run 'bun run build' first.`,
  );
  process.exit(1);
}
console.log(`Target app bundle code dir: ${appCodeDir}`);

// Wipe the destination vendor dir before copying so nothing from an earlier
// bake survives — in particular a previously-copied convertx/data with the
// developer's personal uploads and database.
const vendorDest = join(appCodeDir, "vendor");
rmSync(vendorDest, { recursive: true, force: true });

for (const parts of [["convertx"], ["converters", "win"]]) {
  const src = join(VENDOR_SRC, ...parts);
  if (!existsSync(src)) {
    console.error(
      `Missing ${src}. Run the setup scripts (setup-convertx.ts, fetch-converters.ts) first.`,
    );
    process.exit(1);
  }
  const dest = join(vendorDest, ...parts);
  const filter =
    parts[0] === "convertx" ? excludeTopLevel(src, EXCLUDED_CONVERTX_ENTRIES) : undefined;
  console.log(`Copying ${src}\n     -> ${dest}`);
  cpSync(src, dest, { recursive: true, dereference: true, filter });
}

// Electrobun's own icon embedding (build.win.icon) is broken in this install:
// its compiled CLI resolves rcedit against its own CI build path and only
// warns. Embed the icon ourselves with the rcedit binary that ships in
// electrobun's dependencies. Warn-only on failure, matching electrobun — the
// icon is cosmetic and must not fail the packaging.
const rcedit = join(PROJECT_ROOT, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(PROJECT_ROOT, "assets", "icon.ico");
for (const exe of ["launcher.exe", "bun.exe"]) {
  const target = join(BUNDLE_DIR, "bin", exe);
  if (!existsSync(rcedit) || !existsSync(icon) || !existsSync(target)) {
    console.warn(`WARNING: skipped icon embed for ${exe} (rcedit, icon, or target missing).`);
    continue;
  }
  const result = spawnSync(rcedit, [target, "--set-icon", icon], { stdio: "inherit" });
  if (result.status === 0) {
    console.log(`Embedded icon into ${exe}.`);
  } else {
    console.warn(`WARNING: rcedit failed to embed the icon into ${exe} (exit ${result.status}).`);
  }
}

console.log("Vendored ConvertX + converters into the app bundle (data/ and .git/ excluded).");
