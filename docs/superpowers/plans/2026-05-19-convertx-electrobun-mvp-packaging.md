# ConvertX → Electrobun MVP — Standalone Packaged Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the working ConvertX-Electrobun dev build into a standalone packaged Windows app — a self-contained bundle the user double-clicks to run, with no Bun install, no dev toolchain, no setup scripts, and no network at runtime.

**Architecture:** ConvertX is run in production mode with its Tailwind CSS pre-built; on launch the supervisor copies ConvertX from its (read-only) bundled location into a writable `%APPDATA%` directory and runs it from there. The supervisor resolves the bundled `vendor/` at runtime — from `electrobun/bun`'s `PATHS.RESOURCES_FOLDER` in a packaged app, or the project root in dev — so dev and packaged builds share one code path. `electrobun build` produces the base bundle; a `bundle-vendor.ts` script then copies `vendor/` into it.

**Tech Stack:** TypeScript, Bun, Electrobun 1.18.1, `bun test`. Windows 11.

**Spec:** `docs/superpowers/specs/2026-05-19-convertx-electrobun-mvp-packaging-design.md`

**Prerequisites:** the dev build is complete on `master`; Bun, git, and Windows `tar` are on PATH; `vendor/convertx/` and `vendor/converters/win/` are already populated from the dev-build work. Run commands from the project root `C:\Users\PC\Projects\ConvertX` via PowerShell (or any shell with Bun on PATH).

---

## File Structure

| Path | Change |
|---|---|
| `scripts/setup-convertx.ts` | Modify — also compile ConvertX's Tailwind CSS after install |
| `src/bun/convertx.ts` | Modify — `buildConvertxEnv` sets `NODE_ENV=production` |
| `src/bun/convertx.test.ts` | Modify — assert `NODE_ENV` is `"production"` |
| `src/bun/bundle.ts` | Create — vendor-dir picking + first-run ConvertX copy |
| `src/bun/bundle.test.ts` | Create — tests for the above |
| `src/bun/paths.ts` | Modify — new `AppPaths` shape; remove `ensureDataJunction` |
| `src/bun/paths.test.ts` | Modify — match the new shape; drop junction tests |
| `src/bun/index.ts` | Modify — runtime vendor resolution, first-run copy, run ConvertX from the app-data copy |
| `electrobun.config.ts` | Modify — `useAsar: false`; drop the `CONVERTX_PROJECT_ROOT` define |
| `scripts/bundle-vendor.ts` | Create — copy `vendor/` into a built app bundle |
| `scripts/smoke.ts` | Modify — mirror the supervisor (copy-to-app-data, production env) |
| `package.json` | Modify — add a `package` script |

---

## Task 1: ConvertX CSS pre-build in `setup-convertx.ts`

ConvertX must run in production mode, which serves a pre-built `public/generated.css`. The setup script is extended to compile it (ConvertX's own `@tailwindcss/cli` dev-dependency, installed by the `bun install` the script already runs).

**Files:**
- Modify: `scripts/setup-convertx.ts`

- [ ] **Step 1: Add the CSS build after `bun install`**

In `scripts/setup-convertx.ts`, the file currently ends with:
```ts
run("bun", ["install"], CONVERTX_DIR);
console.log("ConvertX is vendored and ready (unmodified).");
```
Replace those two lines with:
```ts
run("bun", ["install"], CONVERTX_DIR);
// ConvertX runs in production mode in the packaged app, which serves a
// pre-built Tailwind stylesheet. Compile it now (same command as ConvertX's
// own `build` script, CSS half only).
run(
  "bun",
  ["x", "@tailwindcss/cli", "-i", "./src/main.css", "-o", "./public/generated.css"],
  CONVERTX_DIR,
);
console.log("ConvertX is vendored and ready (unmodified, CSS pre-built).");
```

- [ ] **Step 2: Run the script and verify the CSS exists**

Run: `bun run scripts/setup-convertx.ts`
Expected: exit 0; the file `vendor/convertx/public/generated.css` now exists and is non-empty.

Run: `Get-Item vendor/convertx/public/generated.css | Select-Object Length`
Expected: a Length well above 0 (tens of KB).

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-convertx.ts
git commit -m "feat: pre-build ConvertX Tailwind CSS in the setup script"
```

---

## Task 2: ConvertX runs in production mode (`convertx.ts`)

**Files:**
- Modify: `src/bun/convertx.test.ts`
- Modify: `src/bun/convertx.ts`

- [ ] **Step 1: Update the test to expect production mode**

In `src/bun/convertx.test.ts`, the first test contains this line:
```ts
  expect(env.NODE_ENV).toBeUndefined();
```
Replace it with:
```ts
  expect(env.NODE_ENV).toBe("production");
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/convertx.test.ts`
Expected: FAIL — the first test fails (`buildConvertxEnv` still clears `NODE_ENV`, so it is `undefined`, not `"production"`).

- [ ] **Step 3: Change `buildConvertxEnv` to set production mode**

In `src/bun/convertx.ts`, inside `buildConvertxEnv`, find this line:
```ts
  delete env.NODE_ENV;
```
Replace it with:
```ts
  env.NODE_ENV = "production";
```
Also update the function's JSDoc: change the sentence
`NODE_ENV is cleared so ConvertX generates its Tailwind CSS at runtime — no build step is needed.`
to
`NODE_ENV is set to production so ConvertX serves its pre-built Tailwind CSS.`

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/convertx.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bun/convertx.ts src/bun/convertx.test.ts
git commit -m "feat: run ConvertX in production mode"
```

---

## Task 3: `src/bun/bundle.ts` — vendor resolution + first-run copy (TDD)

A new module with two pure functions: pick the vendor directory from candidate paths, and copy ConvertX into a writable location once. Kept free of any `electrobun/bun` import so it is unit-testable.

**Files:**
- Create: `src/bun/bundle.test.ts`
- Create: `src/bun/bundle.ts`

- [ ] **Step 1: Write the failing test**

`src/bun/bundle.test.ts`:

```ts
import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";

/** Make a fake vendor dir containing convertx/package.json. */
function makeVendor(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cx-${label}-`));
  mkdirSync(join(dir, "convertx"), { recursive: true });
  writeFileSync(join(dir, "convertx", "package.json"), "{}");
  return dir;
}

test("pickVendorDir prefers the packaged dir when it has ConvertX", () => {
  const packaged = makeVendor("pkg");
  const dev = makeVendor("dev");
  expect(pickVendorDir(packaged, dev)).toBe(packaged);
});

test("pickVendorDir falls back to the dev dir", () => {
  const dev = makeVendor("dev2");
  const packaged = join(tmpdir(), "cx-nonexistent-packaged");
  expect(pickVendorDir(packaged, dev)).toBe(dev);
});

test("pickVendorDir throws when ConvertX is in neither", () => {
  expect(() => pickVendorDir("X:\\nope\\a", "X:\\nope\\b")).toThrow(/ConvertX not found/);
});

test("ensureConvertxCopy copies on first run and is idempotent", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-copy-"));
  const src = join(base, "src-convertx");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  writeFileSync(join(src, "marker.txt"), "v1");
  const dest = join(base, "dest-convertx");

  ensureConvertxCopy(src, dest);
  expect(existsSync(join(dest, "package.json"))).toBe(true);
  expect(existsSync(join(dest, "marker.txt"))).toBe(true);

  // Second call must not throw and must not overwrite (dest already exists).
  writeFileSync(join(dest, "marker.txt"), "edited");
  ensureConvertxCopy(src, dest);
  expect(readFileSync(join(dest, "marker.txt"), "utf8")).toBe("edited");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/bundle.test.ts`
Expected: FAIL — `Cannot find module './bundle'`.

- [ ] **Step 3: Write `src/bun/bundle.ts`**

```ts
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Pick the vendor directory. Prefers `packagedVendor` (the copy baked into a
 * packaged app bundle); falls back to `devVendor` (the project-root `vendor/`
 * used during development). Throws if neither contains ConvertX.
 */
export function pickVendorDir(packagedVendor: string, devVendor: string): string {
  if (existsSync(join(packagedVendor, "convertx", "package.json"))) return packagedVendor;
  if (existsSync(join(devVendor, "convertx", "package.json"))) return devVendor;
  throw new Error(
    `ConvertX not found. Looked in:\n  ${packagedVendor}\n  ${devVendor}\n` +
      `For a dev run, run 'bun run scripts/setup-convertx.ts' first.`,
  );
}

/**
 * Ensure a writable copy of ConvertX exists at `dest`, copied from the
 * (possibly read-only) `src` on first run. A no-op once `dest` exists — delete
 * `dest` to force a refresh after updating the vendored ConvertX.
 */
export function ensureConvertxCopy(src: string, dest: string): void {
  if (existsSync(join(dest, "package.json"))) return;
  cpSync(src, dest, { recursive: true, dereference: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/bundle.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bun/bundle.ts src/bun/bundle.test.ts
git commit -m "feat: add vendor resolution and first-run ConvertX copy"
```

---

## Task 4: `src/bun/paths.ts` — new shape, drop the junction (TDD)

ConvertX now runs from a writable copy at `%APPDATA%\ConvertX-Electrobun\convertx\`, so `getAppPaths` exposes that directory and the data junction is gone.

**Files:**
- Modify: `src/bun/paths.test.ts`
- Modify: `src/bun/paths.ts`

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `src/bun/paths.test.ts` with:

```ts
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppPaths } from "./paths";

test("getAppPaths derives paths and creates the app-data directory", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-paths-"));
  const paths = getAppPaths(base);
  expect(paths.appDataDir).toBe(join(base, "ConvertX-Electrobun"));
  expect(paths.convertxDir).toBe(join(base, "ConvertX-Electrobun", "convertx"));
  expect(paths.jwtSecretFile).toBe(join(base, "ConvertX-Electrobun", "jwt-secret"));
  expect(existsSync(paths.appDataDir)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/paths.test.ts`
Expected: FAIL — `paths.convertxDir` does not exist on the result (the current `AppPaths` has `dataDir`, not `convertxDir`).

- [ ] **Step 3: Replace `src/bun/paths.ts`**

Replace the entire contents of `src/bun/paths.ts` with:

```ts
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  /** Root of all writable app state. */
  appDataDir: string;
  /** Writable copy of ConvertX; ConvertX runs with this as its cwd. */
  convertxDir: string;
  /** Persisted JWT secret file. */
  jwtSecretFile: string;
}

/**
 * Resolve the OS app-data directory for the desktop app and ensure it exists.
 * `appDataBase` defaults to %APPDATA% on Windows.
 */
export function getAppPaths(
  appDataBase: string = process.env.APPDATA ?? homedir(),
): AppPaths {
  const appDataDir = join(appDataBase, "ConvertX-Electrobun");
  mkdirSync(appDataDir, { recursive: true });
  return {
    appDataDir,
    convertxDir: join(appDataDir, "convertx"),
    jwtSecretFile: join(appDataDir, "jwt-secret"),
  };
}
```

(`ensureDataJunction` is intentionally removed — ConvertX's `./data` is now naturally inside the writable `convertxDir`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/paths.test.ts`
Expected: PASS — 1 test.

- [ ] **Step 5: Commit**

```bash
git add src/bun/paths.ts src/bun/paths.test.ts
git commit -m "refactor: app-data paths expose the ConvertX copy dir, drop junction"
```

---

## Task 5: `src/bun/index.ts` — supervisor rewired for packaging

The supervisor resolves `vendor/` at runtime (packaged vs. dev), copies ConvertX into the writable app-data dir on first run, and runs it from there. No data junction, no `CONVERTX_PROJECT_ROOT`.

**Files:**
- Modify: `src/bun/index.ts`

- [ ] **Step 1: Replace `src/bun/index.ts`**

Replace the entire contents of `src/bun/index.ts` with:

```ts
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, PATHS } from "electrobun/bun";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";
import { buildConvertxEnv, converterPathEntries, startConvertX } from "./convertx";
import { waitForHealth } from "./health";
import { getAppPaths } from "./paths";
import { findFreePort } from "./port";

/** Read the persisted JWT secret, or generate and persist one on first run. */
function loadJwtSecret(file: string): string {
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const secret = randomUUID();
  writeFileSync(file, secret, "utf8");
  return secret;
}

function errorPage(message: string): string {
  const escaped = message.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ConvertX</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e8e8e8;padding:2rem;line-height:1.5}
h1{font-size:1.3rem}pre{background:#000;color:#ddd;padding:1rem;border-radius:6px;
overflow:auto;white-space:pre-wrap;word-break:break-word}</style></head>
<body><h1>ConvertX failed to start</h1><pre>${escaped}</pre></body></html>`;
}

const mainWindow = new BrowserWindow({
  title: "ConvertX",
  url: "views://mainview/index.html",
  frame: { width: 1100, height: 800, x: 150, y: 100 },
});

let stopConvertX: (() => void) | undefined;
const cleanup = () => stopConvertX?.();
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

async function boot(): Promise<void> {
  // vendor/ is baked into the bundle for a packaged app, or sits at the project
  // root in dev. pickVendorDir resolves whichever is present; if it throws
  // (vendor missing), boot().catch below shows it on the error page.
  const vendorDir = pickVendorDir(
    join(PATHS.RESOURCES_FOLDER, "app", "vendor"),
    join(process.cwd(), "vendor"),
  );
  const convertersDir = join(vendorDir, "converters", "win");

  const paths = getAppPaths();

  // First run: copy ConvertX from the (read-only-safe) bundle into a writable
  // location. ConvertX then runs with paths.convertxDir as its cwd, so its
  // ./data and ./public both resolve inside writable app-data.
  ensureConvertxCopy(join(vendorDir, "convertx"), paths.convertxDir);

  const jwtSecret = loadJwtSecret(paths.jwtSecretFile);
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;

  let stderrTail = "";
  const env = buildConvertxEnv({
    port,
    jwtSecret,
    pathPrepend: converterPathEntries(convertersDir),
  });
  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: paths.convertxDir,
    env,
    onStdout: (chunk) => process.stdout.write(`[convertx] ${chunk}`),
    onStderr: (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
      process.stderr.write(`[convertx] ${chunk}`);
    },
  });
  stopConvertX = proc.stop;

  try {
    await waitForHealth(url, 45_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mainWindow.webview.loadHTML(
      errorPage(`${message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`),
    );
    return;
  }

  mainWindow.webview.loadURL(url);
  console.log(`ConvertX ready at ${url}`);
}

boot().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(message);
  mainWindow.webview.loadHTML(errorPage(message));
});
```

- [ ] **Step 2: Verify the supervisor bundles cleanly**

Run: `bun build src/bun/index.ts --target=bun --outdir build/_check`
Expected: exit code 0 — every import resolves (`electrobun/bun`, `./bundle`, etc.) and `index.ts` bundles with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/bun/index.ts
git commit -m "feat: supervisor resolves vendor at runtime and runs ConvertX from app-data"
```

---

## Task 6: `electrobun.config.ts` — disable ASAR, drop the dead define

**Files:**
- Modify: `electrobun.config.ts`

- [ ] **Step 1: Edit `electrobun.config.ts`**

The current `build` block is:
```ts
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      define: {
        "process.env.CONVERTX_PROJECT_ROOT": JSON.stringify(PROJECT_ROOT),
      },
    },
    views: {
```
Replace that `build:` opening through the `views:` line with:
```ts
  build: {
    // Keep the bundle as plain files (no app.asar) so vendor/ — copied in by
    // scripts/bundle-vendor.ts after the build — and the converter binaries
    // stay directly readable and executable.
    useAsar: false,
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
```
Then delete the now-unused `PROJECT_ROOT` line near the top of the file:
```ts
const PROJECT_ROOT = import.meta.dir;
```
(The supervisor no longer reads `CONVERTX_PROJECT_ROOT`; resolution is fully at runtime.)

- [ ] **Step 2: Verify the config still parses**

Run: `bun -e "import('./electrobun.config.ts').then(m => console.log('config ok:', m.default.app.name))"`
Expected: prints `config ok: ConvertX`, exit 0.

- [ ] **Step 3: Commit**

```bash
git add electrobun.config.ts
git commit -m "chore: disable asar and remove the build-time project-root define"
```

---

## Task 7: `scripts/bundle-vendor.ts` — bake `vendor/` into a built bundle

`electrobun build` produces the base bundle; this script copies `vendor/convertx/` and `vendor/converters/win/` into it so the packaged app is self-contained.

**Files:**
- Create: `scripts/bundle-vendor.ts`

- [ ] **Step 1: Write `scripts/bundle-vendor.ts`**

```ts
import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const VENDOR_SRC = join(PROJECT_ROOT, "vendor");
const BUILD_DIR = join(PROJECT_ROOT, "build");

/**
 * Find the `app` code folder of a built Electrobun bundle under build/ — the
 * directory that contains a `views` subfolder (Resources/app). Returns the
 * first match found by depth-first search.
 */
function findAppCodeDir(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === "app" && existsSync(join(full, "views"))) return full;
    const hit = findAppCodeDir(full);
    if (hit) return hit;
  }
  return undefined;
}

const appCodeDir = findAppCodeDir(BUILD_DIR);
if (!appCodeDir) {
  console.error(
    `No built app bundle found under ${BUILD_DIR}.\n` +
      `Run 'electrobun build' (or 'bun run build') first.`,
  );
  process.exit(1);
}
console.log(`Found app bundle code dir: ${appCodeDir}`);

for (const parts of [["convertx"], ["converters", "win"]]) {
  const src = join(VENDOR_SRC, ...parts);
  if (!existsSync(src)) {
    console.error(
      `Missing ${src}. Run the setup scripts (setup-convertx.ts, fetch-converters.ts) first.`,
    );
    process.exit(1);
  }
  const dest = join(appCodeDir, "vendor", ...parts);
  console.log(`Copying ${src}\n     -> ${dest}`);
  cpSync(src, dest, { recursive: true, dereference: true });
}

console.log("Vendored ConvertX + converters into the app bundle.");
```

- [ ] **Step 2: Commit**

```bash
git add scripts/bundle-vendor.ts
git commit -m "feat: add script to bake vendor into a built app bundle"
```

(The script is exercised end-to-end in Task 9.)

---

## Task 8: `scripts/smoke.ts` — mirror the new supervisor model

The smoke test must drive ConvertX exactly as the supervisor now does: copy ConvertX into the app-data dir and run it from there.

**Files:**
- Modify: `scripts/smoke.ts`

- [ ] **Step 1: Update the imports and constants**

In `scripts/smoke.ts`, replace the import/constant block at the top — currently:
```ts
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildConvertxEnv, converterPathEntries, startConvertX } from "../src/bun/convertx";
import { waitForHealth } from "../src/bun/health";
import { ensureDataJunction, getAppPaths } from "../src/bun/paths";
import { findFreePort } from "../src/bun/port";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTERS_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");
```
with:
```ts
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { ensureConvertxCopy } from "../src/bun/bundle";
import { buildConvertxEnv, converterPathEntries, startConvertX } from "../src/bun/convertx";
import { waitForHealth } from "../src/bun/health";
import { getAppPaths } from "../src/bun/paths";
import { findFreePort } from "../src/bun/port";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const VENDOR_CONVERTX = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTERS_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");
```

- [ ] **Step 2: Update the boot block**

In `main()`, replace the current block — from the `if (!existsSync(...))` guard through the `startConvertX` call — currently:
```ts
  if (!existsSync(join(CONVERTX_DIR, "package.json"))) {
    throw new Error("ConvertX not vendored — run scripts/setup-convertx.ts first.");
  }

  const paths = getAppPaths();
  ensureDataJunction(join(CONVERTX_DIR, "data"), paths.dataDir);
  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;

  const env = buildConvertxEnv({
    port,
    jwtSecret: randomUUID(),
    pathPrepend: converterPathEntries(CONVERTERS_DIR),
  });
  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: CONVERTX_DIR,
    env,
    onStderr: (c) => process.stderr.write(`[convertx] ${c}`),
  });
```
with:
```ts
  if (!existsSync(join(VENDOR_CONVERTX, "package.json"))) {
    throw new Error("ConvertX not vendored — run scripts/setup-convertx.ts first.");
  }

  const paths = getAppPaths();
  ensureConvertxCopy(VENDOR_CONVERTX, paths.convertxDir);
  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;

  const env = buildConvertxEnv({
    port,
    jwtSecret: randomUUID(),
    pathPrepend: converterPathEntries(CONVERTERS_DIR),
  });
  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: paths.convertxDir,
    env,
    onStderr: (c) => process.stderr.write(`[convertx] ${c}`),
  });
```

- [ ] **Step 3: Update the output-directory path**

In `main()`, the output poll currently reads:
```ts
    const outDir = join(paths.dataDir, "output", "0", jobId);
```
Replace it with:
```ts
    const outDir = join(paths.convertxDir, "data", "output", "0", jobId);
```

- [ ] **Step 4: Run the unit suite and the smoke test**

Run: `bun test src/bun`
Expected: PASS — all tests (port 2, paths 1, health 2, convertx 2, bundle 4 = 11).

Run: `bun run scripts/smoke.ts`
Expected: prints `SMOKE TEST PASSED — produced …` and exits 0. (ConvertX is now copied to `%APPDATA%\ConvertX-Electrobun\convertx\` and run from there, in production mode with pre-built CSS. If a stale copy from an earlier run exists, delete `%APPDATA%\ConvertX-Electrobun\convertx` first so the fresh CSS-built copy is used.)

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke.ts
git commit -m "test: smoke test mirrors the copy-to-app-data supervisor model"
```

---

## Task 9: Package the app and verify end-to-end

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add a `package` script to `package.json`**

In `package.json`, the `scripts` block currently is:
```json
  "scripts": {
    "dev": "electrobun dev",
    "build": "electrobun build",
    "test": "bun test src/bun",
    "setup": "bun run scripts/setup-convertx.ts && bun run scripts/fetch-converters.ts"
  },
```
Replace it with:
```json
  "scripts": {
    "dev": "electrobun dev",
    "build": "electrobun build",
    "package": "electrobun build && bun run scripts/bundle-vendor.ts",
    "test": "bun test src/bun",
    "setup": "bun run scripts/setup-convertx.ts && bun run scripts/fetch-converters.ts"
  },
```

- [ ] **Step 2: Confirm `vendor/` is fully prepared**

Run: `bun run scripts/setup-convertx.ts`
Expected: exit 0; `vendor/convertx/public/generated.css` exists (Task 1).

Confirm converters are present (from the dev-build work; re-run if missing):
Run: `Test-Path vendor/converters/win/ffmpeg.exe, vendor/converters/win/imagemagick/magick.exe`
Expected: both `True`. If not, run `bun run scripts/fetch-converters.ts`.

- [ ] **Step 3: Verify dev mode still works**

Run: `bun test src/bun`
Expected: PASS — 11 tests.

Run: `bun run dev`
Expected: a native window opens and loads ConvertX's converter UI (no login). Close the window. (This proves the shared dev/packaged code path: the supervisor resolved `vendor/` via the dev branch and ran ConvertX from the app-data copy.)

- [ ] **Step 4: Build and bundle the packaged app**

Run: `bun run package`
Expected: `electrobun build` completes and produces an app bundle under `build/`; then `bundle-vendor.ts` prints `Found app bundle code dir: …` and copies ConvertX + converters in, ending with `Vendored ConvertX + converters into the app bundle.` Exit code 0.

(If `electrobun build` is not the correct subcommand, run bare `electrobun` to build, then `bun run scripts/bundle-vendor.ts` — the bundle script is independent of how the build was produced.)

- [ ] **Step 5: Locate and run the packaged app**

Find the produced executable:
Run: `Get-ChildItem -Recurse build -Filter *.exe | Where-Object { $_.Name -notmatch 'launcher|bun|bspatch|bsdiff|process_helper|extractor' } | Select-Object FullName`
Expected: lists the app's main `.exe` (e.g. `build\…\ConvertX\bin\ConvertX.exe`).

Launch that `.exe` by double-clicking it in Explorer (or `Start-Process <path>`), from its build location — representing a machine with no dev environment.
Expected: the window opens, shows the splash, then loads ConvertX's converter UI with no login screen. On first launch the supervisor copies ConvertX into `%APPDATA%\ConvertX-Electrobun\convertx\` (a brief pause).

- [ ] **Step 6: Verify a conversion in the packaged app**

In the running packaged app: drag an image onto the dropzone, choose a target format whose converter is bundled (e.g. JPG via ImageMagick, or SVG via vtracer), click **Convert**, and confirm a finished file you can download. Close the window afterward.

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "feat: add package script producing the standalone bundle"
```

---

## Definition of Done

Per spec §8:

1. `setup-convertx.ts` + `fetch-converters.ts` leave `vendor/` fully prepared, including `vendor/convertx/public/generated.css` (Task 1, Task 9 Step 2).
2. `bun test src/bun` passes — 11 tests (Task 9 Step 3).
3. `electrobun dev` still launches and works (Task 9 Step 3).
4. `bun run package` produces a packaged Windows app bundle with `vendor/` baked in (Task 9 Step 4).
5. The packaged `.exe`, launched from its build location, opens the window, loads ConvertX (no login), and converts a file (Task 9 Steps 5–6).
6. Closing the app leaves no orphaned ConvertX process (existing behavior).

## Notes for the Implementer

- **ConvertX stays unmodified.** Only the supervisor, scripts, and config change. `vendor/convertx/` is still a pristine clone (now with its CSS compiled — a build artifact, not a source edit).
- **Refreshing the app-data ConvertX copy:** `ensureConvertxCopy` only copies when the destination is absent. After changing the vendored ConvertX, delete `%APPDATA%\ConvertX-Electrobun\convertx\` so the next launch re-copies.
- **Dev vendor resolution** relies on `process.cwd()` being the project root under `electrobun dev`. Task 9 Step 3 verifies this; if `electrobun dev` runs the supervisor from a different cwd, `pickVendorDir`'s dev candidate needs adjusting (e.g. an `import.meta.dir`-relative walk) — a localized fix in `index.ts`.
- **Out of scope** (spec §9): code signing, an installer, auto-update, app icon, macOS/Linux, the robustness follow-ups. The packaged app is unsigned — Windows SmartScreen will warn on first launch; that is expected for this MVP.
