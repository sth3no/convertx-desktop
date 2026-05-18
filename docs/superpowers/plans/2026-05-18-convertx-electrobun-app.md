# ConvertX → Electrobun Desktop App — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap the ConvertX web converter as a native Windows desktop app — an Electrobun app whose Bun main process supervises a vendored, unmodified ConvertX server and shows it in a window.

**Architecture:** Approach A from the spec — a subprocess supervisor. Electrobun's Bun main process picks a free port, spawns ConvertX (`bun run src/index.tsx`) as a child with a tailored environment (auth-via-env, bundled converters on `PATH`, data redirected to the OS app-data dir via a directory junction), waits for it to be healthy, then points the window's webview at it. ConvertX is vendored under `vendor/convertx/` and is **not modified**.

**Tech Stack:** TypeScript, Bun, Electrobun 1.18.1 (system WebView2 on Windows), ConvertX 0.17.0 (Bun + Elysia). Tests run with `bun test`.

**Spec:** `docs/superpowers/specs/2026-05-18-convertx-electrobun-app-design.md`

**Prerequisites (already verified on this machine):** Bun 1.3.14, Node, git, and Windows 11 (ships `tar.exe` and the WebView2 runtime) are installed and on the Windows `PATH`. Run all commands in PowerShell (or any shell with Bun on `PATH`) from the project root `C:\Users\PC\Projects\ConvertX`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `package.json` | Electrobun app manifest: deps + `dev`/`build`/`test`/`setup` scripts |
| `electrobun.config.ts` | Electrobun build config; injects the project root into the bun build |
| `tsconfig.json` | TypeScript config for the app |
| `.gitignore` | Ignore `node_modules/`, `build/`, `vendor/` |
| `src/bun/index.ts` | Supervisor entry — orchestrates boot, owns the window |
| `src/bun/port.ts` | `findFreePort()` — free loopback TCP port |
| `src/bun/paths.ts` | `getAppPaths()` + `ensureDataJunction()` — app-data dir & data junction |
| `src/bun/health.ts` | `waitForHealth()` — poll a URL until it serves |
| `src/bun/convertx.ts` | `buildConvertxEnv()` + `startConvertX()` — ConvertX child env & process |
| `src/bun/*.test.ts` | `bun test` unit tests for the four modules above |
| `src/mainview/index.html` / `.css` / `.ts` | Splash screen shown while ConvertX boots |
| `scripts/setup-convertx.ts` | Clone + `bun install` ConvertX into `vendor/convertx/` |
| `scripts/fetch-converters.ts` | Download the curated converter binaries |
| `scripts/smoke.ts` | Headless end-to-end check: boot ConvertX, convert a file over HTTP |

Each `src/bun/*` module has one responsibility and is independently testable. ConvertX (`vendor/convertx/`) and the converter binaries (`vendor/converters/`) are git-ignored and produced by the setup scripts.

---

## Task 1: Scaffold the Electrobun app

**Files:**
- Create: `package.json`
- Create: `electrobun.config.ts`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Create `.gitignore`**

```
node_modules/
build/
dist/
vendor/
*.log
.DS_Store
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "convertx-electrobun",
  "version": "0.1.0",
  "private": true,
  "module": "src/bun/index.ts",
  "type": "module",
  "scripts": {
    "dev": "electrobun dev",
    "build": "electrobun build",
    "test": "bun test src/bun",
    "setup": "bun run scripts/setup-convertx.ts && bun run scripts/fetch-converters.ts"
  },
  "dependencies": {
    "electrobun": "^1.18.1"
  },
  "devDependencies": {
    "@types/bun": "latest"
  }
}
```

- [ ] **Step 3: Create `electrobun.config.ts`**

The project root is captured here (this file lives at the root) and injected into the bun build, so the supervisor can locate `vendor/` regardless of its own bundle location.

```ts
import type { ElectrobunConfig } from "electrobun";

const PROJECT_ROOT = import.meta.dir;

export default {
  app: {
    name: "ConvertX",
    identifier: "dev.convertx.electrobun",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: "src/bun/index.ts",
      define: {
        "process.env.CONVERTX_PROJECT_ROOT": JSON.stringify(PROJECT_ROOT),
      },
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
```

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "lib": ["ESNext", "DOM"],
    "module": "ESNext",
    "target": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src", "scripts", "electrobun.config.ts"],
  "exclude": ["node_modules", "vendor", "build"]
}
```

- [ ] **Step 5: Install dependencies**

Run: `bun install`
Expected: `electrobun` and `@types/bun` install; a `bun.lock` is created; exit code 0.

- [ ] **Step 6: Commit**

```bash
git add .gitignore package.json electrobun.config.ts tsconfig.json bun.lock
git commit -m "chore: scaffold Electrobun app shell"
```

---

## Task 2: Splash view

The window opens on this static splash; the supervisor swaps it to ConvertX once healthy.

**Files:**
- Create: `src/mainview/index.html`
- Create: `src/mainview/index.css`
- Create: `src/mainview/index.ts`

- [ ] **Step 1: Create `src/mainview/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ConvertX</title>
    <link rel="stylesheet" href="index.css" />
  </head>
  <body>
    <main class="splash">
      <div class="spinner"></div>
      <h1>ConvertX</h1>
      <p>Starting the converter&hellip;</p>
    </main>
  </body>
</html>
```

- [ ] **Step 2: Create `src/mainview/index.css`**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  background: #1a1a1a;
  color: #e8e8e8;
}
.splash {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}
.splash h1 { font-size: 1.6rem; font-weight: 600; }
.splash p { color: #9a9a9a; }
.spinner {
  width: 40px; height: 40px;
  border: 4px solid #333;
  border-top-color: #6aa9ff;
  border-radius: 50%;
  animation: spin 0.9s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
```

- [ ] **Step 3: Create `src/mainview/index.ts`**

```ts
// Splash view entrypoint. The window is swapped to the ConvertX URL by the
// supervisor (src/bun/index.ts) once the server is healthy.
export {};
```

- [ ] **Step 4: Commit**

```bash
git add src/mainview
git commit -m "feat: add boot splash view"
```

---

## Task 3: `src/bun/port.ts` — free port allocation (TDD)

**Files:**
- Create: `src/bun/port.test.ts`
- Create: `src/bun/port.ts`

- [ ] **Step 1: Write the failing test**

`src/bun/port.test.ts`:

```ts
import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { findFreePort } from "./port";

test("findFreePort returns a port that can be bound", async () => {
  const port = await findFreePort();
  expect(port).toBeGreaterThan(0);
  expect(port).toBeLessThan(65536);

  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
});

test("findFreePort returns distinct ports for concurrent calls", async () => {
  const ports = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
  expect(new Set(ports).size).toBe(3);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/port.test.ts`
Expected: FAIL — `Cannot find module './port'` (or "findFreePort is not a function").

- [ ] **Step 3: Write `src/bun/port.ts`**

```ts
import { createServer } from "node:net";

/** Resolve to a currently-free loopback TCP port. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to acquire a port")));
      }
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/port.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bun/port.ts src/bun/port.test.ts
git commit -m "feat: add free port allocation"
```

---

## Task 4: `src/bun/paths.ts` — app-data paths & data junction (TDD)

**Files:**
- Create: `src/bun/paths.test.ts`
- Create: `src/bun/paths.ts`

- [ ] **Step 1: Write the failing test**

`src/bun/paths.test.ts`:

```ts
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppPaths, ensureDataJunction } from "./paths";

test("getAppPaths derives paths and creates the data directory", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-paths-"));
  const paths = getAppPaths(base);
  expect(paths.appDataDir).toBe(join(base, "ConvertX-Electrobun"));
  expect(paths.dataDir).toBe(join(base, "ConvertX-Electrobun", "data"));
  expect(paths.jwtSecretFile).toBe(join(base, "ConvertX-Electrobun", "jwt-secret"));
  expect(existsSync(paths.dataDir)).toBe(true);
});

test("ensureDataJunction links a missing path onto the data directory", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-junc-"));
  const paths = getAppPaths(base);
  const link = join(base, "convertx-data");
  ensureDataJunction(link, paths.dataDir);
  expect(existsSync(link)).toBe(true);
  expect(realpathSync(link)).toBe(realpathSync(paths.dataDir));
});

test("ensureDataJunction leaves an already-existing path untouched", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-junc2-"));
  const paths = getAppPaths(base);
  // paths.appDataDir already exists (getAppPaths created it) — must not throw.
  ensureDataJunction(paths.appDataDir, paths.dataDir);
  expect(existsSync(paths.appDataDir)).toBe(true);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/paths.test.ts`
Expected: FAIL — `Cannot find module './paths'`.

- [ ] **Step 3: Write `src/bun/paths.ts`**

```ts
import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  appDataDir: string;
  dataDir: string;
  jwtSecretFile: string;
}

/**
 * Resolve the OS app-data directory for the desktop app and ensure the data
 * directory exists. `appDataBase` defaults to %APPDATA% on Windows.
 */
export function getAppPaths(
  appDataBase: string = process.env.APPDATA ?? homedir(),
): AppPaths {
  const appDataDir = join(appDataBase, "ConvertX-Electrobun");
  const dataDir = join(appDataDir, "data");
  mkdirSync(dataDir, { recursive: true });
  return { appDataDir, dataDir, jwtSecretFile: join(appDataDir, "jwt-secret") };
}

/**
 * Make `linkPath` a Windows directory junction onto `dataDir`, so ConvertX's
 * cwd-relative `./data` lands in the OS app-data dir. Idempotent: if `linkPath`
 * already exists it is left as-is.
 */
export function ensureDataJunction(linkPath: string, dataDir: string): void {
  if (existsSync(linkPath)) return;
  symlinkSync(dataDir, linkPath, "junction");
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/paths.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bun/paths.ts src/bun/paths.test.ts
git commit -m "feat: add app-data paths and data junction"
```

---

## Task 5: `src/bun/health.ts` — health check (TDD)

**Files:**
- Create: `src/bun/health.test.ts`
- Create: `src/bun/health.ts`

- [ ] **Step 1: Write the failing test**

`src/bun/health.test.ts`:

```ts
import { expect, test } from "bun:test";
import { waitForHealth } from "./health";

test("waitForHealth resolves once the server responds", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  try {
    await waitForHealth(`http://127.0.0.1:${server.port}/`, 5_000, 50);
  } finally {
    server.stop(true);
  }
});

test("waitForHealth rejects when nothing responds before the timeout", async () => {
  // Nothing is listening on port 1 — fetch fails fast and the poll loop expires.
  await expect(waitForHealth("http://127.0.0.1:1/", 600, 100)).rejects.toThrow(
    /Timed out/,
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/health.test.ts`
Expected: FAIL — `Cannot find module './health'`.

- [ ] **Step 3: Write `src/bun/health.ts`**

```ts
/**
 * Poll `url` until it returns any HTTP response, or reject after `timeoutMs`.
 * A redirect (e.g. 302) counts as healthy — it means the server is serving.
 */
export async function waitForHealth(
  url: string,
  timeoutMs = 45_000,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms (${lastError})`);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/health.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/bun/health.ts src/bun/health.test.ts
git commit -m "feat: add ConvertX health-check polling"
```

---

## Task 6: `src/bun/convertx.ts` — ConvertX process manager (TDD the env builder)

`buildConvertxEnv()` is a pure function and is unit-tested. `startConvertX()` spawns a real process and is exercised by the smoke test (Task 10).

**Files:**
- Create: `src/bun/convertx.test.ts`
- Create: `src/bun/convertx.ts`

- [ ] **Step 1: Write the failing test**

`src/bun/convertx.test.ts`:

```ts
import { expect, test } from "bun:test";
import { delimiter } from "node:path";
import { buildConvertxEnv } from "./convertx";

test("buildConvertxEnv sets the no-login desktop env and prepends converters", () => {
  const env = buildConvertxEnv({
    port: 4321,
    jwtSecret: "secret-abc",
    pathPrepend: ["C:\\conv", "C:\\conv\\imagemagick"],
    baseEnv: { Path: "C:\\Windows", NODE_ENV: "production" },
  });
  expect(env.PORT).toBe("4321");
  expect(env.JWT_SECRET).toBe("secret-abc");
  expect(env.ALLOW_UNAUTHENTICATED).toBe("true");
  expect(env.UNAUTHENTICATED_USER_SHARING).toBe("true");
  expect(env.HTTP_ALLOWED).toBe("true");
  expect(env.NODE_ENV).toBeUndefined();
  expect(env.Path).toBeUndefined();
  expect(env.PATH).toBe(
    `C:\\conv${delimiter}C:\\conv\\imagemagick${delimiter}C:\\Windows`,
  );
});

test("buildConvertxEnv works when the base env has no PATH at all", () => {
  const env = buildConvertxEnv({
    port: 1,
    jwtSecret: "s",
    pathPrepend: ["X:\\conv"],
    baseEnv: {},
  });
  expect(env.PATH).toBe("X:\\conv");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bun test src/bun/convertx.test.ts`
Expected: FAIL — `Cannot find module './convertx'`.

- [ ] **Step 3: Write `src/bun/convertx.ts`**

```ts
import { spawn } from "node:child_process";
import { delimiter } from "node:path";

export interface ConvertxEnvOptions {
  port: number;
  jwtSecret: string;
  /** Directories prepended to the child PATH (the bundled converters). */
  pathPrepend: string[];
  baseEnv?: Record<string, string | undefined>;
}

/**
 * Build the environment for the ConvertX child process. ConvertX runs in
 * its built-in unauthenticated mode (no login screen), with HTTP cookies
 * allowed (the server is plain http on loopback) and the bundled converter
 * binaries on PATH. NODE_ENV is cleared so ConvertX generates its Tailwind
 * CSS at runtime — no build step is needed.
 */
export function buildConvertxEnv(opts: ConvertxEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.baseEnv ?? process.env)) {
    if (typeof value === "string") env[key] = value;
  }

  // Windows env keys are case-insensitive but JS object keys are not — collapse
  // any PATH/Path/path variant into a single PATH.
  let currentPath = "";
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") {
      currentPath = env[key]!;
      delete env[key];
    }
  }
  env.PATH = [...opts.pathPrepend, currentPath].filter(Boolean).join(delimiter);

  env.PORT = String(opts.port);
  env.JWT_SECRET = opts.jwtSecret;
  env.ALLOW_UNAUTHENTICATED = "true";
  env.UNAUTHENTICATED_USER_SHARING = "true";
  env.HTTP_ALLOWED = "true";
  delete env.NODE_ENV;
  return env;
}

export interface StartOptions {
  /** Path to the bun executable to run ConvertX with (use process.execPath). */
  bunPath: string;
  /** Absolute path to the vendored ConvertX checkout. */
  convertxDir: string;
  env: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

/** Spawn ConvertX (`bun run src/index.tsx`) as a child process. */
export function startConvertX(opts: StartOptions): { stop: () => void } {
  const child = spawn(opts.bunPath, ["run", "src/index.tsx"], {
    cwd: opts.convertxDir,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  if (opts.onStdout) child.stdout?.on("data", opts.onStdout);
  if (opts.onStderr) child.stderr?.on("data", opts.onStderr);

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      child.kill();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun test src/bun/convertx.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Run the full unit suite**

Run: `bun test src/bun`
Expected: PASS — all tests from Tasks 3–6 (9 tests total).

- [ ] **Step 6: Commit**

```bash
git add src/bun/convertx.ts src/bun/convertx.test.ts
git commit -m "feat: add ConvertX child env builder and spawner"
```

---

## Task 7: `src/bun/index.ts` — supervisor entry

Wires the modules together: open the splash window, boot ConvertX, swap the webview to it (or show an error page).

**Files:**
- Create: `src/bun/index.ts`

- [ ] **Step 1: Write `src/bun/index.ts`**

```ts
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow } from "electrobun/bun";
import { buildConvertxEnv, startConvertX } from "./convertx";
import { waitForHealth } from "./health";
import { ensureDataJunction, getAppPaths } from "./paths";
import { findFreePort } from "./port";

const PROJECT_ROOT = process.env.CONVERTX_PROJECT_ROOT ?? process.cwd();
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTERS_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");

/** Read the persisted JWT secret, or generate and persist one on first run. */
function loadJwtSecret(file: string): string {
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  const secret = randomUUID();
  writeFileSync(file, secret, "utf8");
  return secret;
}

/** The converters dir plus each immediate subdir (e.g. the ImageMagick folder). */
function converterPathEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const subdirs = readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isDirectory());
  return [dir, ...subdirs];
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
  if (!existsSync(join(CONVERTX_DIR, "package.json"))) {
    throw new Error(
      `ConvertX is not vendored at:\n  ${CONVERTX_DIR}\n\n` +
        `Run the setup script first:\n  bun run scripts/setup-convertx.ts`,
    );
  }

  const paths = getAppPaths();
  ensureDataJunction(join(CONVERTX_DIR, "data"), paths.dataDir);

  const jwtSecret = loadJwtSecret(paths.jwtSecretFile);
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;

  let stderrTail = "";
  const env = buildConvertxEnv({
    port,
    jwtSecret,
    pathPrepend: converterPathEntries(CONVERTERS_DIR),
  });
  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: CONVERTX_DIR,
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
Expected: exit code 0 — Bun resolves every import (including `electrobun/bun`) and bundles `index.ts` with no errors. This is a bundle check, not a full type check; `electrobun dev` (Task 10) is the end-to-end validation.

- [ ] **Step 3: Commit**

```bash
git add src/bun/index.ts
git commit -m "feat: add supervisor that boots ConvertX behind the window"
```

---

## Task 8: `scripts/setup-convertx.ts` — vendor ConvertX

**Files:**
- Create: `scripts/setup-convertx.ts`

- [ ] **Step 1: Write `scripts/setup-convertx.ts`**

```ts
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTX_REPO = "https://github.com/C4illin/ConvertX.git";

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`> ${cmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

if (existsSync(join(CONVERTX_DIR, "package.json"))) {
  console.log(`ConvertX already vendored at ${CONVERTX_DIR} — skipping clone.`);
} else {
  run("git", ["clone", "--depth", "1", CONVERTX_REPO, CONVERTX_DIR], PROJECT_ROOT);
}

run("bun", ["install"], CONVERTX_DIR);
console.log("ConvertX is vendored and ready (unmodified).");
```

- [ ] **Step 2: Run it**

Run: `bun run scripts/setup-convertx.ts`
Expected: clones into `vendor/convertx/` and runs `bun install` there; exit code 0. `vendor/convertx/package.json` and `vendor/convertx/node_modules/` exist.

- [ ] **Step 3: Commit**

```bash
git add scripts/setup-convertx.ts
git commit -m "feat: add ConvertX vendoring script"
```

---

## Task 9: `scripts/fetch-converters.ts` — curated converter binaries

Downloads the curated converter set into `vendor/converters/win/`. GitHub-hosted tools are resolved via the GitHub releases API (self-updating); the others use stable/pinned URLs.

> **Note on URLs:** these are release-artifact locations and may drift. The script is best-effort — it reports each tool's result and exits 0 even if some fail. If a download fails, get the current URL from the tool's official releases page and update the `TOOLS` manifest. The two tools required by the smoke test are **ffmpeg** and **imagemagick**.

**Files:**
- Create: `scripts/fetch-converters.ts`

- [ ] **Step 1: Write `scripts/fetch-converters.ts`**

```ts
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const OUT_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");

interface Tool {
  name: string;
  /** github: resolve latest release asset by regex. url: fixed URL. */
  source: "github" | "url";
  repo?: string;
  url?: string;
  assetMatch?: RegExp;
  /** "exe": the download is the binary. "zip": extract and find exeName. */
  kind: "exe" | "zip";
  /** Basename to find inside an extracted zip and to write into OUT_DIR. */
  exeName: string;
  /** If set, copy the whole folder containing exeName into OUT_DIR/<dir>. */
  destSubdir?: string;
}

const TOOLS: Tool[] = [
  {
    name: "ffmpeg",
    source: "url",
    url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    kind: "zip",
    exeName: "ffmpeg.exe",
  },
  {
    name: "imagemagick",
    source: "github",
    repo: "ImageMagick/ImageMagick",
    assetMatch: /portable-Q16-x64\.zip$/i,
    kind: "zip",
    exeName: "magick.exe",
    destSubdir: "imagemagick",
  },
  {
    name: "pandoc",
    source: "github",
    repo: "jgm/pandoc",
    assetMatch: /windows-x86_64\.zip$/i,
    kind: "zip",
    exeName: "pandoc.exe",
  },
  {
    name: "dasel",
    source: "github",
    repo: "TomWright/dasel",
    assetMatch: /dasel_windows_amd64\.exe$/i,
    kind: "exe",
    exeName: "dasel.exe",
  },
  {
    name: "resvg",
    source: "github",
    repo: "linebender/resvg",
    assetMatch: /win.*64.*\.zip$/i,
    kind: "zip",
    exeName: "resvg.exe",
  },
  {
    name: "vtracer",
    source: "github",
    repo: "visioncortex/vtracer",
    assetMatch: /win.*64.*\.zip$/i,
    kind: "zip",
    exeName: "vtracer.exe",
  },
  {
    name: "potrace",
    source: "url",
    url: "https://potrace.sourceforge.net/download/1.16/potrace-1.16.win64.zip",
    kind: "zip",
    exeName: "potrace.exe",
  },
];

async function resolveGithubAsset(repo: string, match: RegExp): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { "user-agent": "convertx-electrobun-setup", accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo}`);
  const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  const asset = release.assets.find((a) => match.test(a.name));
  if (!asset) throw new Error(`No asset matching ${match} in latest ${repo} release`);
  return asset.browser_download_url;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download ${res.status} for ${url}`);
  await Bun.write(dest, await res.arrayBuffer());
}

/** Recursively find the first file named `name` under `dir`. */
function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return undefined;
}

function unzip(zipPath: string, destDir: string): void {
  // Windows 10/11 ships bsdtar as tar.exe, which extracts .zip archives.
  const result = spawnSync("tar", ["-xf", zipPath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tar failed to extract ${zipPath}`);
}

async function fetchTool(tool: Tool, tmp: string): Promise<void> {
  const url =
    tool.source === "github"
      ? await resolveGithubAsset(tool.repo!, tool.assetMatch!)
      : tool.url!;
  console.log(`  ${tool.name}: ${url}`);

  if (tool.kind === "exe") {
    await download(url, join(OUT_DIR, tool.exeName));
    return;
  }

  const zipPath = join(tmp, `${tool.name}.zip`);
  await download(url, zipPath);
  const extractDir = join(tmp, tool.name);
  mkdirSync(extractDir, { recursive: true });
  unzip(zipPath, extractDir);

  const exePath = findFile(extractDir, tool.exeName);
  if (!exePath) throw new Error(`${tool.exeName} not found in ${tool.name} archive`);

  if (tool.destSubdir) {
    const dest = join(OUT_DIR, tool.destSubdir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(dirname(exePath), dest, { recursive: true });
  } else {
    await Bun.write(join(OUT_DIR, tool.exeName), Bun.file(exePath));
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "cx-converters-"));
  const results: { name: string; ok: boolean; detail: string }[] = [];

  for (const tool of TOOLS) {
    console.log(`Fetching ${tool.name}…`);
    try {
      await fetchTool(tool, tmp);
      results.push({ name: tool.name, ok: true, detail: "ok" });
    } catch (err) {
      results.push({
        name: tool.name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  rmSync(tmp, { recursive: true, force: true });

  console.log("\n=== Converter download summary ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.name}${r.ok ? "" : " — " + r.detail}`);
  }
  const haveFfmpeg = existsSync(join(OUT_DIR, "ffmpeg.exe"));
  const haveMagick = existsSync(join(OUT_DIR, "imagemagick", "magick.exe"));
  if (!haveFfmpeg || !haveMagick) {
    console.log(
      "\nWARNING: ffmpeg and/or ImageMagick are missing. The smoke test needs them.\n" +
        "Download them manually into vendor/converters/win/ if their URLs have moved:\n" +
        "  ffmpeg.exe                -> vendor/converters/win/ffmpeg.exe\n" +
        "  ImageMagick portable dir  -> vendor/converters/win/imagemagick/ (contains magick.exe)",
    );
  }
}

main();
```

- [ ] **Step 2: Run it**

Run: `bun run scripts/fetch-converters.ts`
Expected: prints a per-tool summary. `vendor/converters/win/ffmpeg.exe` and `vendor/converters/win/imagemagick/magick.exe` exist. If the summary reports either of those as FAIL, follow the printed instructions to place them manually before continuing.

- [ ] **Step 3: Verify the two critical binaries run**

Run: `.\vendor\converters\win\ffmpeg.exe -version`
Expected: prints an ffmpeg version banner.

Run: `.\vendor\converters\win\imagemagick\magick.exe -version`
Expected: prints an ImageMagick version banner.

- [ ] **Step 4: Commit**

```bash
git add scripts/fetch-converters.ts
git commit -m "feat: add curated converter download script"
```

---

## Task 10: `scripts/smoke.ts` + end-to-end verification

A headless check that boots ConvertX through the supervisor's modules and converts a real file over HTTP — proving the env wiring, the converter `PATH`, and the no-login mode all work.

**Files:**
- Create: `scripts/smoke.ts`

- [ ] **Step 1: Write `scripts/smoke.ts`**

```ts
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildConvertxEnv, startConvertX } from "../src/bun/convertx";
import { waitForHealth } from "../src/bun/health";
import { ensureDataJunction, getAppPaths } from "../src/bun/paths";
import { findFreePort } from "../src/bun/port";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTERS_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");

// A minimal valid 1x1 PNG.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function converterPathEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const subdirs = readdirSync(dir)
    .map((e) => join(dir, e))
    .filter((p) => statSync(p).isDirectory());
  return [dir, ...subdirs];
}

/** Parse a cookie value out of a set-cookie header list. */
function cookieValue(setCookies: string[], name: string): string {
  for (const sc of setCookies) {
    const match = sc.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return match[1]!;
  }
  throw new Error(`Cookie '${name}' was not set by ConvertX`);
}

async function main(): Promise<void> {
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

  try {
    await waitForHealth(`${base}/`, 45_000);

    // 1. GET / -> ConvertX mints the auth + jobId cookies (no login screen).
    const root = await fetch(`${base}/`, { redirect: "manual" });
    if (root.status !== 200) {
      throw new Error(`GET / returned ${root.status}, expected 200 (no-login mode)`);
    }
    const setCookies = root.headers.getSetCookie();
    const auth = cookieValue(setCookies, "auth");
    const jobId = cookieValue(setCookies, "jobId");
    const cookie = `auth=${auth}; jobId=${jobId}`;
    console.log(`Session established (jobId=${jobId}).`);

    // 2. POST /upload — send a 1x1 PNG.
    const png = Buffer.from(PNG_1X1_BASE64, "base64");
    const uploadForm = new FormData();
    uploadForm.append("file", new File([png], "test.png", { type: "image/png" }));
    const upload = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { cookie },
      body: uploadForm,
    });
    if (!upload.ok) throw new Error(`POST /upload returned ${upload.status}`);
    console.log("Uploaded test.png.");

    // 3. POST /convert — PNG -> JPG via ImageMagick (runs in the background).
    const convertForm = new FormData();
    convertForm.append("convert_to", "jpg,imagemagick");
    convertForm.append("file_names", JSON.stringify(["test.png"]));
    const convert = await fetch(`${base}/convert`, {
      method: "POST",
      headers: { cookie },
      body: convertForm,
      redirect: "manual",
    });
    if (convert.status !== 302) {
      throw new Error(`POST /convert returned ${convert.status}, expected 302`);
    }
    console.log("Conversion requested.");

    // 4. Poll the output directory (UNAUTHENTICATED_USER_SHARING -> user id 0).
    //    Match any non-empty file — ConvertX may name it test.jpg or test.jpeg.
    const outDir = join(paths.dataDir, "output", "0", jobId);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (existsSync(outDir)) {
        const produced = readdirSync(outDir).filter((name) => {
          const s = statSync(join(outDir, name));
          return s.isFile() && s.size > 0;
        });
        if (produced.length > 0) {
          console.log(`\nSMOKE TEST PASSED — produced ${join(outDir, produced[0]!)}`);
          return;
        }
      }
      await Bun.sleep(300);
    }
    throw new Error(`Timed out waiting for output in: ${outDir}`);
  } finally {
    proc.stop();
  }
}

main().catch((err) => {
  console.error(`\nSMOKE TEST FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
```

- [ ] **Step 2: Run the unit suite**

Run: `bun test src/bun`
Expected: PASS — all 9 tests.

- [ ] **Step 3: Run the smoke test**

Run: `bun run scripts/smoke.ts`
Expected: prints `SMOKE TEST PASSED — produced …test.jpg` and exits 0. (This proves: ConvertX boots under the supervisor env, the no-login mode works, the bundled ImageMagick on `PATH` performs a real conversion, and output lands in the app-data dir.)

- [ ] **Step 4: Launch the desktop app**

Run: `bun run dev`
Expected: on first run Electrobun downloads its ~50 MB `win-x64` core, then a native window opens. The splash shows briefly, then the window loads ConvertX's converter UI — **no login screen**.

- [ ] **Step 5: Manual conversion check in the window**

In the open window: drag an image file onto the dropzone, pick a target format (e.g. JPG, or MP4→GIF with a small video), click **Convert**, and confirm the results page shows a finished file you can download.

- [ ] **Step 6: Verify clean shutdown**

Close the window. In a terminal run: `tasklist | findstr bun`
Expected: no leftover ConvertX `bun` process from the app (the supervisor killed the child on exit).

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke.ts
git commit -m "feat: add headless end-to-end smoke test"
```

---

## Definition of Done

All ticked: the spec's §13 is satisfied —

1. `bun install` + `setup-convertx.ts` + `fetch-converters.ts` populate `vendor/` (ffmpeg + ImageMagick present — Task 9).
2. `bun test src/bun` passes — 9 tests (Task 10 Step 2).
3. `bun run dev` opens a native window straight into ConvertX's converter UI, no login (Task 10 Step 4).
4. `scripts/smoke.ts` performs a real PNG→JPG conversion against the supervised instance (Task 10 Step 3); a manual conversion in the window confirms the GUI path (Step 5).
5. Closing the window leaves no orphaned ConvertX process (Task 10 Step 6).

## Notes for the Implementer

- **ConvertX is never modified.** It is a vendored clone configured entirely through environment variables. If a task tempts you to edit `vendor/convertx/`, stop — re-check the spec.
- **Project root resolution:** the supervisor reads `process.env.CONVERTX_PROJECT_ROOT` (injected by `electrobun.config.ts`'s `build.bun.define`) and falls back to `process.cwd()`. If `vendor/` is not found at runtime, verify the `define` was applied or run `bun run dev` from the project root.
- **`tar` for unzip:** `fetch-converters.ts` relies on Windows' built-in `tar.exe` to extract `.zip` archives (Windows 10 1803+).
- **Network:** Tasks 1, 8, 9, and 10 Step 4 require internet access.
