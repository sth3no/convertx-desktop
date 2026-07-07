# Backend Engine + Local API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-07-backend-engine-api-design.md`: updater engine (GitHub Releases → verified download → silent reinstall), pack engine (pinned registry → app-data install → PATH rewire → child restart), settings store, all behind the control server as a CORS-enabled JSON API discoverable via `window.__convertxDesktop`, documented in `docs/API.md`.

**Architecture:** Shared helpers move to `src/shared/` (checksums, archive) so runtime engines and build scripts use one implementation. `control.ts` becomes a thin authenticated router (`RouteResult` handlers). Engines (`updater.ts`, `packs.ts`, `settings.ts`) have injectable IO and are unit-tested against local `Bun.serve` fixtures. `index.ts` wires everything; UI is explicitly not built.

**Tech Stack:** Bun 1.3.14, existing Phase 1 control server/logger/restart machinery, system bsdtar for archives, GitHub Releases API.

---

### Task 1: Move checksums to src/shared (runtime + scripts share one impl)

**Files:**
- Create: `src/shared/checksums.ts` (content moved from `scripts/lib/checksums.ts`)
- Modify: `scripts/lib/checksums.ts` (becomes a re-export)

- [ ] **Step 1:** Create `src/shared/checksums.ts` with the exact current content of `scripts/lib/checksums.ts` (the `sha256OfBytes`/`sha256OfFile` functions).

- [ ] **Step 2:** Replace `scripts/lib/checksums.ts` content with:

```typescript
// Moved to src/shared so runtime engines can use it too; scripts keep this path.
export { sha256OfBytes, sha256OfFile } from "../../src/shared/checksums";
```

- [ ] **Step 3:** Run `bun run test` (all pass, incl. `scripts/lib/checksums.test.ts` through the re-export) and `bun x tsc --noEmit`. Commit:

```powershell
git add src/shared/checksums.ts scripts/lib/checksums.ts
git commit -m @'
refactor: move sha256 helpers to src/shared for runtime use

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Shared archive helpers (extract + find)

**Files:**
- Create: `src/shared/archive.ts`
- Test: `src/shared/archive.test.ts`
- Modify: `scripts/fetch-converters.ts` (import instead of local copies)

- [ ] **Step 1: Failing test** — `src/shared/archive.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractArchive, findFile } from "./archive";

function makeZip(): { zip: string; base: string } {
  const base = mkdtempSync(join(tmpdir(), "cx-arch-"));
  const content = join(base, "content", "nested");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "tool.exe"), "fake exe");
  const zip = join(base, "archive.zip");
  // System bsdtar creates zips too (-a infers format from the extension).
  const result = spawnSync(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
    ["-a", "-cf", zip, "-C", join(base, "content"), "."],
  );
  expect(result.status).toBe(0);
  return { zip, base };
}

test("extractArchive unpacks and findFile locates files case-insensitively", () => {
  const { zip, base } = makeZip();
  const dest = join(base, "out");
  mkdirSync(dest, { recursive: true });
  extractArchive(zip, dest);
  const hit = findFile(dest, "TOOL.EXE");
  expect(hit).toBeDefined();
  expect(hit!.toLowerCase().endsWith("tool.exe")).toBe(true);
});

test("extractArchive throws on a non-archive", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-archbad-"));
  const bogus = join(base, "not.zip");
  writeFileSync(bogus, "hello");
  expect(() => extractArchive(bogus, base)).toThrow(/extract/);
});
```

- [ ] **Step 2:** Run `bun test src/shared/archive.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement** — `src/shared/archive.ts` (logic lifted from `scripts/fetch-converters.ts`):

```typescript
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Extract a .zip or .7z with the system bsdtar (libarchive) — present in
 * System32 on Windows 10/11. A bare "tar" may resolve to Git-for-Windows'
 * GNU tar, which cannot read zip/7z, hence the absolute path.
 */
export function extractArchive(archivePath: string, destDir: string): void {
  const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const tar = existsSync(systemTar) ? systemTar : "tar";
  const result = spawnSync(tar, ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tar failed to extract ${archivePath}`);
}

/** Recursively find the first file named `name` (case-insensitive) under `dir`. */
export function findFile(dir: string, name: string): string | undefined {
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
```

- [ ] **Step 4:** In `scripts/fetch-converters.ts`: delete its local `findFile` and `unzip` functions; add `import { extractArchive, findFile } from "../src/shared/archive";`; replace the one `unzip(downloadPath, extractDir)` call in `install()` with `extractArchive(downloadPath, extractDir)`.

- [ ] **Step 5:** `bun test src/shared/archive.test.ts` (2 pass), `bun x tsc --noEmit`, `bun run test` (all pass). Commit:

```powershell
git add src/shared/archive.ts src/shared/archive.test.ts scripts/fetch-converters.ts
git commit -m @'
refactor: shared archive extraction helpers for runtime and scripts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: App paths for settings, updates, packs

**Files:**
- Modify: `src/bun/paths.ts`, `src/bun/paths.test.ts`

- [ ] **Step 1:** Extend the test (after the `windowStateFile` expectation):

```typescript
  expect(paths.settingsFile).toBe(join(base, "ConvertX-Electrobun", "settings.json"));
  expect(paths.updatesDir).toBe(join(base, "ConvertX-Electrobun", "updates"));
  expect(paths.packsDir).toBe(join(base, "ConvertX-Electrobun", "packs"));
```

- [ ] **Step 2:** Run `bun test src/bun/paths.test.ts` — FAIL. Then add to `AppPaths`:

```typescript
  /** Persisted user settings (src/bun/settings.ts). */
  settingsFile: string;
  /** Downloaded update installers (src/bun/updater.ts). */
  updatesDir: string;
  /** Installed optional converter packs (src/bun/packs.ts). */
  packsDir: string;
```

and to the returned object:

```typescript
    settingsFile: join(appDataDir, "settings.json"),
    updatesDir: join(appDataDir, "updates"),
    packsDir: join(appDataDir, "packs"),
```

- [ ] **Step 3:** Test passes; commit:

```powershell
git add src/bun/paths.ts src/bun/paths.test.ts
git commit -m @'
feat: app paths for settings, updates, and packs

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Settings store

**Files:**
- Create: `src/bun/settings.ts`
- Test: `src/bun/settings.test.ts`

- [ ] **Step 1: Failing test** — `src/bun/settings.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, loadSettingsFile, saveSettings, sanitizeSettings } from "./settings";

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "cx-settings-")), "settings.json");
}

test("missing file -> defaults, fromFile false; save/load round-trips", () => {
  const file = tempFile();
  const first = loadSettingsFile(file);
  expect(first.fromFile).toBe(false);
  expect(first.settings).toEqual(DEFAULT_SETTINGS);

  saveSettings(file, { autoDeleteHours: 72, updateMode: "notify" });
  const second = loadSettingsFile(file);
  expect(second.fromFile).toBe(true);
  expect(second.settings).toEqual({ autoDeleteHours: 72, updateMode: "notify" });
});

test("corrupt or invalid files fall back to defaults per field", () => {
  const file = tempFile();
  writeFileSync(file, "{nope");
  expect(loadSettingsFile(file)).toEqual({ settings: DEFAULT_SETTINGS, fromFile: false });

  writeFileSync(file, JSON.stringify({ autoDeleteHours: -5, updateMode: "yolo" }));
  const loaded = loadSettingsFile(file);
  expect(loaded.fromFile).toBe(true);
  expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
});

test("sanitizeSettings accepts partial updates and rejects bad values", () => {
  expect(sanitizeSettings({ autoDeleteHours: 0 })).toEqual({ autoDeleteHours: 0 });
  expect(sanitizeSettings({ updateMode: "notify" })).toEqual({ updateMode: "notify" });
  expect(sanitizeSettings({ autoDeleteHours: "week", updateMode: 3, junk: true })).toEqual({});
});
```

- [ ] **Step 2:** FAIL run, then implement `src/bun/settings.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";

export interface Settings {
  /** AUTO_DELETE_EVERY_N_HOURS for the ConvertX child; 0 disables cleanup. */
  autoDeleteHours: number;
  /** "auto": auto-download + install-on-quit. "notify": frontend drives it. */
  updateMode: "auto" | "notify";
}

export const DEFAULT_SETTINGS: Settings = { autoDeleteHours: 168, updateMode: "auto" };

/** Keep only valid fields from an unknown partial (API input, file content). */
export function sanitizeSettings(value: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof value !== "object" || value === null) return out;
  const raw = value as Record<string, unknown>;
  if (typeof raw.autoDeleteHours === "number" && raw.autoDeleteHours >= 0 && Number.isFinite(raw.autoDeleteHours)) {
    out.autoDeleteHours = raw.autoDeleteHours;
  }
  if (raw.updateMode === "auto" || raw.updateMode === "notify") {
    out.updateMode = raw.updateMode;
  }
  return out;
}

export function loadSettingsFile(file: string): { settings: Settings; fromFile: boolean } {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return { settings: { ...DEFAULT_SETTINGS, ...sanitizeSettings(parsed) }, fromFile: true };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
```

- [ ] **Step 3:** 3 tests pass; commit:

```powershell
git add src/bun/settings.ts src/bun/settings.test.ts
git commit -m @'
feat: persisted settings store (retention, update mode)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Control server → authenticated JSON router with CORS

**Files:**
- Modify: `src/bun/control.ts` (rework), `src/bun/control.test.ts` (extend), `src/bun/instance.test.ts` (constructor call shape)

- [ ] **Step 1: Extend tests.** In `src/bun/control.test.ts`, change every `startControlServer(handlers)` call to `startControlServer({ handlers })`. Append:

```typescript
test("routes dispatch, JSON bodies parse, errors map to JSON, CORS headers set", async () => {
  const { handlers } = calls();
  server = startControlServer({
    handlers,
    getCorsOrigin: () => "http://127.0.0.1:17843",
    routes: [
      { method: "GET", path: "/echo", handler: (req) => ({ body: { q: req.query.get("x") } }) },
      {
        method: "POST",
        path: "/double",
        handler: async (req) => {
          const body = (await req.json()) as { n?: number };
          if (typeof body.n !== "number") return { status: 400, body: { error: "n required" } };
          return { body: { doubled: body.n * 2 } };
        },
      },
      { method: "GET", path: "/boom", handler: () => { throw new Error("kaboom"); } },
    ],
  });
  const base = `http://127.0.0.1:${server.port}`;
  const t = `token=${server.token}`;

  const echo = await fetch(`${base}/echo?${t}&x=hi`);
  expect(echo.status).toBe(200);
  expect(echo.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:17843");
  expect(await echo.json()).toEqual({ q: "hi" });

  const doubled = await fetch(`${base}/double?${t}`, {
    method: "POST",
    body: JSON.stringify({ n: 21 }),
  });
  expect(await doubled.json()).toEqual({ doubled: 42 });
  expect((await fetch(`${base}/double?${t}`, { method: "POST", body: "junk" })).status).toBe(400);

  const boom = await fetch(`${base}/boom?${t}`);
  expect(boom.status).toBe(500);
  expect(((await boom.json()) as { error: string }).error).toContain("kaboom");

  const preflight = await fetch(`${base}/echo`, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
});
```

- [ ] **Step 2:** FAIL run (constructor shape), then rework `src/bun/control.ts`:

```typescript
import { randomUUID } from "node:crypto";

export const CONTROL_APP_ID = "convertx-desktop";

export interface ControlHandlers {
  onFocus: () => void;
  onRestart: () => void;
  onOpenExternal: (url: string) => void;
}

export interface RouteRequest {
  query: URLSearchParams;
  /** Parses the JSON body; returns {} for an empty or invalid body. */
  json: () => Promise<unknown>;
}

export interface RouteResult {
  status?: number;
  body: unknown;
}

export interface Route {
  method: "GET" | "POST";
  path: string;
  handler: (req: RouteRequest) => RouteResult | Promise<RouteResult>;
}

export interface ControlServerOptions {
  handlers: ControlHandlers;
  /** Engine endpoints (update/packs/settings/info/...). */
  routes?: Route[];
  /** The webview app origin, once known — enables readable CORS responses. */
  getCorsOrigin?: () => string;
}

export interface ControlServer {
  port: number;
  token: string;
  stop: () => void;
}

/**
 * Loopback control server — the app's local JSON API. Token-authed (query
 * param, per-run random), CORS-enabled for the ConvertX webview origin so a
 * frontend running there can read responses. Built-in endpoints (/ping,
 * /focus, /restart, /open-external) keep their Phase 1 shapes; engines add
 * routes. Documented for frontend use in docs/API.md.
 */
export function startControlServer(options: ControlServerOptions): ControlServer {
  const { handlers, routes = [], getCorsOrigin } = options;
  const token = randomUUID();

  const corsHeaders = (): Record<string, string> => {
    const origin = getCorsOrigin?.() ?? "";
    return origin
      ? { "access-control-allow-origin": origin, vary: "Origin" }
      : {};
  };
  const json = (body: unknown, status = 200): Response =>
    Response.json(body, { status, headers: corsHeaders() });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(),
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
      }
      if (url.searchParams.get("token") !== token) {
        return json({ error: "forbidden" }, 403);
      }

      // Built-in endpoints (shapes relied on by instance.ts and the injected
      // link interceptor — do not change).
      if (url.pathname === "/ping" && req.method === "GET") {
        return json({ app: CONTROL_APP_ID, pid: process.pid });
      }
      if (url.pathname === "/focus" && req.method === "POST") {
        handlers.onFocus();
        return json({ ok: true });
      }
      if (url.pathname === "/restart" && req.method === "POST") {
        handlers.onRestart();
        return json({ ok: true });
      }
      if (url.pathname === "/open-external" && req.method === "POST") {
        const target = url.searchParams.get("url") ?? "";
        if (!/^(https?:\/\/|mailto:)/i.test(target)) {
          return json({ error: "bad url" }, 400);
        }
        handlers.onOpenExternal(target);
        return json({ ok: true });
      }

      const route = routes.find((r) => r.path === url.pathname && r.method === req.method);
      if (!route) return json({ error: "not found" }, 404);
      try {
        const result = await route.handler({
          query: url.searchParams,
          json: async () => {
            try {
              return await req.json();
            } catch {
              return {};
            }
          },
        });
        return json(result.body, result.status ?? 200);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    },
  });
  const port = server.port;
  if (port === undefined) {
    server.stop(true);
    throw new Error("control server bound without a TCP port");
  }
  return { port, token, stop: () => server.stop(true) };
}
```

- [ ] **Step 3:** In `src/bun/instance.test.ts` change the one `startControlServer({...handlers...})` call to `startControlServer({ handlers: { onFocus: ..., onRestart: ..., onOpenExternal: ... } })` (wrap the existing object literal in `{ handlers: ... }`).

Note: the old error-shape tests asserted plain-text bodies ("forbidden", "bad url", "not found"); they now come back as JSON — update those three assertions to check `.status` only (they already do) — no text assertions exist, so no further changes.

- [ ] **Step 4:** `bun run test` all green; `bun x tsc --noEmit` clean (index.ts still uses the old call shape — fix now: in `src/bun/index.ts` change `startControlServer({ onFocus..., onRestart..., onOpenExternal... })` to `startControlServer({ handlers: { ... } })` — the full rewiring comes in Task 9). Commit:

```powershell
git add src/bun/control.ts src/bun/control.test.ts src/bun/instance.test.ts src/bun/index.ts
git commit -m @'
feat: control server becomes an authenticated JSON router with CORS

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Updater engine

**Files:**
- Create: `src/bun/updater.ts`
- Test: `src/bun/updater.test.ts`

- [ ] **Step 1: Failing test** — `src/bun/updater.test.ts`:

```typescript
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256OfBytes } from "../shared/checksums";
import { createUpdater, isNewerVersion } from "./updater";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

test("isNewerVersion compares numerically", () => {
  expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
  expect(isNewerVersion("1.10.0", "1.9.9")).toBe(true);
  expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  expect(isNewerVersion("2.0", "1.9.9")).toBe(true);
});

function fixture(installerBytes: Uint8Array, opts?: { badSum?: boolean; version?: string }) {
  const version = opts?.version ?? "9.9.9";
  const name = `ConvertX-Desktop-${version}-Setup.exe`;
  const sum = opts?.badSum ? "0".repeat(64) : sha256OfBytes(installerBytes);
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/repos/o/r/releases/latest") {
        const base = `http://127.0.0.1:${server!.port}`;
        return Response.json({
          tag_name: `v${version}`,
          published_at: "2026-07-07T00:00:00Z",
          html_url: "https://example.com/release",
          assets: [
            { name, browser_download_url: `${base}/dl/${name}`, size: installerBytes.length },
            { name: "SHA256SUMS.txt", browser_download_url: `${base}/dl/sums`, size: 100 },
          ],
        });
      }
      if (path === `/dl/${name}`) return new Response(installerBytes);
      if (path === "/dl/sums") return new Response(`${sum}  ${name}\n`);
      return new Response("nope", { status: 404 });
    },
  });
  return { apiBase: `http://127.0.0.1:${server.port}`, version, name };
}

function makeUpdater(apiBase: string, extra?: { spawned?: string[]; quits?: number[] }) {
  const updatesDir = mkdtempSync(join(tmpdir(), "cx-upd-"));
  return createUpdater({
    currentVersion: "1.0.0",
    repo: "o/r",
    updatesDir,
    installedLauncher: "C:\\fake\\launcher.exe",
    log: () => {},
    apiBase,
    spawnDetached: (cmd) => extra?.spawned?.push(cmd),
    quitApp: () => extra?.quits?.push(1),
  });
}

test("check -> update-available -> download+verify -> ready -> apply spawns and quits", async () => {
  const bytes = new TextEncoder().encode("fake installer bytes");
  const { apiBase, version, name } = fixture(bytes);
  const spawned: string[] = [];
  const quits: number[] = [];
  const updater = makeUpdater(apiBase, { spawned, quits });

  expect(updater.status().state).toBe("idle");
  const afterCheck = await updater.check();
  expect(afterCheck.state).toBe("update-available");
  if (afterCheck.state === "update-available") expect(afterCheck.version).toBe(version);

  const afterDownload = await updater.download();
  expect(afterDownload.state).toBe("ready");

  const applied = await updater.apply();
  expect(applied.ok).toBe(true);
  expect(quits).toHaveLength(1);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]).toContain(name);
  expect(spawned[0]).toContain("/VERYSILENT");
  expect(spawned[0]).toContain("launcher.exe");
});

test("up-to-date when the release is not newer", async () => {
  const { apiBase } = fixture(new Uint8Array(8), { version: "1.0.0" });
  const updater = makeUpdater(apiBase);
  expect((await updater.check()).state).toBe("up-to-date");
});

test("hash mismatch -> error, never ready", async () => {
  const { apiBase } = fixture(new TextEncoder().encode("evil"), { badSum: true });
  const updater = makeUpdater(apiBase);
  await updater.check();
  const result = await updater.download();
  expect(result.state).toBe("error");
  expect((await updater.apply()).ok).toBe(false);
});

test("API failure -> error state, check can be retried", async () => {
  const updater = makeUpdater("http://127.0.0.1:1");
  expect((await updater.check()).state).toBe("error");
});

test("apply is rejected unless ready; download rejected unless update-available", async () => {
  const { apiBase } = fixture(new Uint8Array(8), { version: "1.0.0" });
  const updater = makeUpdater(apiBase);
  expect((await updater.apply()).ok).toBe(false);
  expect((await updater.download()).state).toBe("error");
});
```

- [ ] **Step 2:** FAIL run, then implement `src/bun/updater.ts`:

```typescript
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sha256OfFile } from "../shared/checksums";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | {
      state: "update-available";
      version: string;
      publishedAt: string;
      notesUrl: string;
      sizeBytes: number;
      checkedAt: number;
    }
  | { state: "downloading"; version: string; received: number; total: number }
  | { state: "verifying"; version: string }
  | { state: "ready"; version: string; installerPath: string }
  | { state: "installing"; version: string }
  | { state: "error"; message: string; at: string };

export interface UpdaterDeps {
  currentVersion: string;
  /** "owner/repo" on github.com. */
  repo: string;
  updatesDir: string;
  /** Path the relaunch step starts after an explicit apply(). */
  installedLauncher: string;
  log: (message: string) => void;
  /** Test seams. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
  spawnDetached?: (cmdLine: string) => void;
  quitApp?: () => void;
}

/** Numeric segment-wise version compare: is `a` newer than `b`? */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  notesUrl: string;
  installerUrl: string;
  installerName: string;
  sumsUrl: string;
  sizeBytes: number;
}

/**
 * Update engine: GitHub Releases -> verified download -> silent reinstall.
 * All transitions land in a status snapshot the API serves; nothing throws
 * across the boundary (spec §8). The relaunch trick: `cmd /c "A & start B"`
 * runs B only after the installer A exits.
 */
export function createUpdater(deps: UpdaterDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiBase = deps.apiBase ?? "https://api.github.com";
  const spawnDetached =
    deps.spawnDetached ??
    ((cmdLine: string) => {
      const child = spawn("cmd", ["/c", cmdLine], { detached: true, stdio: "ignore" });
      child.unref();
    });
  const quitApp = deps.quitApp ?? (() => process.exit(0));

  let status: UpdateStatus = { state: "idle" };
  let release: ReleaseInfo | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const fail = (message: string, at: string): UpdateStatus => {
    deps.log(`updater error (${at}): ${message}`);
    status = { state: "error", message, at };
    return status;
  };

  function cleanUpdatesDir(): void {
    try {
      mkdirSync(deps.updatesDir, { recursive: true });
      for (const entry of readdirSync(deps.updatesDir)) {
        rmSync(join(deps.updatesDir, entry), { recursive: true, force: true });
      }
    } catch {
      // stale files are cosmetic
    }
  }

  async function check(): Promise<UpdateStatus> {
    if (status.state === "downloading" || status.state === "installing") return status;
    status = { state: "checking" };
    try {
      const res = await fetchImpl(`${apiBase}/repos/${deps.repo}/releases/latest`, {
        headers: { "user-agent": "convertx-desktop", accept: "application/vnd.github+json" },
      });
      if (!res.ok) return fail(`GitHub API ${res.status}`, "check");
      const data = (await res.json()) as {
        tag_name: string;
        published_at: string;
        html_url: string;
        assets: { name: string; browser_download_url: string; size: number }[];
      };
      const version = data.tag_name.replace(/^v/, "");
      if (!isNewerVersion(version, deps.currentVersion)) {
        status = { state: "up-to-date", checkedAt: Date.now() };
        return status;
      }
      const installerName = `ConvertX-Desktop-${version}-Setup.exe`;
      const installer = data.assets.find((a) => a.name === installerName);
      const sums = data.assets.find((a) => a.name === "SHA256SUMS.txt");
      if (!installer || !sums) return fail("release is missing installer or SHA256SUMS.txt", "check");
      release = {
        version,
        publishedAt: data.published_at,
        notesUrl: data.html_url,
        installerUrl: installer.browser_download_url,
        installerName,
        sumsUrl: sums.browser_download_url,
        sizeBytes: installer.size,
      };
      status = {
        state: "update-available",
        version,
        publishedAt: release.publishedAt,
        notesUrl: release.notesUrl,
        sizeBytes: release.sizeBytes,
        checkedAt: Date.now(),
      };
      return status;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), "check");
    }
  }

  async function download(): Promise<UpdateStatus> {
    if (status.state === "ready") return status;
    if (status.state !== "update-available" || !release) {
      return fail("no update available to download", "download");
    }
    const info = release;
    cleanUpdatesDir();
    const dest = join(deps.updatesDir, info.installerName);
    status = { state: "downloading", version: info.version, received: 0, total: info.sizeBytes };
    try {
      const sumsRes = await fetchImpl(info.sumsUrl);
      if (!sumsRes.ok) return fail(`sums download ${sumsRes.status}`, "download");
      const sumsText = await sumsRes.text();
      const line = sumsText.split("\n").find((l) => l.includes(info.installerName));
      const expected = line?.trim().split(/\s+/)[0];
      if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
        return fail("installer hash not found in SHA256SUMS.txt", "download");
      }

      const res = await fetchImpl(info.installerUrl);
      if (!res.ok || !res.body) return fail(`installer download ${res.status}`, "download");
      const total = Number(res.headers.get("content-length")) || info.sizeBytes;
      const writer = Bun.file(dest).writer();
      let received = 0;
      for await (const chunk of res.body) {
        writer.write(chunk);
        received += chunk.byteLength;
        status = { state: "downloading", version: info.version, received, total };
      }
      await writer.end();

      status = { state: "verifying", version: info.version };
      const actual = await sha256OfFile(dest);
      if (actual !== expected) {
        rmSync(dest, { force: true });
        return fail("installer hash mismatch — download discarded", "verify");
      }
      status = { state: "ready", version: info.version, installerPath: dest };
      deps.log(`update ${info.version} downloaded and verified`);
      return status;
    } catch (err) {
      rmSync(dest, { force: true });
      return fail(err instanceof Error ? err.message : String(err), "download");
    }
  }

  /** Spawn the verified installer (optionally relaunching after). */
  function spawnInstaller(relaunch: boolean): boolean {
    if (status.state !== "ready") return false;
    const installer = status.installerPath;
    const silent = `"${installer}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`;
    const cmdLine = relaunch ? `${silent} & start "" "${deps.installedLauncher}"` : silent;
    deps.log(`applying update: ${cmdLine}`);
    status = { state: "installing", version: status.version };
    spawnDetached(cmdLine);
    return true;
  }

  return {
    status: () => status,
    check,
    download,
    /** Explicit apply: install + relaunch + quit. */
    async apply(): Promise<{ ok: boolean; error?: string }> {
      if (status.state !== "ready") {
        return { ok: false, error: `not ready (state: ${status.state})` };
      }
      spawnInstaller(true);
      quitApp();
      return { ok: true };
    },
    /** Quit path: install without relaunch (the user chose to close the app). */
    applyOnQuit(): boolean {
      return spawnInstaller(false);
    },
    hasReadyUpdate: () => status.state === "ready",
    /** Boot: clean stale downloads, check now, then daily; auto-download per mode. */
    start(getMode: () => "auto" | "notify", intervalMs = 24 * 3600_000): void {
      cleanUpdatesDir();
      const cycle = async () => {
        const result = await check();
        if (result.state === "update-available" && getMode() === "auto") await download();
      };
      void cycle();
      timer = setInterval(() => void cycle(), intervalMs);
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
```

- [ ] **Step 3:** `bun test src/bun/updater.test.ts` — 5 pass (note: the state-guard test expects `download()` without a prior available update to return `error`; matches the implementation). `bun x tsc --noEmit` clean. Commit:

```powershell
git add src/bun/updater.ts src/bun/updater.test.ts
git commit -m @'
feat: update engine (check, verified download, silent reinstall)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Pack registry + pack engine

**Files:**
- Create: `src/bun/pack-registry.ts` (entries recorded from live releases during this task)
- Create: `src/bun/packs.ts`
- Test: `src/bun/packs.test.ts`

- [ ] **Step 1: Record real pack pins.** Resolve current release assets and hash them (network):

```bash
# libvips: asset named like vips-dev-w64-web-8.x.y.zip
gh api repos/libvips/libvips/releases/latest --jq '.tag_name, (.assets[] | select(.name | test("dev-w64-web.*zip$")) | .browser_download_url, .size)'
# libjxl: asset jxl-x64-windows-static.zip
gh api repos/libjxl/libjxl/releases/latest --jq '.tag_name, (.assets[] | select(.name | test("x64-windows-static")) | .browser_download_url, .size)'
# download each and sha256sum them
curl -L -o /tmp/vips.zip <url> && sha256sum /tmp/vips.zip
curl -L -o /tmp/jxl.zip <url> && sha256sum /tmp/jxl.zip
# confirm the exe locations inside:
tar -tf /tmp/vips.zip | grep -i "bin/vips.exe"
tar -tf /tmp/jxl.zip | grep -i "cjxl.exe"
```

Fill `src/bun/pack-registry.ts` with the recorded values:

```typescript
export interface PackDef {
  name: string;
  title: string;
  description: string;
  version: string;
  /** Exact download URL the sha256 was recorded from. */
  url: string;
  sha256: string;
  sizeBytes: number;
  /** Archive extractable by system bsdtar (zip/7z). */
  kind: "zip";
  /** File that must exist after extraction; its dir joins the child PATH. */
  exeName: string;
  /** What the pack unlocks, for frontend display. */
  unlocks: string;
}

/**
 * Optional converter packs — pinned URL + sha256, the same supply-chain
 * discipline as scripts/converter-manifest.json. Adding heavier packs later
 * (LibreOffice, Calibre — no official portable archives today) is a pure
 * data change here plus a hash recording; see docs/API.md "Adding packs".
 */
export const PACK_REGISTRY: PackDef[] = [
  {
    name: "vips",
    title: "libvips (fast image processing)",
    description: "High-speed image conversion and resizing for large images.",
    version: "<recorded>",
    url: "<recorded>",
    sha256: "<recorded>",
    sizeBytes: 0, // recorded
    kind: "zip",
    exeName: "vips.exe",
    unlocks: "45 additional input formats via the vips backend",
  },
  {
    name: "libjxl",
    title: "JPEG XL tools",
    description: "Encode and decode JPEG XL (.jxl) images.",
    version: "<recorded>",
    url: "<recorded>",
    sha256: "<recorded>",
    sizeBytes: 0, // recorded
    kind: "zip",
    exeName: "cjxl.exe",
    unlocks: "JPEG XL encode/decode (cjxl, djxl)",
  },
];
```

(The `<recorded>` placeholders are filled with the actual values in this step — they never reach a commit. Also probe Inkscape's 7z archive URL once; include a third entry only if the URL downloads and extracts cleanly with bsdtar.)

- [ ] **Step 2: Failing test** — `src/bun/packs.test.ts` (uses a real zip served locally; exercises bsdtar):

```typescript
import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256OfFile } from "../shared/checksums";
import type { PackDef } from "./pack-registry";
import { createPackManager } from "./packs";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

async function fixture(): Promise<{ def: PackDef; packsDir: string; restarts: string[] }> {
  const base = mkdtempSync(join(tmpdir(), "cx-packs-"));
  const content = join(base, "content", "tool-1.0", "bin");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "fakepack.exe"), "exe bytes");
  const zip = join(base, "pack.zip");
  spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), [
    "-a", "-cf", zip, "-C", join(base, "content"), ".",
  ]);
  const bytes = readFileSync(zip);
  server = Bun.serve({ port: 0, fetch: () => new Response(bytes) });
  const def: PackDef = {
    name: "fakepack",
    title: "Fake Pack",
    description: "test",
    version: "1.0",
    url: `http://127.0.0.1:${server.port}/pack.zip`,
    sha256: await sha256OfFile(zip),
    sizeBytes: bytes.length,
    kind: "zip",
    exeName: "fakepack.exe",
    unlocks: "testing",
  };
  const packsDir = join(base, "packs");
  const restarts: string[] = [];
  return { def, packsDir, restarts };
}

function manager(def: PackDef, packsDir: string, restarts: string[]) {
  return createPackManager({
    packsDir,
    registry: [def],
    log: () => {},
    restartConvertx: (reason) => {
      restarts.push(reason);
    },
  });
}

test("install: download, verify, extract, marker, PATH entries, restart", async () => {
  const { def, packsDir, restarts } = await fixture();
  const packs = manager(def, packsDir, restarts);

  expect(packs.list()[0]!.status).toEqual({ state: "available" });
  const result = await packs.install("fakepack");
  expect(result.state).toBe("installed");
  expect(restarts).toHaveLength(1);

  const entries = packs.installedPathEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.toLowerCase()).toContain("fakepack");
  expect(existsSync(join(entries[0]!, "fakepack.exe"))).toBe(true);
  expect(packs.list()[0]!.status).toEqual({ state: "installed", version: "1.0" });

  // A fresh manager over the same dir sees the marker (persistence).
  const again = manager(def, packsDir, restarts);
  expect(again.list()[0]!.status).toEqual({ state: "installed", version: "1.0" });
});

test("hash mismatch -> error, nothing installed", async () => {
  const { def, packsDir, restarts } = await fixture();
  const bad = { ...def, sha256: "0".repeat(64) };
  const packs = manager(bad, packsDir, restarts);
  const result = await packs.install("fakepack");
  expect(result.state).toBe("error");
  expect(packs.installedPathEntries()).toHaveLength(0);
  expect(restarts).toHaveLength(0);
});

test("remove deletes the pack and restarts; unknown names error", async () => {
  const { def, packsDir, restarts } = await fixture();
  const packs = manager(def, packsDir, restarts);
  await packs.install("fakepack");
  const removed = await packs.remove("fakepack");
  expect(removed.state).toBe("available");
  expect(packs.installedPathEntries()).toHaveLength(0);
  expect(restarts).toHaveLength(2);
  expect((await packs.install("nope")).state).toBe("error");
});
```

- [ ] **Step 3:** FAIL run, then implement `src/bun/packs.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { extractArchive, findFile } from "../shared/archive";
import { sha256OfFile } from "../shared/checksums";
import type { PackDef } from "./pack-registry";

export type PackStatus =
  | { state: "available" }
  | { state: "downloading"; received: number; total: number }
  | { state: "verifying" }
  | { state: "extracting" }
  | { state: "restarting" }
  | { state: "installed"; version: string }
  | { state: "error"; message: string };

export interface PackInfo extends PackDef {
  status: PackStatus;
}

interface PackMarker {
  name: string;
  version: string;
  sha256: string;
  pathEntries: string[];
}

export interface PackManagerDeps {
  packsDir: string;
  registry: PackDef[];
  log: (message: string) => void;
  restartConvertx: (reason: string) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

/**
 * Optional converter packs: pinned-hash downloads installed under app-data,
 * their bin dirs joined onto the ConvertX child PATH (restart applies it).
 * The `.pack.json` marker is written last, so torn installs read as "not
 * installed" and are simply reinstallable (spec §5).
 */
export function createPackManager(deps: PackManagerDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ops = new Map<string, PackStatus>();

  const packDir = (name: string) => join(deps.packsDir, name);
  const markerFile = (name: string) => join(packDir(name), ".pack.json");

  function readMarker(name: string): PackMarker | undefined {
    try {
      const raw = JSON.parse(readFileSync(markerFile(name), "utf8")) as PackMarker;
      if (typeof raw.version !== "string" || !Array.isArray(raw.pathEntries)) return undefined;
      return raw;
    } catch {
      return undefined;
    }
  }

  function statusOf(def: PackDef): PackStatus {
    const op = ops.get(def.name);
    if (op) return op;
    const marker = readMarker(def.name);
    return marker ? { state: "installed", version: marker.version } : { state: "available" };
  }

  const fail = (name: string, message: string): PackStatus => {
    deps.log(`pack ${name} error: ${message}`);
    const status: PackStatus = { state: "error", message };
    ops.set(name, status);
    return status;
  };

  async function install(name: string): Promise<PackStatus> {
    const def = deps.registry.find((p) => p.name === name);
    if (!def) return { state: "error", message: `unknown pack: ${name}` };
    const current = statusOf(def);
    if (current.state !== "available" && current.state !== "error") return current;

    mkdirSync(deps.packsDir, { recursive: true });
    const download = join(deps.packsDir, `${name}.download`);
    const partial = join(deps.packsDir, `${name}.partial`);
    try {
      ops.set(name, { state: "downloading", received: 0, total: def.sizeBytes });
      const res = await fetchImpl(def.url, { redirect: "follow" });
      if (!res.ok || !res.body) return fail(name, `download failed (${res.status})`);
      const total = Number(res.headers.get("content-length")) || def.sizeBytes;
      const writer = Bun.file(download).writer();
      let received = 0;
      for await (const chunk of res.body) {
        writer.write(chunk);
        received += chunk.byteLength;
        ops.set(name, { state: "downloading", received, total });
      }
      await writer.end();

      ops.set(name, { state: "verifying" });
      const actual = await sha256OfFile(download);
      if (actual !== def.sha256) {
        return fail(name, `sha256 mismatch (expected ${def.sha256}, got ${actual})`);
      }

      ops.set(name, { state: "extracting" });
      rmSync(partial, { recursive: true, force: true });
      mkdirSync(partial, { recursive: true });
      extractArchive(download, partial);
      const exe = findFile(partial, def.exeName);
      if (!exe) return fail(name, `${def.exeName} not found in the archive`);

      rmSync(packDir(name), { recursive: true, force: true });
      renameSync(partial, packDir(name));
      const installedExe = findFile(packDir(name), def.exeName)!;
      const marker: PackMarker = {
        name,
        version: def.version,
        sha256: def.sha256,
        pathEntries: [dirname(installedExe)],
      };
      writeFileSync(markerFile(name), `${JSON.stringify(marker, null, 2)}\n`);

      ops.set(name, { state: "restarting" });
      await deps.restartConvertx(`pack installed: ${name}`);
      ops.delete(name);
      deps.log(`pack installed: ${name} ${def.version}`);
      return statusOf(def);
    } catch (err) {
      return fail(name, err instanceof Error ? err.message : String(err));
    } finally {
      rmSync(download, { force: true });
      rmSync(partial, { recursive: true, force: true });
    }
  }

  async function remove(name: string): Promise<PackStatus> {
    const def = deps.registry.find((p) => p.name === name);
    if (!def) return { state: "error", message: `unknown pack: ${name}` };
    if (!readMarker(name)) return statusOf(def);
    try {
      rmSync(packDir(name), { recursive: true, force: true });
      ops.set(name, { state: "restarting" });
      await deps.restartConvertx(`pack removed: ${name}`);
      ops.delete(name);
      deps.log(`pack removed: ${name}`);
      return statusOf(def);
    } catch (err) {
      return fail(name, err instanceof Error ? err.message : String(err));
    }
  }

  return {
    list: (): PackInfo[] => deps.registry.map((def) => ({ ...def, status: statusOf(def) })),
    install,
    remove,
    /** PATH entries of every installed pack, for the child spawn env. */
    installedPathEntries(): string[] {
      if (!existsSync(deps.packsDir)) return [];
      const entries: string[] = [];
      for (const name of readdirSync(deps.packsDir)) {
        const marker = readMarker(name);
        if (marker) entries.push(...marker.pathEntries.filter((p) => existsSync(p)));
      }
      return entries;
    },
  };
}
```

- [ ] **Step 4:** Tests pass (3), tsc clean, full `bun run test` green. Commit:

```powershell
git add src/bun/pack-registry.ts src/bun/packs.ts src/bun/packs.test.ts
git commit -m @'
feat: converter pack engine with pinned registry (vips, libjxl)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 8: Discovery global in the injected script

**Files:**
- Modify: `src/bun/linkguard.ts`, `src/bun/linkguard.test.ts`

- [ ] **Step 1:** Extend the second test in `linkguard.test.ts`:

```typescript
  // after the existing assertions on js:
  expect(js).toContain("__convertxDesktop");
  expect(js).toContain('"9.9.9"');
```

and change the call to `buildLinkInterceptorJs(54321, "tok-123", ORIGIN, "9.9.9")`.

- [ ] **Step 2:** FAIL run, then in `linkguard.ts` change the signature to `buildLinkInterceptorJs(controlPort: number, token: string, appOrigin: string, appVersion: string)` and insert, right after the `window.__cxLinkGuard = true;` line in the emitted array:

```typescript
    `  window.__convertxDesktop = Object.freeze({`,
    `    controlBase: ${controlBase},`,
    `    token: ${tok},`,
    `    version: ${JSON.stringify(appVersion)},`,
    `  });`,
```

(Doc comment: this is the frontend discovery mechanism — see docs/API.md.)

- [ ] **Step 3:** Tests pass; `bun x tsc --noEmit` will flag the call site in `index.ts` — pass `pkg.version` there in Task 9; for now update the call site with a placeholder import (`import pkg from "../../package.json"` and 4th arg `pkg.version`). Commit:

```powershell
git add src/bun/linkguard.ts src/bun/linkguard.test.ts src/bun/index.ts
git commit -m @'
feat: inject window.__convertxDesktop discovery global into app pages

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 9: Wire everything in the supervisor

**Files:**
- Modify: `src/bun/index.ts`

- [ ] **Step 1: Rewire.** The changes, in file order:

1. Imports: add

```typescript
import pkg from "../../package.json";
import { PACK_REGISTRY } from "./pack-registry";
import { createPackManager } from "./packs";
import { DEFAULT_SETTINGS, loadSettingsFile, sanitizeSettings, saveSettings, type Settings } from "./settings";
import { createUpdater } from "./updater";
import type { Route } from "./control";
```

2. After `const logger = createLogger(paths.logsDir);` add settings + engine state:

```typescript
  const loadedSettings = loadSettingsFile(paths.settingsFile);
  let settings: Settings = loadedSettings.settings;
  // Retention precedence: settings file > env override > 168h default.
  const envHours = Number(process.env.CONVERTX_DESKTOP_AUTO_DELETE_HOURS);
  const effectiveAutoDeleteHours = () =>
    loadedSettings.fromFile || settingsDirty
      ? settings.autoDeleteHours
      : Number.isFinite(envHours) && envHours >= 0
        ? envHours
        : DEFAULT_SETTINGS.autoDeleteHours;
  let settingsDirty = false;
  let convertxState: "starting" | "running" | "error" = "starting";
```

3. In `startServer()`: set `convertxState = "starting"` at the top, `= "error"` in both failure paths (boot-failure catch and the crash-else branch), `= "running"` after `loadURL(url)`. Change `autoDeleteHours: process.env.CONVERTX_DESKTOP_AUTO_DELETE_HOURS` to `autoDeleteHours: String(effectiveAutoDeleteHours())`. Change `pathPrepend` to:

```typescript
        pathPrepend: [...converterPathEntries(convertersDir), ...packs.installedPathEntries()],
```

4. Generalize restart (place where `requestRestart` is assigned; keep `requestRestart` calling it):

```typescript
  const restartConvertx = (reason: string) => {
    logger.log(`convertx restart: ${reason}`);
    stopConvertX?.();
    stopConvertX = undefined;
    mainWindow.webview.loadURL(SPLASH_URL);
    void startServer().catch((err) => {
      logger.log(`restart failed: ${err instanceof Error ? err.message : err}`);
      showError(err instanceof Error ? (err.stack ?? err.message) : String(err));
    });
  };
  requestRestart = () => restartConvertx("error-page button");
```

5. Engines (after the control server + lock write, before webview handlers):

```typescript
  const packs = createPackManager({
    packsDir: paths.packsDir,
    registry: PACK_REGISTRY,
    log: logger.log,
    restartConvertx,
  });

  const updater = createUpdater({
    currentVersion: pkg.version,
    repo: "sth3no/convertx-desktop",
    updatesDir: paths.updatesDir,
    installedLauncher: join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "ConvertX Desktop",
      "bin",
      "launcher.exe",
    ),
    log: logger.log,
    quitApp: () => {
      cleanup();
      process.exit(0);
    },
  });
```

(`cleanup` is declared with `const` before this point — move the `cleanup`/signal-handler block above the engines if needed.)

6. Routes array, passed to `startControlServer({ handlers, routes, getCorsOrigin: () => appOrigin })`:

```typescript
  const routes: Route[] = [
    {
      method: "GET",
      path: "/info",
      handler: () => ({
        body: {
          app: "convertx-desktop",
          version: pkg.version,
          appOrigin,
          convertx: { status: convertxState, port: appOrigin ? Number(new URL(appOrigin).port) : 0 },
          logPath: logger.logPath,
        },
      }),
    },
    { method: "GET", path: "/update/status", handler: () => ({ body: updater.status() }) },
    { method: "POST", path: "/update/check", handler: async () => ({ body: await updater.check() }) },
    { method: "POST", path: "/update/download", handler: async () => ({ body: await updater.download() }) },
    {
      method: "POST",
      path: "/update/apply",
      handler: async () => {
        const result = await updater.apply();
        return result.ok ? { body: { ok: true } } : { status: 409, body: { error: result.error } };
      },
    },
    { method: "GET", path: "/packs", handler: () => ({ body: packs.list() }) },
    {
      method: "POST",
      path: "/packs/install",
      handler: (req) => {
        const name = req.query.get("name") ?? "";
        void packs.install(name); // async; frontend polls GET /packs
        return { status: 202, body: { started: name } };
      },
    },
    {
      method: "POST",
      path: "/packs/remove",
      handler: (req) => {
        const name = req.query.get("name") ?? "";
        void packs.remove(name);
        return { status: 202, body: { started: name } };
      },
    },
    { method: "GET", path: "/settings", handler: () => ({ body: settings }) },
    {
      method: "POST",
      path: "/settings",
      handler: async (req) => {
        const patch = sanitizeSettings(await req.json());
        if (Object.keys(patch).length === 0) return { status: 400, body: { error: "no valid settings in body" } };
        settings = { ...settings, ...patch };
        settingsDirty = true;
        saveSettings(paths.settingsFile, settings);
        const needsRestart = patch.autoDeleteHours !== undefined;
        if (needsRestart) restartConvertx("settings changed");
        return { body: { settings, restarted: needsRestart } };
      },
    },
    {
      method: "POST",
      path: "/open-data-folder",
      handler: () => {
        const dataDir = join(paths.convertxDir, "data");
        mkdirSync(dataDir, { recursive: true });
        Utils.openPath(dataDir);
        return { body: { ok: true } };
      },
    },
    {
      method: "GET",
      path: "/logs/tail",
      handler: (req) => {
        const lines = Math.min(Number(req.query.get("lines")) || 100, 500);
        let text = "";
        try {
          text = readFileSync(logger.logPath, "utf8");
        } catch {
          // no log yet
        }
        const all = text.trimEnd().split("\n");
        return { body: { lines: all.slice(-lines) } };
      },
    },
  ];
```

(Add `mkdirSync` to the `node:fs` import.)

7. Interceptor build: `buildLinkInterceptorJs(control.port, control.token, appOrigin, pkg.version)`.

8. Updater lifecycle: after the first `await startServer()` resolves in `main()`, add:

```typescript
  updater.start(() => settings.updateMode);
```

9. Install-on-quit: in the window `close` handler, after flushing window state:

```typescript
    if (settings.updateMode === "auto" && updater.hasReadyUpdate()) {
      logger.log("installing downloaded update on quit");
      updater.applyOnQuit();
    }
```

- [ ] **Step 2:** `bun x tsc --noEmit` clean; `bun run test` all green; `bun run scripts/smoke.ts` passes (supervisor modules changed).

- [ ] **Step 3: Dev spot-check.** `bun run dev` in background; once healthy, from bash read the real profile's `instance.json` and:

```bash
curl -s "http://127.0.0.1:$PORT/info?token=$TOKEN"            # version 1.0.0, convertx running
curl -s "http://127.0.0.1:$PORT/packs?token=$TOKEN"           # registry with statuses
curl -s "http://127.0.0.1:$PORT/settings?token=$TOKEN"        # defaults
curl -s "http://127.0.0.1:$PORT/update/status?token=$TOKEN"   # a real state (idle/checking/up-to-date/update-available)
curl -s "http://127.0.0.1:17843/" | head -1                    # app serves
```

Also verify `window.__convertxDesktop` exists: `curl` can't check the injected global — instead assert the interceptor JS contains it by checking `/logs/tail` shows no injection errors, and confirm visually next dev session (noted in the report). Kill the dev app, remove the stale lock.

- [ ] **Step 4: Commit:**

```powershell
git add src/bun/index.ts
git commit -m @'
feat: wire updater, packs, and settings into the supervisor API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 10: API.md (the frontend contract)

**Files:**
- Create: `docs/API.md`
- Modify: `README.md` (pointer)

- [ ] **Step 1:** Write `docs/API.md` documenting: discovery (`window.__convertxDesktop = {controlBase, token, version}` on every ConvertX page), auth (token query param on every request), CORS behavior, every endpoint with method/params/response shape/status codes (the four Phase 1 endpoints + the eleven from this phase), the updater state machine (all states with their fields, and the poll-while-downloading pattern), pack statuses, settings semantics (restart side-effect of `autoDeleteHours`), error convention (`{error}` + status code), a worked `fetch` example, and an "Adding packs" maintainer note (registry is data + hash recording). Full endpoint tables — write them from the Task 9 route definitions so shapes match exactly.

- [ ] **Step 2:** README: in the Architecture section append: `The control server doubles as a local JSON API for building custom frontends — see docs/API.md.`

- [ ] **Step 3: Commit:**

```powershell
git add docs/API.md README.md
git commit -m @'
docs: document the local control API for frontend development

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 11: Packaged verification + ship

**Files:**
- Modify: `scripts/verify-packaged.ts`

- [ ] **Step 1:** In `verify-packaged.ts`, after the "first instance healthy" block (lock1 known), add read-only API probes:

```typescript
    const api = async (path: string) => {
      const res = await fetch(
        `http://127.0.0.1:${lock1.controlPort}${path}${path.includes("?") ? "&" : "?"}token=${lock1.token}`,
      );
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return res.json();
    };
    const info = (await api("/info")) as { version?: string; convertx?: { status?: string } };
    if (!info.version) throw new Error("/info missing version");
    console.log(`OK /info (version ${info.version}, convertx ${info.convertx?.status})`);
    const packList = (await api("/packs")) as unknown[];
    if (!Array.isArray(packList) || packList.length < 2) throw new Error("/packs registry empty");
    console.log(`OK /packs (${packList.length} packs listed)`);
    const settingsBody = (await api("/settings")) as { autoDeleteHours?: number };
    if (typeof settingsBody.autoDeleteHours !== "number") throw new Error("/settings malformed");
    const update = (await api("/update/status")) as { state?: string };
    if (!update.state) throw new Error("/update/status malformed");
    console.log(`OK /settings + /update/status (update state: ${update.state})`);
```

- [ ] **Step 2:** `bun run package` then `bun run scripts/verify-packaged.ts` — expect the previous checks plus the three new `OK` lines.

- [ ] **Step 3: Ship:** full gates + docs + push:

```powershell
bun run test
bun x tsc --noEmit
git add scripts/verify-packaged.ts
git commit -m @'
test: packaged verification probes the local API surface

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

Update the master plan status line (append `; Phases 3+4 engine layer complete (2026-07-07, plan: ../plans/2026-07-07-backend-engine-api.md) — UI intentionally left for the user, contract in docs/API.md`), commit, `git push`, confirm CI green.

---

## Self-review notes

- **Spec coverage:** router+CORS (T5 = §3/§7), updater (T6 = §4), packs+registry (T7 = §5), settings (T4 = §6), discovery global (T8 = §3/§7), wiring incl. install-on-quit + effective retention precedence (T9 = §7, §6), API.md (T10 = §1/§3), verify extension (T11 = §9), shared helpers (T1–T3 enable §5's runtime extraction).
- **Type consistency:** `Route`/`RouteRequest`/`RouteResult` (T5) used by T9's routes; `createUpdater` deps/returns (T6) match T9 usage (`status/check/download/apply/applyOnQuit/hasReadyUpdate/start`); `createPackManager` returns (T7) match T9 (`list/install/remove/installedPathEntries`); `sanitizeSettings/loadSettingsFile/saveSettings` (T4) match T9; `buildLinkInterceptorJs` 4-arg (T8) matches T9.
- **Judgment calls:** pack install POST returns 202 and the frontend polls `GET /packs` (long operations never block the HTTP call); settings restart only when retention changes; updater `start()` begins after first successful boot so a broken ConvertX never races an update download.
