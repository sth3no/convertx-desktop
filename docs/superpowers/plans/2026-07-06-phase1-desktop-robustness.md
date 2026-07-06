# Phase 1 — Desktop Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-06-phase1-desktop-robustness-design.md`: single instance + orphan reaping, log files, loopback enforcement, stable port + real healthcheck, window-state persistence, app-copy refresh, crash recovery with splash status, external-link guard, 7-day retention default.

**Architecture:** New leaf modules first (each unit-tested), then one rework of `src/bun/index.ts` that wires them, then smoke/packaged verification. A token-authed loopback control server is the backbone for focus/restart/open-external. A generated `--preload` shim forces the ConvertX child's `Bun.serve` onto 127.0.0.1.

**Tech Stack:** Bun 1.3.14, Electrobun 1.18.1 (`BrowserWindow.getFrame/activate/isMaximized`, `Screen.getAllDisplays`, `Utils.openExternal`, `webview.executeJavascript`, webview events `did-navigate`/`dom-ready`/`will-navigate`), `bun test`.

**Verified API facts this plan relies on** (from the Phase 1 research pass): `will-navigate` cannot cancel navigation; window `resize` event carries the frame but `close` does not; `focus()` is deprecated → use `activate()`; `Bun.serve` defaults to 0.0.0.0; download events never fire on Windows; `executeJavascript` is fire-and-forget and safe on `views://` pages.

---

### Task 1: Rotating file logger

**Files:**
- Create: `src/bun/logger.ts`
- Test: `src/bun/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/bun/logger.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger";

test("createLogger appends timestamped lines and reports its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-log-"));
  const logger = createLogger(dir);
  logger.log("hello");
  logger.log("world\n");
  const content = readFileSync(logger.logPath, "utf8");
  const lines = content.trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[0-9:.]+Z\] hello$/);
  expect(lines[1]).toMatch(/world$/);
  expect(logger.logPath).toBe(join(dir, "convertx.log"));
});

test("createLogger rotates once the file exceeds maxBytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-logrot-"));
  const logger = createLogger(dir, 200);
  for (let i = 0; i < 20; i++) logger.log(`line ${i} ${"x".repeat(40)}`);
  expect(existsSync(join(dir, "convertx.log"))).toBe(true);
  expect(existsSync(join(dir, "convertx.log.1"))).toBe(true);
  // Rotation keeps exactly one old generation.
  expect(existsSync(join(dir, "convertx.log.2"))).toBe(false);
});

test("log never throws even when the directory is gone", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-loggone-"));
  const logger = createLogger(dir);
  rmSync(dir, { recursive: true, force: true });
  expect(() => logger.log("into the void")).not.toThrow();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/logger.test.ts`
Expected: FAIL — cannot resolve `./logger`.

- [ ] **Step 3: Implement**

Create `src/bun/logger.ts`:

```typescript
import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Logger {
  log: (line: string) => void;
  logPath: string;
}

/**
 * Timestamped, size-rotated file logger. Rotates convertx.log ->
 * convertx.log.1 (one old generation) once it exceeds maxBytes. Logging is
 * diagnostics — it must never crash the app, so all IO errors are swallowed.
 */
export function createLogger(logsDir: string, maxBytes = 1024 * 1024): Logger {
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    // fall through — log() will no-op on write errors
  }
  const logPath = join(logsDir, "convertx.log");
  const rotated = `${logPath}.1`;
  return {
    logPath,
    log(line: string) {
      try {
        if (existsSync(logPath) && statSync(logPath).size >= maxBytes) {
          rmSync(rotated, { force: true });
          renameSync(logPath, rotated);
        }
        const text = line.endsWith("\n") ? line : `${line}\n`;
        appendFileSync(logPath, `[${new Date().toISOString()}] ${text}`);
      } catch {
        // never throw from logging
      }
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/logger.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/logger.ts src/bun/logger.test.ts
git commit -m @'
feat: add rotating file logger for supervisor and child output

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Window state (load/save/clamp)

**Files:**
- Create: `src/bun/window-state.ts`
- Test: `src/bun/window-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/bun/window-state.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clampToDisplays,
  DEFAULT_STATE,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from "./window-state";

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
const LEFT_SECONDARY = { workArea: { x: -1920, y: 0, width: 1920, height: 1032 } };

test("save + load round-trips", () => {
  const file = join(mkdtempSync(join(tmpdir(), "cx-ws-")), "window-state.json");
  const state: WindowState = { x: 10, y: 20, width: 900, height: 700, maximized: true };
  saveWindowState(file, state);
  expect(loadWindowState(file)).toEqual(state);
});

test("load returns the default when the file is missing or invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-wsbad-"));
  expect(loadWindowState(join(dir, "missing.json"))).toEqual(DEFAULT_STATE);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  expect(loadWindowState(bad)).toEqual(DEFAULT_STATE);
  const wrongShape = join(dir, "shape.json");
  writeFileSync(wrongShape, JSON.stringify({ x: "left", width: 100 }));
  expect(loadWindowState(wrongShape)).toEqual(DEFAULT_STATE);
});

test("clamp keeps a frame that is on a display (including negative-x monitors)", () => {
  const onSecondary: WindowState = { x: -1800, y: 50, width: 800, height: 600, maximized: false };
  expect(clampToDisplays(onSecondary, [PRIMARY, LEFT_SECONDARY])).toEqual(onSecondary);
});

test("clamp falls back to the default frame when the title bar is off every display", () => {
  const lost: WindowState = { x: 5000, y: 5000, width: 800, height: 600, maximized: true };
  const clamped = clampToDisplays(lost, [PRIMARY]);
  expect(clamped).toEqual({ ...DEFAULT_STATE, maximized: true });
});

test("clamp falls back to the default when display info is empty or zeroed", () => {
  const state: WindowState = { x: 10, y: 10, width: 800, height: 600, maximized: false };
  expect(clampToDisplays(state, [])).toEqual({ ...DEFAULT_STATE, maximized: false });
  expect(
    clampToDisplays(state, [{ workArea: { x: 0, y: 0, width: 0, height: 0 } }]),
  ).toEqual({ ...DEFAULT_STATE, maximized: false });
});

test("clamp shrinks a frame larger than the biggest work area", () => {
  const huge: WindowState = { x: 0, y: 0, width: 4000, height: 3000, maximized: false };
  const clamped = clampToDisplays(huge, [PRIMARY]);
  expect(clamped.width).toBe(1920);
  expect(clamped.height).toBe(1032);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/window-state.test.ts`
Expected: FAIL — cannot resolve `./window-state`.

- [ ] **Step 3: Implement**

Create `src/bun/window-state.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Subset of Electrobun's Display we depend on (Screen.getAllDisplays()). */
export interface DisplayLike {
  workArea: { x: number; y: number; width: number; height: number };
}

export const DEFAULT_STATE: WindowState = {
  x: 150,
  y: 100,
  width: 1100,
  height: 800,
  maximized: false,
};

export function loadWindowState(file: string): WindowState {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (
      typeof raw.x === "number" &&
      typeof raw.y === "number" &&
      typeof raw.width === "number" &&
      typeof raw.height === "number" &&
      typeof raw.maximized === "boolean" &&
      raw.width > 0 &&
      raw.height > 0
    ) {
      return {
        x: raw.x,
        y: raw.y,
        width: raw.width,
        height: raw.height,
        maximized: raw.maximized,
      };
    }
  } catch {
    // missing/corrupt file -> default
  }
  return { ...DEFAULT_STATE };
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // persistence is best-effort
  }
}

/**
 * Keep a saved frame only if its title-bar strip (top 30px) still overlaps a
 * display's work area by a grabbable amount (>=50x15 px) — otherwise the
 * window could restore off-screen with no way to drag it back. Also shrink
 * frames larger than the biggest work area. Zeroed/empty display info means
 * "no information" (Electrobun returns that when native lookup fails) — fall
 * back to the default frame rather than clamping to 0x0.
 */
export function clampToDisplays(state: WindowState, displays: DisplayLike[]): WindowState {
  const usable = displays.filter((d) => d.workArea.width > 0 && d.workArea.height > 0);
  if (usable.length === 0) return { ...DEFAULT_STATE, maximized: state.maximized };

  const strip = { x: state.x, y: state.y, width: state.width, height: 30 };
  const grabbable = usable.some((d) => {
    const a = d.workArea;
    const overlapW = Math.min(strip.x + strip.width, a.x + a.width) - Math.max(strip.x, a.x);
    const overlapH = Math.min(strip.y + strip.height, a.y + a.height) - Math.max(strip.y, a.y);
    return overlapW >= 50 && overlapH >= 15;
  });
  if (!grabbable) return { ...DEFAULT_STATE, maximized: state.maximized };

  const maxW = Math.max(...usable.map((d) => d.workArea.width));
  const maxH = Math.max(...usable.map((d) => d.workArea.height));
  return {
    ...state,
    width: Math.min(state.width, maxW),
    height: Math.min(state.height, maxH),
  };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/window-state.test.ts`
Expected: 6 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/window-state.ts src/bun/window-state.test.ts
git commit -m @'
feat: add window-state persistence with display clamping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: Stable port preference

**Files:**
- Modify: `src/bun/port.ts`
- Test: `src/bun/port.test.ts` (append)

- [ ] **Step 1: Append failing tests to `src/bun/port.test.ts`**

Add to the existing imports: `import { findFreePort, PREFERRED_PORT, resolvePort } from "./port";` (replacing the current import line), then append:

```typescript
test("resolvePort returns the preferred port when it is free", async () => {
  // Use a random free port as the "preferred" one so the test can't collide
  // with a real service on the machine.
  const preferred = await findFreePort();
  expect(await resolvePort(preferred)).toBe(preferred);
});

test("resolvePort falls back to another free port when preferred is taken", async () => {
  const preferred = await findFreePort();
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(preferred, "127.0.0.1", resolve));
  try {
    const port = await resolvePort(preferred);
    expect(port).not.toBe(preferred);
    expect(port).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test("PREFERRED_PORT is a sane user-space port", () => {
  expect(PREFERRED_PORT).toBeGreaterThan(1024);
  expect(PREFERRED_PORT).toBeLessThan(65536);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/port.test.ts`
Expected: FAIL — `resolvePort`/`PREFERRED_PORT` not exported.

- [ ] **Step 3: Implement — append to `src/bun/port.ts`**

```typescript
/**
 * Default ConvertX port. A stable port keeps the webview origin
 * (http://127.0.0.1:<port>) — and with it localStorage etc. — identical
 * across launches. Uncommon on purpose; when taken, resolvePort falls back
 * to a random free port (origin state is lost only in that rare case).
 */
export const PREFERRED_PORT = 17843;

/** True if `port` can be bound on loopback right now. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** The preferred port if free, otherwise any free loopback port. */
export async function resolvePort(preferred = PREFERRED_PORT): Promise<number> {
  if (await isPortFree(preferred)) return preferred;
  return findFreePort();
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/port.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/port.ts src/bun/port.test.ts
git commit -m @'
feat: prefer a stable ConvertX port with free-port fallback

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Real healthcheck

**Files:**
- Modify: `src/bun/health.ts` (rewrite)
- Test: `src/bun/health.test.ts` (rewrite)

- [ ] **Step 1: Rewrite `src/bun/health.test.ts` (failing against current impl)**

```typescript
import { expect, test } from "bun:test";
import { waitForHealth } from "./health";

test("waitForHealth resolves once /healthcheck returns {status:'ok'}", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/healthcheck"
        ? Response.json({ status: "ok" })
        : new Response("nope", { status: 404 }),
  });
  try {
    await waitForHealth(`http://127.0.0.1:${server.port}/`, 5_000, 50);
  } finally {
    server.stop(true);
  }
});

test("waitForHealth rejects when nothing responds before the timeout", async () => {
  await expect(waitForHealth("http://127.0.0.1:1/", 600, 100)).rejects.toThrow(/Timed out/);
});

test("waitForHealth does not accept a port squatter (wrong body)", async () => {
  // A foreign server that answers 200 with the wrong payload must not pass.
  const squatter = Bun.serve({ port: 0, fetch: () => new Response("totally fine") });
  try {
    await expect(
      waitForHealth(`http://127.0.0.1:${squatter.port}/`, 600, 100),
    ).rejects.toThrow(/Timed out/);
  } finally {
    squatter.stop(true);
  }
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/health.test.ts`
Expected: test 1 and 3 FAIL against the current any-response implementation (test 1 fails because `/healthcheck` isn't requested — the current code accepts the 404; test 3 fails because 200-anything passes).

Note: with the current implementation test 1 actually PASSES (any response accepted); the meaningful failure is test 3. Confirm test 3 fails, then implement.

- [ ] **Step 3: Rewrite `src/bun/health.ts`**

```typescript
/**
 * Poll ConvertX's GET /healthcheck until it returns HTTP 200 with
 * {"status":"ok"}, or reject after `timeoutMs`. Requiring the real endpoint
 * (instead of any HTTP response) means a foreign process squatting the port
 * can never pass as a healthy ConvertX.
 */
export async function waitForHealth(
  baseUrl: string,
  timeoutMs = 45_000,
  intervalMs = 250,
): Promise<void> {
  const healthUrl = new URL("healthcheck", baseUrl).toString();
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { redirect: "manual" });
      if (res.status === 200) {
        const body = (await res.json().catch(() => undefined)) as { status?: string } | undefined;
        if (body?.status === "ok") return;
        lastError = "unexpected /healthcheck body";
      } else {
        lastError = `status ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${healthUrl} after ${timeoutMs}ms (${lastError})`);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/health.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/health.ts src/bun/health.test.ts
git commit -m @'
feat: health check requires ConvertX /healthcheck, rejecting port squatters

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Control server

**Files:**
- Create: `src/bun/control.ts`
- Test: `src/bun/control.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/bun/control.test.ts`:

```typescript
import { afterEach, expect, test } from "bun:test";
import { CONTROL_APP_ID, startControlServer, type ControlServer } from "./control";

let server: ControlServer | undefined;
afterEach(() => {
  server?.stop();
  server = undefined;
});

function calls() {
  const seen: string[] = [];
  return {
    seen,
    handlers: {
      onFocus: () => seen.push("focus"),
      onRestart: () => seen.push("restart"),
      onOpenExternal: (url: string) => seen.push(`open:${url}`),
    },
  };
}

test("ping identifies the app and pid; endpoints dispatch to handlers", async () => {
  const { seen, handlers } = calls();
  server = startControlServer(handlers);
  const base = `http://127.0.0.1:${server.port}`;

  const ping = await fetch(`${base}/ping?token=${server.token}`);
  expect(ping.status).toBe(200);
  expect(await ping.json()).toEqual({ app: CONTROL_APP_ID, pid: process.pid });

  expect((await fetch(`${base}/focus?token=${server.token}`, { method: "POST" })).status).toBe(200);
  expect((await fetch(`${base}/restart?token=${server.token}`, { method: "POST" })).status).toBe(200);
  const url = encodeURIComponent("https://example.com/page");
  expect(
    (await fetch(`${base}/open-external?token=${server.token}&url=${url}`, { method: "POST" }))
      .status,
  ).toBe(200);
  expect(seen).toEqual(["focus", "restart", "open:https://example.com/page"]);
});

test("requests without the correct token are rejected and never dispatched", async () => {
  const { seen, handlers } = calls();
  server = startControlServer(handlers);
  const base = `http://127.0.0.1:${server.port}`;
  expect((await fetch(`${base}/ping`)).status).toBe(403);
  expect((await fetch(`${base}/focus?token=wrong`, { method: "POST" })).status).toBe(403);
  expect(seen).toEqual([]);
});

test("open-external rejects non-web URLs; GET on POST endpoints is a 404", async () => {
  const { seen, handlers } = calls();
  server = startControlServer(handlers);
  const base = `http://127.0.0.1:${server.port}`;
  const bad = encodeURIComponent("file:///C:/Windows/system32");
  expect(
    (await fetch(`${base}/open-external?token=${server.token}&url=${bad}`, { method: "POST" }))
      .status,
  ).toBe(400);
  expect((await fetch(`${base}/focus?token=${server.token}`)).status).toBe(404);
  expect(seen).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/control.test.ts`
Expected: FAIL — cannot resolve `./control`.

- [ ] **Step 3: Implement**

Create `src/bun/control.ts`:

```typescript
import { randomUUID } from "node:crypto";

export const CONTROL_APP_ID = "convertx-desktop";

export interface ControlHandlers {
  onFocus: () => void;
  onRestart: () => void;
  onOpenExternal: (url: string) => void;
}

export interface ControlServer {
  port: number;
  token: string;
  stop: () => void;
}

/**
 * Loopback control server — the supervisor's command channel. Consumers:
 * a second app instance (/ping to verify the lock owner is really us —
 * immune to PID reuse — and /focus to raise the window), the error page's
 * Restart button (/restart), and the injected link interceptor
 * (/open-external). Every endpoint requires the per-run token.
 */
export function startControlServer(handlers: ControlHandlers): ControlServer {
  const token = randomUUID();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.searchParams.get("token") !== token) {
        return new Response("forbidden", { status: 403 });
      }
      if (url.pathname === "/ping" && req.method === "GET") {
        return Response.json({ app: CONTROL_APP_ID, pid: process.pid });
      }
      if (url.pathname === "/focus" && req.method === "POST") {
        handlers.onFocus();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/restart" && req.method === "POST") {
        handlers.onRestart();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/open-external" && req.method === "POST") {
        const target = url.searchParams.get("url") ?? "";
        if (!/^(https?:\/\/|mailto:)/i.test(target)) {
          return new Response("bad url", { status: 400 });
        }
        handlers.onOpenExternal(target);
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port, token, stop: () => server.stop(true) };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/control.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/control.ts src/bun/control.test.ts
git commit -m @'
feat: add token-authed loopback control server (focus/restart/open-external)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Single-instance lock + orphan reaping

**Files:**
- Create: `src/bun/instance.ts`
- Test: `src/bun/instance.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/bun/instance.test.ts`:

```typescript
import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startControlServer, type ControlServer } from "./control";
import {
  isLockAlive,
  isProcessImage,
  lockFilePath,
  readLock,
  reapStaleConvertx,
  removeLock,
  requestFocus,
  updateLockChildPid,
  writeLock,
} from "./instance";

let control: ControlServer | undefined;
afterEach(() => {
  control?.stop();
  control = undefined;
});

function tempLockFile(): string {
  return lockFilePath(mkdtempSync(join(tmpdir(), "cx-lock-")));
}

test("write/read/update/remove lock round-trip", () => {
  const file = tempLockFile();
  writeLock(file, { pid: 123, controlPort: 45678, token: "t" });
  expect(readLock(file)).toEqual({ pid: 123, controlPort: 45678, token: "t" });
  updateLockChildPid(file, 999);
  expect(readLock(file)?.convertxPid).toBe(999);
  removeLock(file);
  expect(existsSync(file)).toBe(false);
});

test("readLock returns undefined for missing or malformed files", () => {
  const file = tempLockFile();
  expect(readLock(file)).toBeUndefined();
  writeFileSync(file, "{broken");
  expect(readLock(file)).toBeUndefined();
  writeFileSync(file, JSON.stringify({ pid: "nope" }));
  expect(readLock(file)).toBeUndefined();
});

test("isLockAlive is true only for a live control server with matching pid", async () => {
  let focused = 0;
  control = startControlServer({
    onFocus: () => focused++,
    onRestart: () => {},
    onOpenExternal: () => {},
  });
  const live = { pid: process.pid, controlPort: control.port, token: control.token };
  expect(await isLockAlive(live)).toBe(true);

  // Wrong pid in the lock (stale file reused by another process) -> not alive.
  expect(await isLockAlive({ ...live, pid: process.pid + 1 })).toBe(false);
  // Wrong token -> not alive.
  expect(await isLockAlive({ ...live, token: "wrong" })).toBe(false);
  // Dead port -> not alive (fast).
  expect(await isLockAlive({ pid: 1, controlPort: 1, token: "t" })).toBe(false);
  // Port 0 (control server failed at write time) -> not alive, no fetch.
  expect(await isLockAlive({ pid: 1, controlPort: 0, token: "t" })).toBe(false);

  await requestFocus(live);
  expect(focused).toBe(1);
});

test("isProcessImage matches tasklist CSV output for the pid", () => {
  const csv = `"bun.exe","4242","Console","1","120,000 K"\r\n`;
  expect(isProcessImage(4242, "bun.exe", () => csv)).toBe(true);
  expect(isProcessImage(4242, "ffmpeg.exe", () => csv)).toBe(false);
  expect(isProcessImage(4243, "bun.exe", () => csv)).toBe(false);
  expect(isProcessImage(4242, "bun.exe", () => "INFO: No tasks are running.")).toBe(false);
});

test("reapStaleConvertx kills only verified bun.exe pids", () => {
  const killed: number[] = [];
  const logs: string[] = [];
  const deps = {
    runTasklist: () => `"bun.exe","555","Console","1","1,000 K"`,
    kill: (pid: number) => killed.push(pid),
  };
  reapStaleConvertx({ pid: 1, controlPort: 0, token: "", convertxPid: 555 }, (m) => logs.push(m), deps);
  expect(killed).toEqual([555]);

  // Image mismatch (pid was reused by another program) -> no kill.
  killed.length = 0;
  reapStaleConvertx(
    { pid: 1, controlPort: 0, token: "", convertxPid: 777 },
    (m) => logs.push(m),
    { runTasklist: () => `"notepad.exe","777","Console","1","1,000 K"`, kill: (pid) => killed.push(pid) },
  );
  expect(killed).toEqual([]);

  // No recorded child pid -> no kill.
  reapStaleConvertx({ pid: 1, controlPort: 0, token: "" }, (m) => logs.push(m), deps);
  expect(killed).toEqual([]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/instance.test.ts`
Expected: FAIL — cannot resolve `./instance`.

- [ ] **Step 3: Implement**

Create `src/bun/instance.ts`:

```typescript
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTROL_APP_ID } from "./control";

/**
 * Single-instance lock file. `pid`/`controlPort`/`token` identify the running
 * supervisor; `convertxPid` is recorded after the child spawns so a later
 * launch can reap it if the supervisor was hard-killed (taskkill /F, crash)
 * and never ran its cleanup.
 */
export interface InstanceLock {
  pid: number;
  controlPort: number;
  token: string;
  convertxPid?: number;
}

export function lockFilePath(appDataDir: string): string {
  return join(appDataDir, "instance.json");
}

export function readLock(file: string): InstanceLock | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (
      typeof raw.pid !== "number" ||
      typeof raw.controlPort !== "number" ||
      typeof raw.token !== "string"
    ) {
      return undefined;
    }
    return {
      pid: raw.pid,
      controlPort: raw.controlPort,
      token: raw.token,
      ...(typeof raw.convertxPid === "number" ? { convertxPid: raw.convertxPid } : {}),
    };
  } catch {
    return undefined;
  }
}

export function writeLock(file: string, lock: InstanceLock): void {
  writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
}

export function updateLockChildPid(file: string, convertxPid: number): void {
  const lock = readLock(file);
  if (lock) writeLock(file, { ...lock, convertxPid });
}

export function removeLock(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // best effort
  }
}

/**
 * True only if the lock's control server answers /ping as our app with the
 * lock's pid — a stale file, a dead process, or an unrelated server on a
 * reused port all fail this check.
 */
export async function isLockAlive(lock: InstanceLock, timeoutMs = 1500): Promise<boolean> {
  if (lock.controlPort <= 0) return false;
  try {
    const res = await fetch(
      `http://127.0.0.1:${lock.controlPort}/ping?token=${lock.token}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string; pid?: number };
    return body.app === CONTROL_APP_ID && body.pid === lock.pid;
  } catch {
    return false;
  }
}

/** Ask the running instance to raise its window. Best-effort. */
export async function requestFocus(lock: InstanceLock, timeoutMs = 1500): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${lock.controlPort}/focus?token=${lock.token}`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // the window not raising is not fatal
  }
}

function defaultTasklist(pid: number): string {
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  return result.stdout ?? "";
}

/** True if tasklist reports `pid` running with the given image name. */
export function isProcessImage(
  pid: number,
  imageName: string,
  runTasklist: (pid: number) => string = defaultTasklist,
): boolean {
  const out = runTasklist(pid).toLowerCase();
  return out.includes(`"${imageName.toLowerCase()}","${pid}"`);
}

export interface ReapDeps {
  runTasklist?: (pid: number) => string;
  kill?: (pid: number) => void;
}

/**
 * Kill the ConvertX child recorded in a stale lock — but only after
 * verifying the pid still belongs to a bun.exe (PID reuse guard). Never
 * throws; cleanup must not block startup.
 */
export function reapStaleConvertx(
  lock: InstanceLock,
  log: (message: string) => void,
  deps: ReapDeps = {},
): void {
  const { convertxPid } = lock;
  if (!convertxPid) return;
  try {
    const runTasklist = deps.runTasklist ?? defaultTasklist;
    if (!isProcessImage(convertxPid, "bun.exe", runTasklist)) {
      log(`stale lock child pid ${convertxPid} is not bun.exe — not reaping`);
      return;
    }
    const kill =
      deps.kill ??
      ((pid: number) => spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]));
    kill(convertxPid);
    log(`reaped stale ConvertX process tree (pid ${convertxPid})`);
  } catch (err) {
    log(`orphan reap failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/instance.test.ts`
Expected: 5 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/instance.ts src/bun/instance.test.ts
git commit -m @'
feat: add single-instance lock with verified orphan reaping

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Loopback shim, preload spawn, retention default, child pid

**Files:**
- Modify: `src/bun/convertx.ts`
- Test: `src/bun/convertx.test.ts` (append)

- [ ] **Step 1: Append failing tests to `src/bun/convertx.test.ts`**

Extend the import line to: `import { buildConvertxEnv, LOOPBACK_SHIM_SOURCE, startConvertX, writeLoopbackShim } from "./convertx";` and add `readFileSync, existsSync` to the `node:fs` import. Append:

```typescript
test("buildConvertxEnv defaults retention to 7 days and honors the override", () => {
  const defaulted = buildConvertxEnv({ port: 1, jwtSecret: "s", pathPrepend: [], baseEnv: {} });
  expect(defaulted.AUTO_DELETE_EVERY_N_HOURS).toBe("168");
  const overridden = buildConvertxEnv({
    port: 1,
    jwtSecret: "s",
    pathPrepend: [],
    baseEnv: {},
    autoDeleteHours: "0",
  });
  expect(overridden.AUTO_DELETE_EVERY_N_HOURS).toBe("0");
});

test("writeLoopbackShim writes the Bun.serve wrapper into app-data", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-shim-"));
  const file = writeLoopbackShim(dir);
  expect(file).toBe(join(dir, "loopback-shim.ts"));
  expect(readFileSync(file, "utf8")).toBe(LOOPBACK_SHIM_SOURCE);
});

test("startConvertX runs the preload file before the entrypoint and reports a pid", async () => {
  // The preload writes a marker file; the fake ConvertX exits immediately.
  // If `bun --preload <file> run src/index.tsx` were the wrong flag shape,
  // the marker would never appear.
  const dir = makeFakeConvertxDir("process.exit(0);\n");
  const marker = join(dir, "preload-ran.txt");
  const preload = join(dir, "preload.ts");
  writeFileSync(
    preload,
    `await Bun.write(${JSON.stringify(marker)}, "yes");\n`,
    "utf8",
  );
  try {
    const exited = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("child did not exit within 15s")), 15_000);
      const proc = startConvertX({
        bunPath: process.execPath,
        convertxDir: dir,
        env: testEnv(),
        preloadFile: preload,
        onExit: () => {
          clearTimeout(timer);
          resolve();
        },
      });
      expect(typeof proc.pid).toBe("number");
    });
    await exited;
    expect(existsSync(marker)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 20_000);
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/convertx.test.ts`
Expected: FAIL — `LOOPBACK_SHIM_SOURCE`/`writeLoopbackShim` not exported.

- [ ] **Step 3: Implement in `src/bun/convertx.ts`**

Add to the `node:fs` import: `writeFileSync` (current import line is `import { existsSync, readdirSync, statSync } from "node:fs";` → add `writeFileSync`).

Add to `ConvertxEnvOptions`:

```typescript
  /** AUTO_DELETE_EVERY_N_HOURS passthrough; defaults to "168" (7 days). */
  autoDeleteHours?: string;
```

In `buildConvertxEnv`, after `env.NODE_ENV = "production";` add:

```typescript
  // Desktop-sane retention: upstream defaults to deleting uploads/outputs
  // after 24h, which surprises desktop users. 168h = 7 days (user decision,
  // Phase 1 spec); override with CONVERTX_DESKTOP_AUTO_DELETE_HOURS via opts.
  env.AUTO_DELETE_EVERY_N_HOURS = opts.autoDeleteHours ?? "168";
```

Add the shim (below `buildConvertxEnv`):

```typescript
/**
 * Bun preload shim injected into the ConvertX child. Bun.serve binds 0.0.0.0
 * when no hostname is given (empirically verified; HOSTNAME env is ignored)
 * and ConvertX passes none — with ALLOW_UNAUTHENTICATED=true that would
 * expose the server to the LAN. The wrapper defaults hostname to loopback;
 * an explicit upstream hostname would still win. The vendored source stays
 * untouched (zero-patch principle).
 */
export const LOOPBACK_SHIM_SOURCE = `// Generated by ConvertX Desktop. Do not edit.
// Forces the ConvertX server onto 127.0.0.1 (see src/bun/convertx.ts).
const originalServe = Bun.serve.bind(Bun);
// @ts-ignore -- intentional monkey-patch, applied before ConvertX loads
Bun.serve = (options) => originalServe({ ...options, hostname: options?.hostname ?? "127.0.0.1" });
`;

/** Write the loopback shim into app-data; returns the file path. */
export function writeLoopbackShim(appDataDir: string): string {
  const file = join(appDataDir, "loopback-shim.ts");
  writeFileSync(file, LOOPBACK_SHIM_SOURCE);
  return file;
}
```

In `StartOptions` add:

```typescript
  /** Bun preload script path (--preload) run before ConvertX's entrypoint. */
  preloadFile?: string;
```

In `startConvertX`, change the spawn call and return type:

```typescript
export function startConvertX(opts: StartOptions): { stop: () => void; pid: number | undefined } {
  const args = opts.preloadFile
    ? ["--preload", opts.preloadFile, "run", "src/index.tsx"]
    : ["run", "src/index.tsx"];
  const child = spawn(opts.bunPath, args, {
```

and extend the returned object:

```typescript
  return {
    pid: child.pid,
    stop() {
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/convertx.test.ts`
Expected: 8 pass (5 existing + 3 new). The preload test doubles as the `bun --preload X run Y` flag-shape verification called out in the spec's risks.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/convertx.ts src/bun/convertx.test.ts
git commit -m @'
feat: loopback preload shim, 7-day retention default, child pid exposure

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 8: App-copy refresh driven by the vendor manifest

**Files:**
- Modify: `src/bun/bundle.ts`
- Test: `src/bun/bundle.test.ts` (append)

- [ ] **Step 1: Append failing tests to `src/bun/bundle.test.ts`**

```typescript
function makeSrcWithManifest(manifestText: string): { src: string; manifestFile: string } {
  const base = mkdtempSync(join(tmpdir(), "cx-refresh-"));
  const src = join(base, "vendor", "convertx");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  writeFileSync(join(src, "app.ts"), "// v-marker");
  const manifestFile = join(base, "vendor", "vendor-manifest.json");
  writeFileSync(manifestFile, manifestText);
  return { src, manifestFile };
}

test("first copy with a manifest records the marker and returns 'created'", () => {
  const { src, manifestFile } = makeSrcWithManifest('{"v":1}');
  const dest = join(mkdtempSync(join(tmpdir(), "cx-r1-")), "convertx");
  expect(ensureConvertxCopy(src, dest, manifestFile)).toBe("created");
  expect(readFileSync(join(dest, ".vendor-manifest.json"), "utf8")).toBe('{"v":1}');
});

test("same manifest -> 'unchanged'; different manifest -> refresh preserving data/", () => {
  const { src, manifestFile } = makeSrcWithManifest('{"v":1}');
  const dest = join(mkdtempSync(join(tmpdir(), "cx-r2-")), "convertx");
  ensureConvertxCopy(src, dest, manifestFile);

  // Simulate user state accumulated in the running copy.
  mkdirSync(join(dest, "data"), { recursive: true });
  writeFileSync(join(dest, "data", "db.sqlite"), "user conversions");
  // Simulate a stale app file that the refresh must replace.
  writeFileSync(join(dest, "app.ts"), "// OLD");

  expect(ensureConvertxCopy(src, dest, manifestFile)).toBe("unchanged");
  expect(readFileSync(join(dest, "app.ts"), "utf8")).toBe("// OLD");

  writeFileSync(manifestFile, '{"v":2}');
  expect(ensureConvertxCopy(src, dest, manifestFile)).toBe("refreshed");
  // App files come from the new vendor copy...
  expect(readFileSync(join(dest, "app.ts"), "utf8")).toBe("// v-marker");
  // ...user data survives the swap...
  expect(readFileSync(join(dest, "data", "db.sqlite"), "utf8")).toBe("user conversions");
  // ...and the marker is updated, so the next boot is a no-op again.
  expect(readFileSync(join(dest, ".vendor-manifest.json"), "utf8")).toBe('{"v":2}');
  expect(ensureConvertxCopy(src, dest, manifestFile)).toBe("unchanged");
  // No staging leftovers.
  expect(existsSync(`${dest}.partial`)).toBe(false);
  expect(existsSync(`${dest}.old`)).toBe(false);
});

test("an existing copy without a marker is refreshed once (pre-Phase-1 upgrade)", () => {
  const { src, manifestFile } = makeSrcWithManifest('{"v":1}');
  const dest = join(mkdtempSync(join(tmpdir(), "cx-r3-")), "convertx");
  // Old-style copy: no marker file.
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "package.json"), '{"name":"convertx"}');
  mkdirSync(join(dest, "data"), { recursive: true });
  writeFileSync(join(dest, "data", "db.sqlite"), "old data");

  expect(ensureConvertxCopy(src, dest, manifestFile)).toBe("refreshed");
  expect(readFileSync(join(dest, "data", "db.sqlite"), "utf8")).toBe("old data");
  expect(existsSync(join(dest, "app.ts"))).toBe(true);
});

test("without a manifest file the legacy behavior is kept (copy once, then no-op)", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-r4-"));
  const src = join(base, "src-convertx");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  const dest = join(base, "dest-convertx");
  expect(ensureConvertxCopy(src, dest)).toBe("created");
  expect(ensureConvertxCopy(src, dest)).toBe("unchanged");
  expect(existsSync(join(dest, ".vendor-manifest.json"))).toBe(false);
});

test("onStage callback announces first-copy and refresh before the heavy work", () => {
  const { src, manifestFile } = makeSrcWithManifest('{"v":1}');
  const dest = join(mkdtempSync(join(tmpdir(), "cx-r5-")), "convertx");
  const stages: string[] = [];
  ensureConvertxCopy(src, dest, manifestFile, (s) => stages.push(s));
  writeFileSync(manifestFile, '{"v":2}');
  ensureConvertxCopy(src, dest, manifestFile, (s) => stages.push(s));
  ensureConvertxCopy(src, dest, manifestFile, (s) => stages.push(s));
  expect(stages).toEqual(["first-copy", "refresh"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/bundle.test.ts`
Expected: new tests FAIL (`ensureConvertxCopy` returns void today and takes 2 args); the 7 existing tests still pass.

- [ ] **Step 3: Rewrite `ensureConvertxCopy` in `src/bun/bundle.ts`**

Replace the whole `ensureConvertxCopy` function (keep `pickVendorDir` and the imports; add `readFileSync, writeFileSync` to the `node:fs` import):

```typescript
export type CopyResult = "created" | "refreshed" | "unchanged";
export type CopyStage = "first-copy" | "refresh";

/** Marker inside the app-data copy recording which vendor manifest built it. */
const COPY_MARKER = ".vendor-manifest.json";

/**
 * Stage a filtered copy of `src` at `dest + ".partial"`. Top-level `data/`
 * and `.git/` are never copied (runtime/developer state). A leftover
 * `.partial` from a crashed previous run is stale by definition — discarded.
 */
function stagePartialCopy(src: string, dest: string): string {
  const excluded = new Set(EXCLUDED_CONVERTX_ENTRIES.map((entry) => resolve(src, entry)));
  const partial = `${dest}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(src, partial, {
    recursive: true,
    dereference: true,
    filter: (source) => !excluded.has(resolve(source)),
  });
  return partial;
}

/**
 * Ensure a writable, current copy of ConvertX exists at `dest`.
 *
 * - No copy yet -> copy `src` into place ("created").
 * - Copy exists and `vendorManifestFile` matches the marker recorded inside
 *   the copy -> no-op ("unchanged").
 * - Copy exists but the manifest differs (app update shipped a new vendor)
 *   or the marker is missing (pre-Phase-1 copy) -> staged refresh that
 *   preserves the copy's `data/` (uploads, outputs, SQLite DB): the new copy
 *   is fully staged first, the old `data/` is moved in, then directories are
 *   swapped ("refreshed").
 *
 * Every mutation is staged in `dest + ".partial"` and renamed into place, so
 * an interrupted run self-heals on the next launch. Without a manifest file
 * the legacy behavior is kept: copy once, never refresh.
 */
export function ensureConvertxCopy(
  src: string,
  dest: string,
  vendorManifestFile?: string,
  onStage?: (stage: CopyStage) => void,
): CopyResult {
  const manifest =
    vendorManifestFile && existsSync(vendorManifestFile)
      ? readFileSync(vendorManifestFile, "utf8")
      : undefined;
  const markerFile = join(dest, COPY_MARKER);

  if (existsSync(join(dest, "package.json"))) {
    if (manifest === undefined) return "unchanged";
    const marker = existsSync(markerFile) ? readFileSync(markerFile, "utf8") : undefined;
    if (marker === manifest) return "unchanged";

    onStage?.("refresh");
    const partial = stagePartialCopy(src, dest);
    // Preserve user state: data/ moves from the old copy into the staged one
    // only after the stage completed, so a crash before this point leaves the
    // old copy fully intact.
    const oldData = join(dest, "data");
    if (existsSync(oldData)) renameSync(oldData, join(partial, "data"));
    writeFileSync(join(partial, COPY_MARKER), manifest);
    const trash = `${dest}.old`;
    rmSync(trash, { recursive: true, force: true });
    renameSync(dest, trash);
    renameSync(partial, dest);
    rmSync(trash, { recursive: true, force: true });
    return "refreshed";
  }

  onStage?.("first-copy");
  const partial = stagePartialCopy(src, dest);
  if (manifest !== undefined) writeFileSync(join(partial, COPY_MARKER), manifest);
  // A dest without package.json is a half-copy from before staging existed —
  // clear it so the rename can land.
  rmSync(dest, { recursive: true, force: true });
  renameSync(partial, dest);
  return "created";
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/bundle.test.ts`
Expected: 12 pass (7 existing + 5 new).

- [ ] **Step 5: Commit**

```powershell
git add src/bun/bundle.ts src/bun/bundle.test.ts
git commit -m @'
feat: refresh the app-data ConvertX copy when the vendor manifest changes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 9: Link guard

**Files:**
- Create: `src/bun/linkguard.ts`
- Test: `src/bun/linkguard.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/bun/linkguard.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { buildLinkInterceptorJs, isExternalUrl } from "./linkguard";

const ORIGIN = "http://127.0.0.1:17843";

test("isExternalUrl classifies app, external, and scheme URLs", () => {
  expect(isExternalUrl("http://127.0.0.1:17843/results/3", ORIGIN)).toBe(false);
  expect(isExternalUrl("http://127.0.0.1:9999/", ORIGIN)).toBe(true);
  expect(isExternalUrl("https://github.com/C4illin/ConvertX", ORIGIN)).toBe(true);
  expect(isExternalUrl("mailto:someone@example.com", ORIGIN)).toBe(true);
  // Non-web schemes the shell itself produces are internal — never bounce
  // the webview for them (views:// splash, about:blank from loadHTML).
  expect(isExternalUrl("views://mainview/index.html", ORIGIN)).toBe(false);
  expect(isExternalUrl("about:blank", ORIGIN)).toBe(false);
  expect(isExternalUrl("javascript:void(0)", ORIGIN)).toBe(false);
  // Relative/invalid -> internal (never bounce).
  expect(isExternalUrl("/download/3", ORIGIN)).toBe(false);
  expect(isExternalUrl("not a url", ORIGIN)).toBe(false);
});

test("buildLinkInterceptorJs embeds origin, control endpoint, and idempotence guard", () => {
  const js = buildLinkInterceptorJs(54321, "tok-123", ORIGIN);
  expect(js).toContain('"http://127.0.0.1:54321"');
  expect(js).toContain("tok-123");
  expect(js).toContain(JSON.stringify(ORIGIN));
  expect(js).toContain("__cxLinkGuard");
  expect(js).toContain("open-external");
  // Values are JSON-embedded, not concatenated — no raw template holes left.
  expect(js).not.toContain("${");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/linkguard.test.ts`
Expected: FAIL — cannot resolve `./linkguard`.

- [ ] **Step 3: Implement**

Create `src/bun/linkguard.ts`:

```typescript
/**
 * External = a web URL on a different origin than the local ConvertX server,
 * or a mailto:. Everything else (relative paths, views:// splash, about:blank
 * from loadHTML error pages, javascript:) is internal — misclassifying those
 * as external would bounce the webview in a loop.
 */
export function isExternalUrl(url: string, appOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.origin !== appOrigin;
  }
  return parsed.protocol === "mailto:";
}

/**
 * Click interceptor injected into every ConvertX page (will-navigate cannot
 * cancel navigation on Windows — Phase 1 spec §2). Capture-phase listener:
 * external anchor clicks are prevented and forwarded to the supervisor's
 * control server, which opens them in the system browser. The POST is a CORS
 * "simple request", so it reaches the (different-origin) control server even
 * though the page can't read the response — hence mode: "no-cors".
 * Idempotent via window.__cxLinkGuard: safe to re-inject on every navigation.
 */
export function buildLinkInterceptorJs(
  controlPort: number,
  token: string,
  appOrigin: string,
): string {
  const controlBase = JSON.stringify(`http://127.0.0.1:${controlPort}`);
  const origin = JSON.stringify(appOrigin);
  const tok = JSON.stringify(token);
  return [
    "(() => {",
    "  if (window.__cxLinkGuard) return;",
    "  window.__cxLinkGuard = true;",
    `  const appOrigin = ${origin};`,
    `  const controlBase = ${controlBase};`,
    `  const token = ${tok};`,
    "  document.addEventListener('click', (ev) => {",
    "    const target = ev.target instanceof Element ? ev.target.closest('a[href]') : null;",
    "    if (!target) return;",
    "    const href = target.href;",
    "    let external = false;",
    "    try {",
    "      const u = new URL(href, location.href);",
    "      if (u.protocol === 'http:' || u.protocol === 'https:') {",
    "        external = u.origin !== appOrigin;",
    "      } else {",
    "        external = u.protocol === 'mailto:';",
    "      }",
    "    } catch { return; }",
    "    if (!external) return;",
    "    ev.preventDefault();",
    "    ev.stopPropagation();",
    "    fetch(controlBase + '/open-external?token=' + encodeURIComponent(token) +",
    "      '&url=' + encodeURIComponent(href), { method: 'POST', mode: 'no-cors' })",
    "      .catch(() => {});",
    "  }, true);",
    "})();",
  ].join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/linkguard.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/linkguard.ts src/bun/linkguard.test.ts
git commit -m @'
feat: add external-link guard (injected interceptor + URL classifier)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 10: App paths for logs and window state

**Files:**
- Modify: `src/bun/paths.ts`
- Test: `src/bun/paths.test.ts`

- [ ] **Step 1: Extend the test (failing)**

In `src/bun/paths.test.ts`, add inside the existing test after the `jwtSecretFile` expectation:

```typescript
  expect(paths.logsDir).toBe(join(base, "ConvertX-Electrobun", "logs"));
  expect(paths.windowStateFile).toBe(join(base, "ConvertX-Electrobun", "window-state.json"));
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test src/bun/paths.test.ts`
Expected: FAIL — `logsDir` undefined.

- [ ] **Step 3: Implement in `src/bun/paths.ts`**

Add to the `AppPaths` interface:

```typescript
  /** Rotating log files (see src/bun/logger.ts). */
  logsDir: string;
  /** Persisted window bounds + maximized flag. */
  windowStateFile: string;
```

and to the returned object in `getAppPaths`:

```typescript
    logsDir: join(appDataDir, "logs"),
    windowStateFile: join(appDataDir, "window-state.json"),
```

- [ ] **Step 4: Run tests**

Run: `bun test src/bun/paths.test.ts`
Expected: 1 pass.

- [ ] **Step 5: Commit**

```powershell
git add src/bun/paths.ts src/bun/paths.test.ts
git commit -m @'
feat: add logs dir and window-state file to app paths

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 11: Splash status channel

**Files:**
- Modify: `src/mainview/index.html`

- [ ] **Step 1: Add a status element id and the inline setter**

In `src/mainview/index.html`, change the status paragraph and add an inline script before `</body>`:

```html
    <main class="splash">
      <div class="spinner"></div>
      <h1>ConvertX</h1>
      <p id="status">Starting the converter&hellip;</p>
    </main>
    <script>
      // One-way status channel: the supervisor pushes stage text via
      // webview.executeJavascript. Inline (not the bundled entrypoint) so it
      // exists as soon as the document parses.
      window.__setSplashStatus = (text) => {
        const el = document.getElementById("status");
        if (el) el.textContent = text;
      };
    </script>
```

- [ ] **Step 2: Commit**

```powershell
git add src/mainview/index.html
git commit -m @'
feat: splash page accepts status updates from the supervisor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 12: Supervisor rework (`src/bun/index.ts`)

**Files:**
- Modify: `src/bun/index.ts` (full rewrite)

- [ ] **Step 1: Rewrite `src/bun/index.ts`**

```typescript
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, PATHS, Screen, Utils } from "electrobun/bun";
import { VENDOR_MANIFEST_NAME } from "../shared/vendor-spec";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";
import { startControlServer, type ControlServer } from "./control";
import {
  buildConvertxEnv,
  converterPathEntries,
  startConvertX,
  writeLoopbackShim,
} from "./convertx";
import { waitForHealth } from "./health";
import {
  isLockAlive,
  lockFilePath,
  readLock,
  reapStaleConvertx,
  removeLock,
  requestFocus,
  updateLockChildPid,
  writeLock,
} from "./instance";
import { buildLinkInterceptorJs, isExternalUrl } from "./linkguard";
import { createLogger } from "./logger";
import { getAppPaths } from "./paths";
import { resolvePort } from "./port";
import {
  clampToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from "./window-state";

const SPLASH_URL = "views://mainview/index.html";
/** Minimum spacing between silent auto-restarts (crash-loop guard). */
const AUTO_RESTART_COOLDOWN_MS = 10 * 60_000;

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

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function errorPage(message: string, opts: { logPath: string; restartUrl?: string }): string {
  const restartButton = opts.restartUrl
    ? `<button onclick="this.disabled=true;this.textContent='Restarting…';` +
      `fetch(${JSON.stringify(opts.restartUrl)},{method:'POST',mode:'no-cors'}).catch(()=>{})">` +
      `Restart ConvertX</button>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ConvertX</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e8e8e8;padding:2rem;line-height:1.5}
h1{font-size:1.3rem}pre{background:#000;color:#ddd;padding:1rem;border-radius:6px;
overflow:auto;white-space:pre-wrap;word-break:break-word}
button{margin:1rem 0;padding:.5rem 1.2rem;font-size:1rem;border-radius:6px;border:1px solid #555;
background:#2a5aa0;color:#fff;cursor:pointer}button:disabled{background:#444;cursor:default}
.meta{color:#9a9a9a;font-size:.9rem}</style></head>
<body><h1>ConvertX failed to start</h1>${restartButton}
<pre>${escapeHtml(message)}</pre>
<p class="meta">Log file: ${escapeHtml(opts.logPath)}</p></body></html>`;
}

async function main(): Promise<void> {
  const paths = getAppPaths();
  const logger = createLogger(paths.logsDir);

  // --- Single-instance gate. Runs before any app-data mutation, so two
  // --- racing launches can never fight over the convertx copy.
  const lockFile = lockFilePath(paths.appDataDir);
  const existing = readLock(lockFile);
  if (existing && (await isLockAlive(existing))) {
    await requestFocus(existing);
    console.log("Another ConvertX instance is running — focused it and exiting.");
    process.exit(0);
  }
  if (existing) {
    logger.log(`stale instance lock found (pid ${existing.pid})`);
    reapStaleConvertx(existing, logger.log);
  }

  // --- Window, restored from persisted state and clamped to real displays.
  const savedState = clampToDisplays(loadWindowState(paths.windowStateFile), Screen.getAllDisplays());
  const mainWindow = new BrowserWindow({
    title: "ConvertX",
    url: SPLASH_URL,
    frame: {
      x: savedState.x,
      y: savedState.y,
      width: savedState.width,
      height: savedState.height,
    },
  });
  if (savedState.maximized) mainWindow.maximize();

  // Persist window state from debounced resize/move (the close event carries
  // no frame, and getFrame() on a closing window is unreliable — so close
  // only flushes the last captured state).
  let pendingState: WindowState = { ...savedState };
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const capture = () => {
    try {
      if (mainWindow.isMaximized()) {
        pendingState = { ...pendingState, maximized: true };
      } else {
        const f = mainWindow.getFrame();
        pendingState = { x: f.x, y: f.y, width: f.width, height: f.height, maximized: false };
      }
      saveWindowState(paths.windowStateFile, pendingState);
    } catch {
      // never let state persistence break the app
    }
  };
  const scheduleCapture = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(capture, 500);
  };
  mainWindow.on("resize", scheduleCapture);
  mainWindow.on("move", scheduleCapture);
  mainWindow.on("close", () => {
    clearTimeout(saveTimer);
    saveWindowState(paths.windowStateFile, pendingState);
  });

  // --- Control server (focus / restart / open-external). Failure degrades:
  // --- lock gets controlPort 0, a later launch treats us as stale.
  let requestRestart: () => void = () => {};
  let control: ControlServer;
  try {
    control = startControlServer({
      onFocus: () => {
        if (mainWindow.isMinimized()) mainWindow.unminimize();
        mainWindow.activate();
      },
      onRestart: () => requestRestart(),
      onOpenExternal: (url) => {
        logger.log(`open external: ${url}`);
        Utils.openExternal(url);
      },
    });
  } catch (err) {
    logger.log(`control server failed to start: ${err instanceof Error ? err.message : err}`);
    control = { port: 0, token: "", stop: () => {} };
  }
  writeLock(lockFile, { pid: process.pid, controlPort: control.port, token: control.token });
  const restartUrl =
    control.port > 0
      ? `http://127.0.0.1:${control.port}/restart?token=${control.token}`
      : undefined;

  const setSplashStatus = (text: string) => {
    mainWindow.webview.executeJavascript(
      `window.__setSplashStatus && window.__setSplashStatus(${JSON.stringify(text)})`,
    );
  };

  const showError = (message: string) => {
    mainWindow.webview.loadHTML(errorPage(message, { logPath: logger.logPath, restartUrl }));
  };

  // --- Webview handlers, registered ONCE (BrowserView has no off(); a
  // --- restart must not stack duplicate handlers). startServer() updates
  // --- the mutable appOrigin/interceptorJs they read.
  let appOrigin = "";
  let interceptorJs = "";
  const inject = () => {
    if (interceptorJs) mainWindow.webview.executeJavascript(interceptorJs);
  };
  mainWindow.webview.on("did-navigate", inject);
  mainWindow.webview.on("dom-ready", inject);
  mainWindow.webview.on("will-navigate", (event: unknown) => {
    // Fallback only: will-navigate cannot cancel on Windows. If an external
    // URL slipped past the DOM interceptor, bounce back and open it outside.
    const detail = (event as { data?: { detail?: unknown } })?.data?.detail;
    if (!appOrigin || typeof detail !== "string") return;
    if (isExternalUrl(detail, appOrigin)) {
      logger.log(`external navigation bounced: ${detail}`);
      Utils.openExternal(detail);
      mainWindow.webview.loadURL(`${appOrigin}/`);
    }
  });

  // --- ConvertX lifecycle.
  let stopConvertX: (() => void) | undefined;
  let lastAutoRestartAt = 0;
  let starting = false;

  const cleanup = () => {
    stopConvertX?.();
    control.stop();
    removeLock(lockFile);
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  async function startServer(): Promise<void> {
    if (starting) return;
    starting = true;
    try {
      setSplashStatus("Starting the converter…");
      const vendorDir = pickVendorDir([
        // Packaged bundle: vendor/ baked next to the app by scripts/bundle-vendor.ts.
        join(PATHS.RESOURCES_FOLDER, "app", "vendor"),
        // Dev (`bun run dev`): electrobun runs the launcher with cwd = the
        // bundle's bin dir; reach the project root from Resources.
        join(PATHS.RESOURCES_FOLDER, "..", "..", "..", "..", "vendor"),
        // Supervisor run directly from the project root.
        join(process.cwd(), "vendor"),
      ]);
      const convertersDir = join(vendorDir, "converters", "win");

      const copyResult = ensureConvertxCopy(
        join(vendorDir, "convertx"),
        paths.convertxDir,
        join(vendorDir, VENDOR_MANIFEST_NAME),
        (stage) =>
          setSplashStatus(
            stage === "refresh"
              ? "Updating ConvertX… (your files are kept)"
              : "Preparing ConvertX (first run)…",
          ),
      );
      if (copyResult !== "unchanged") logger.log(`convertx copy: ${copyResult}`);

      const jwtSecret = loadJwtSecret(paths.jwtSecretFile);
      const port = await resolvePort();
      appOrigin = `http://127.0.0.1:${port}`;
      const url = `${appOrigin}/`;
      const shimFile = writeLoopbackShim(paths.appDataDir);

      let stderrTail = "";
      const env = buildConvertxEnv({
        port,
        jwtSecret,
        pathPrepend: converterPathEntries(convertersDir),
        autoDeleteHours: process.env.CONVERTX_DESKTOP_AUTO_DELETE_HOURS,
      });

      let rejectChildFailure: (err: Error) => void = () => {};
      const childFailure = new Promise<never>((_, reject) => {
        rejectChildFailure = reject;
      });

      setSplashStatus("Starting the converter…");
      const proc = startConvertX({
        bunPath: process.execPath,
        convertxDir: paths.convertxDir,
        env,
        preloadFile: shimFile,
        onStdout: (chunk) => {
          logger.log(`[convertx] ${chunk.trimEnd()}`);
          process.stdout.write(`[convertx] ${chunk}`);
        },
        onStderr: (chunk) => {
          stderrTail = (stderrTail + chunk).slice(-4000);
          logger.log(`[convertx:err] ${chunk.trimEnd()}`);
          process.stderr.write(`[convertx] ${chunk}`);
        },
        onError: (err) => rejectChildFailure(new Error(`ConvertX failed to spawn: ${err.message}`)),
        onExit: (code) => rejectChildFailure(new Error(`ConvertX exited with code ${code ?? "unknown"}`)),
      });
      stopConvertX = proc.stop;
      if (proc.pid !== undefined) updateLockChildPid(lockFile, proc.pid);

      try {
        await Promise.race([waitForHealth(url), childFailure]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.log(`boot failed: ${message}`);
        showError(`${message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`);
        return;
      }

      interceptorJs = buildLinkInterceptorJs(control.port, control.token, appOrigin);
      mainWindow.webview.loadURL(url);
      logger.log(`ConvertX ready at ${url}`);
      console.log(`ConvertX ready at ${url}`);

      // Crash recovery: one silent auto-restart per cooldown window, then a
      // visible error page with the Restart button (user decision, spec §3.8).
      childFailure.catch((err: Error) => {
        stopConvertX = undefined;
        const now = Date.now();
        if (now - lastAutoRestartAt > AUTO_RESTART_COOLDOWN_MS) {
          lastAutoRestartAt = now;
          logger.log(`ConvertX died (${err.message}) — auto-restarting once`);
          mainWindow.webview.loadURL(SPLASH_URL);
          void startServer();
        } else {
          logger.log(`ConvertX died again within cooldown (${err.message}) — showing error page`);
          showError(
            `ConvertX stopped unexpectedly.\n${err.message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`,
          );
        }
      });
    } finally {
      starting = false;
    }
  }

  requestRestart = () => {
    logger.log("restart requested (error-page button)");
    stopConvertX?.();
    stopConvertX = undefined;
    mainWindow.webview.loadURL(SPLASH_URL);
    void startServer().catch((err) => {
      logger.log(`restart failed: ${err instanceof Error ? err.message : err}`);
      showError(err instanceof Error ? (err.stack ?? err.message) : String(err));
    });
  };

  await startServer().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    logger.log(`fatal boot error: ${message}`);
    console.error(message);
    showError(message);
  });
}

void main();
```

- [ ] **Step 2: Typecheck + full test suite**

Run: `bun x tsc --noEmit` then `bun run test`
Expected: tsc clean; all tests pass.

- [ ] **Step 3: Dev sanity check**

Run `bun run dev`, wait for the window: splash status text appears, then the ConvertX UI. Click the footer "Powered by ConvertX" link — it must open in the system browser, not navigate the window. Close the window; check `%APPDATA%\ConvertX-Electrobun\window-state.json` and `logs\convertx.log` exist and `instance.json` is gone. (If dev-mode quirks block any of this, note it and rely on Task 14's packaged verification.)

- [ ] **Step 4: Commit**

```powershell
git add src/bun/index.ts
git commit -m @'
feat: wire single instance, window state, crash recovery, link guard into the supervisor

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 13: Smoke test — shim + loopback assertion + healthcheck

**Files:**
- Modify: `scripts/smoke.ts`

- [ ] **Step 1: Update the spawn path and add the netstat assertion**

In `scripts/smoke.ts`:

1. Extend the convertx import: `import { buildConvertxEnv, converterPathEntries, startConvertX, writeLoopbackShim } from "../src/bun/convertx";` and add `spawnSync` import: `import { spawnSync } from "node:child_process";`
2. After `const paths = getAppPaths(appDataBase);` add:

```typescript
    const shimFile = writeLoopbackShim(paths.appDataDir);
```

3. Pass it to `startConvertX` (add `preloadFile: shimFile,` after `env,`).
4. After `await waitForHealth(...)` add the loopback assertion:

```typescript
    // The preload shim must have pinned the server to loopback: netstat shows
    // 127.0.0.1:<port> LISTENING and no wildcard 0.0.0.0:<port> bind.
    const netstat = spawnSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).stdout ?? "";
    const lines = netstat.split("\n").filter((l) => l.includes(`:${port} `));
    const loopback = lines.some((l) => l.includes(`127.0.0.1:${port}`));
    const wildcard = lines.some((l) => l.includes(`0.0.0.0:${port}`));
    if (!loopback || wildcard) {
      throw new Error(
        `ConvertX is not loopback-only (loopback=${loopback}, wildcard=${wildcard}):\n${lines.join("\n")}`,
      );
    }
    console.log("Loopback-only bind confirmed.");
```

- [ ] **Step 2: Run the smoke test**

Run: `bun run scripts/smoke.ts`
Expected: `Loopback-only bind confirmed.` and `SMOKE TEST PASSED`.

- [ ] **Step 3: Commit**

```powershell
git add scripts/smoke.ts
git commit -m @'
test: smoke test uses the loopback shim and asserts loopback-only binding

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 14: Packaged integration verification

**Files:**
- Create: `scripts/verify-packaged.ts`

- [ ] **Step 1: Write the script**

Create `scripts/verify-packaged.ts`:

```typescript
/**
 * Integration checks against the PACKAGED bundle (bun run package first).
 * Uses an isolated APPDATA so the real profile is untouched. The app window
 * will appear briefly — this script is a local gate, not part of `bun test`.
 *
 * Verifies the Phase 1 done-when items that are scriptable:
 *   1. packaged app boots healthy (lock file + control /ping)
 *   2. second launch exits quickly and leaves the first instance running
 *   3. hard-killing the supervisor orphans the child; the next launch reaps it
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const LAUNCHER = join(PROJECT_ROOT, "build", "dev-win-x64", "ConvertX-dev", "bin", "launcher.exe");

interface Lock {
  pid: number;
  controlPort: number;
  token: string;
  convertxPid?: number;
}

function readLock(file: string): Lock | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Lock;
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pingOk(lock: Lock): Promise<boolean> {
  if (lock.controlPort <= 0) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${lock.controlPort}/ping?token=${lock.token}`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string };
    return body.app === "convertx-desktop";
  } catch {
    return false;
  }
}

async function waitFor(desc: string, timeoutMs: number, probe: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${desc}`);
}

function launch(appDataBase: string) {
  return spawn(LAUNCHER, [], {
    env: { ...process.env, APPDATA: appDataBase },
    stdio: "ignore",
  });
}

async function main(): Promise<void> {
  if (!existsSync(LAUNCHER)) {
    throw new Error(`No packaged bundle at ${LAUNCHER} — run 'bun run package' first.`);
  }
  const base = mkdtempSync(join(tmpdir(), "cx-verify-"));
  const lockFile = join(base, "ConvertX-Electrobun", "instance.json");
  console.log(`app-data base: ${base}`);
  let lastSupervisorPid = 0;

  try {
    // 1. First launch reaches healthy.
    launch(base);
    await waitFor("first instance healthy", 120_000, async () => {
      const lock = readLock(lockFile);
      return !!lock && (await pingOk(lock));
    });
    const lock1 = readLock(lockFile)!;
    lastSupervisorPid = lock1.pid;
    console.log(`OK first instance healthy (supervisor pid ${lock1.pid})`);

    await waitFor("child pid recorded in lock", 120_000, () => !!readLock(lockFile)?.convertxPid);
    const childPid1 = readLock(lockFile)!.convertxPid!;
    console.log(`OK convertx child pid recorded (${childPid1})`);

    // 2. Second launch exits fast; first instance keeps the lock and stays healthy.
    const second = launch(base);
    await waitFor("second launch to exit", 20_000, () => second.exitCode !== null);
    const lockAfter = readLock(lockFile)!;
    if (lockAfter.pid !== lock1.pid) throw new Error("second launch stole the instance lock");
    if (!(await pingOk(lockAfter))) throw new Error("first instance unhealthy after second launch");
    console.log("OK single instance (second launch exited; first still healthy)");

    // 3. Hard-kill the supervisor only (no /T): the child must survive as an
    //    orphan, and the NEXT launch must reap it.
    spawnSync("taskkill", ["/PID", String(lock1.pid), "/F"]);
    await Bun.sleep(2_000);
    if (!processAlive(childPid1)) {
      throw new Error("child died with the supervisor — orphan scenario not reproduced");
    }
    console.log("OK supervisor hard-killed; child survived as orphan");

    launch(base);
    await waitFor("relaunch healthy under a new pid", 120_000, async () => {
      const lock = readLock(lockFile);
      return !!lock && lock.pid !== lock1.pid && (await pingOk(lock));
    });
    lastSupervisorPid = readLock(lockFile)!.pid;
    await waitFor("orphaned child to be reaped", 30_000, () => !processAlive(childPid1));
    console.log("OK relaunch reaped the orphaned ConvertX");

    console.log("\nVERIFY-PACKAGED PASSED");
  } finally {
    const lock = readLock(lockFile);
    const pids = new Set([lock?.pid, lock?.convertxPid, lastSupervisorPid].filter(Boolean));
    for (const pid of pids) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    await Bun.sleep(1_000);
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(base, { recursive: true, force: true });
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
  }
}

main().catch((err) => {
  console.error(`\nVERIFY-PACKAGED FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
```

- [ ] **Step 2: Package and run it**

```powershell
bun run package
bun run scripts/verify-packaged.ts
```

Expected: the three `OK` lines and `VERIFY-PACKAGED PASSED`. (App windows appear briefly during the run.)

- [ ] **Step 3: Commit**

```powershell
git add scripts/verify-packaged.ts
git commit -m @'
test: add packaged-bundle integration checks (single instance, orphan reap)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 15: Docs, master-plan status, push

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-07-06-full-desktop-app-master-plan.md`

- [ ] **Step 1: Update README**

In the **Architecture** section, append after the existing numbered list:

```markdown
The supervisor also enforces desktop behavior: a single-instance lock (second
launches focus the running window), a token-authed loopback control server
(focus/restart/open-external), a Bun `--preload` shim that pins the ConvertX
server to 127.0.0.1, window-state persistence, one guarded auto-restart on
crashes (then an error page with a Restart button and the log path), and an
automatic refresh of the app-data ConvertX copy whenever the bundled
`vendor-manifest.json` changes (user `data\` is preserved). External links
open in the system browser. Converted files are kept for 7 days by default
(`CONVERTX_DESKTOP_AUTO_DELETE_HOURS` overrides; `0` disables cleanup).
```

In the **Data locations** section, extend the bullet list:

```markdown
- `instance.json` — single-instance lock (pid, control port, token, child pid)
- `window-state.json` — window bounds + maximized flag
- `logs\convertx.log` (+ `.1`) — rotating supervisor + ConvertX log
- `loopback-shim.ts` — generated Bun preload shim (pins the server to loopback)
```

Also update the stale sentence about forcing a refresh (the copy now refreshes automatically): replace "To force a fresh copy after re-vendoring ConvertX, delete `%APPDATA%\ConvertX-Electrobun\convertx` and relaunch." with "The copy refreshes automatically when the bundled vendor manifest changes; `data\` (uploads, output, DB) is preserved across refreshes."

- [ ] **Step 2: Update the master plan status line**

In `docs/superpowers/specs/2026-07-06-full-desktop-app-master-plan.md`, extend the Status line: after "Phase 0 complete (2026-07-06, …)" add "; Phase 1 complete (2026-07-06, plan: `../plans/2026-07-06-phase1-desktop-robustness.md`)".

- [ ] **Step 3: Final verification + push**

```powershell
bun run test
bun x tsc --noEmit
bun run scripts/smoke.ts
git add README.md docs/superpowers/specs/2026-07-06-full-desktop-app-master-plan.md
git commit -m @'
docs: document Phase 1 desktop-robustness behavior; mark phase complete

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
git push
```

Expected: all green, pushed.

---

## Self-review notes

- **Spec coverage:** control server (T5) — spec §3.1; single instance + reap (T6, wired T12) — §3.2; loopback shim (T7, smoke T13) — §3.3; stable port (T3) + healthcheck (T4) — §3.4; logger (T1) — §3.5; window state (T2, wired T12) — §3.6; refresh (T8) — §3.7; crash recovery + splash (T11, T12) — §3.8; link guard (T9, wired T12) — §3.9; retention (T7) — §3.10; packaged verification (T14) — §7. Refresh end-to-end (§7 last bullet) is covered at the unit level in T8; the packaged manifest-bump variant is exercised implicitly on the next real vendor bump.
- **Type consistency:** `ControlServer`/`startControlServer` (T5) used in T6 tests and T12; `InstanceLock` fields match T14's local `Lock`; `startConvertX` returns `{stop, pid}` (T7) consumed in T12; `ensureConvertxCopy(src, dest, manifestFile?, onStage?)` (T8) matches T12 and the unchanged 2-arg call in T13's smoke (valid — both extra params optional); `WindowState`/`clampToDisplays` (T2) match T12 imports.
- **Known judgment calls:** window `close` flushes the last captured state rather than re-reading the frame (research: frame reads during close are unreliable); `focus()` deprecated → `activate()`; error-page/interceptor POSTs use `mode:'no-cors'` (cross-origin to the control server, response unreadable by design).
