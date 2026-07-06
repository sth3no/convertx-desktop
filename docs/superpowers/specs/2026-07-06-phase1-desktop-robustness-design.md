# Phase 1 — Desktop Robustness: Design

- **Date:** 2026-07-06
- **Status:** Approved (design)
- **Parent:** `2026-07-06-full-desktop-app-master-plan.md` Phase 1 (scope locked there)
- **User decisions (2026-07-06):** converted-file retention 7 days (168 h); crash recovery = one guarded auto-restart, then error page with Restart button.

## 1. Goal

Close the "seams" a desktop user hits in normal use: second launches, crashes, hard kills, upgrades, disappearing files, lost window positions, links hijacking the window, and a LAN-exposed unauthenticated server. All changes live in the shell; ConvertX remains vendored unmodified.

## 2. Grounding (verified against Electrobun 1.18.1 sources and live FFI probes)

- `BrowserWindow`: `getFrame()` (sync truth), `setFrame(x,y,w,h)`, `activate()` (raise; `focus()` is deprecated), `unminimize()`, `isMinimized()`, `maximize()`/`isMaximized()`. Events `resize` (payload carries full frame), `move` (`{x,y}` only), `close` (no frame). No maximize/minimize events — query synchronously inside the resize handler, and skip saving bounds while maximized.
- `Screen.getAllDisplays()` returns `{bounds, workArea, scaleFactor, isPrimary}` per display (live-verified, taskbar excluded from workArea; empty array/zeroed display = "no info", never clamp to it).
- **`will-navigate` cannot cancel navigation** — the event pipeline is fire-and-forget; `event.response` is never read. The only native gate is `setNavigationRules()` whose rule syntax is undocumented. `window.open`/`target=_blank` produce no event on Windows. Download events never fire on Windows.
- `webview.executeJavascript(js)` is a reliable fire-and-forget Bun→view channel; full RPC requires a bundled view script + `Electroview` and has a 1 s default request timeout, and is unavailable on `loadHTML` pages (our error page).
- `Utils.openExternal(url)` confirmed working on Windows (dlopen-verified).
- **`Bun.serve({port})` binds `0.0.0.0`** and ignores `HOSTNAME` (empirically verified). ConvertX calls `app.listen(PORT)` with no hostname — today the unauthenticated server is reachable from the LAN.

## 3. Architecture

One new backbone plus focused modules. All writable state stays under `%APPDATA%\ConvertX-Electrobun\`.

### 3.1 Control server (`src/bun/control.ts`) — the backbone

A tiny `Bun.serve` HTTP server on `127.0.0.1`, random port, guarded by a per-run random token (query param). Endpoints:

| Endpoint | Caller | Action |
|---|---|---|
| `GET /ping` | second instance | returns `{app:"convertx-desktop", pid}` — proves the lock owner is really us (immune to PID reuse) |
| `POST /focus` | second instance | `unminimize()` if minimized, then `activate()` |
| `POST /restart` | error page button | tear down the ConvertX child and re-run the boot sequence |
| `POST /open-external?url=…` | injected link interceptor | validates `http(s)://` + external host, then `Utils.openExternal(url)` |

Every endpoint 403s without the correct token. One mechanism serves single-instance focus, crash recovery, and link interception; Phase 5 file-handoff will reuse it.

### 3.2 Single instance + orphan reaping (`src/bun/instance.ts`)

Lock file `instance.json`: `{pid, controlPort, token, convertxPid?}`.

- **Boot:** if a lock exists, `GET /ping` it. Alive → `POST /focus`, exit 0 (before any app-data mutation, which also eliminates the concurrent-first-copy race on `convertx.partial`). Dead/unreachable → stale: **reap** any recorded `convertxPid` (only if `tasklist` reports its image name as `bun.exe` — PID-reuse guard), then take over the lock.
- After spawning ConvertX, record `convertxPid` in the lock. Remove the lock on clean exit.

### 3.3 Loopback enforcement (`src/bun/convertx.ts`)

The supervisor writes a constant shim to app-data (`loopback-shim.ts`) and spawns `bun --preload <shim> run src/index.tsx`. The shim wraps `Bun.serve` so `hostname` defaults to `127.0.0.1` (explicit upstream hostname would still win — none is set today). Vendored source untouched. The smoke test asserts via `netstat` that the port listens on `127.0.0.1` only.

### 3.4 Stable port (`src/bun/port.ts`) + real health check (`src/bun/health.ts`)

- `resolvePort()`: try binding the preferred port **17843** (uncommon, keeps the webview origin — localStorage etc. — stable across launches); if taken, fall back to the current random free port.
- `waitForHealth` polls `GET <url>healthcheck` and requires HTTP 200 with body JSON `{status:"ok"}` (ConvertX's real endpoint) — a port squatter or unrelated server no longer passes; the child-failure race is unchanged.

### 3.5 Logging (`src/bun/logger.ts`)

`createLogger(logsDir)` → `{log(line), logPath}`. Appends timestamped lines to `logs\convertx.log`; rotates at 1 MB to `convertx.log.1` (one generation). The supervisor tees its own events and all child stdout/stderr through it (console output kept for dev). The error page shows `logPath`.

### 3.6 Window state (`src/bun/window-state.ts`)

`window-state.json`: `{x, y, width, height, maximized}`.

- Restore: clamp saved frame against `Screen.getAllDisplays()` work areas (a frame whose title-bar strip intersects no display, or empty display info → default 1100×800 at 150,100); create the window with it; `maximize()` after creation if saved.
- Persist: debounced (500 ms) `resize`/`move` handler; on fire, read `getFrame()` and `isMaximized()`; only overwrite stored bounds when not maximized (the maximized flag is always updated). `close` carries no frame, so the debounced write is the source of truth; flush pending state on close.

### 3.7 App-data ConvertX refresh (`src/bun/bundle.ts`)

`ensureConvertxCopy` v2, driven by the Phase 0 vendor manifest:

- The copy records the manifest it was created from at `<copy>\.vendor-manifest.json`.
- Boot compares the bundle's `vendor/vendor-manifest.json` with the recorded one. Equal → no-op. Missing/different → **staged refresh preserving user data**: copy new ConvertX to `convertx.partial` (excluding `data/`, `.git`), move the old copy's `data\` into the partial (rename), swap directories, write the new marker. Interrupted refresh self-heals exactly like the existing first-run copy (stale `.partial` discarded).
- First run (no copy) behaves as today, plus writes the marker.

### 3.8 Crash recovery + splash status (`src/bun/index.ts`, `src/mainview/*`)

- Boot refactored into a restartable `startServer()`; the supervisor tracks child lifecycle.
- Unexpected child exit: if no auto-restart happened in the last 10 minutes → log, show splash ("Restarting the converter…"), restart silently once. Otherwise → error page with the exit info, stderr tail, `logPath`, and a **Restart** button (`fetch` to control `/restart`, token embedded).
- Splash gains an inline `window.__setSplashStatus(text)`; the supervisor pushes stage updates via `executeJavascript` ("Preparing ConvertX (first run)…", "Updating ConvertX…", "Starting the converter…"). First-run copy takes ~10–30 s — no more silent spinner.
- Faster fast-fail stays as-is structurally (child crash already races the 45 s health ceiling); the real fix users feel is the status text.

### 3.9 External link guard (`src/bun/linkguard.ts`)

- `isExternalUrl(url, appOrigin)`: anything not on `http://127.0.0.1:<port>` (and not `views://`) is external; `mailto:`/other schemes count as external.
- Primary: after each `did-navigate`/`dom-ready`, inject (idempotent) a capture-phase click interceptor via `executeJavascript`: external anchor click → `preventDefault()` → `fetch(controlUrl + "/open-external?token=…&url=…")`. Handles plain and `target=_blank` links (ConvertX is server-rendered; re-inject per navigation).
- Fallback: `will-navigate` watcher — if an external URL slips through, immediately `loadURL(appUrl)` back and `openExternal` the URL. (Cancellation is impossible; this is correction, not prevention.)
- `setNavigationRules` is not used (undocumented syntax); if it gains docs, it can be added as a third layer later.

### 3.10 Desktop-sane defaults (`src/bun/convertx.ts`)

`buildConvertxEnv` sets `AUTO_DELETE_EVERY_N_HOURS` to `CONVERTX_DESKTOP_AUTO_DELETE_HOURS` (host env passthrough) or `"168"` (7 days, per user decision). Everything else unchanged.

## 4. Alternatives considered

- **Electrobun RPC for view↔bun** — rejected: needs view bundling + `Electroview`, 1 s default timeout, and cannot serve the `loadHTML` error page; the control server is one mechanism for three consumers and is plain-HTTP testable.
- **Windows Job Object for orphan cleanup** — rejected for now: requires `bun:ffi` against kernel32 with real crash-surface; PID-file reap with image-name verification covers the realistic case (supervisor hard-killed, child survives) and is trivially testable. Revisit only if reaping proves insufficient.
- **`setNavigationRules` for link blocking** — rejected as primary: syntax undocumented in 1.18.1 and the constructor option is a silent no-op; DOM interception + navigate-back fallback is verifiable.
- **Patching ConvertX for loopback binding** — avoided: the `--preload` shim achieves it with zero vendored-source changes.

## 5. Data locations (all under `%APPDATA%\ConvertX-Electrobun\`)

| File | Purpose |
|---|---|
| `instance.json` | single-instance lock: pid, control port, token, child pid |
| `window-state.json` | window bounds + maximized |
| `logs\convertx.log`(`.1`) | rotating supervisor + child log |
| `loopback-shim.ts` | generated Bun preload shim |
| `convertx\` + `convertx\.vendor-manifest.json` | running copy + its provenance marker |
| `jwt-secret` | unchanged |

## 6. Error handling

- Control server fails to start → boot continues without it (single instance degrades to lock-file-only pid probe; restart button hidden); logged.
- `tasklist`/`taskkill` failures during reap → logged, boot continues (never block startup on cleanup).
- Refresh swap failure mid-way → `.partial` discarded next boot; worst case the old copy keeps running (data preserved by construction: `data\` is moved only after the new copy is fully staged).
- Clamp with no display info → default frame.
- All error paths write to the log file; the error page names it.

## 7. Testing

- **Unit (bun test):** control-server endpoints incl. bad-token 403s; lock acquire/steal/secondary flows against a fake control server; reap image-name guard (fake tasklist output); logger rotation; clamp math (off-screen, multi-monitor negative coords, empty displays); refresh manifest-compare + data-preservation (temp dirs); `isExternalUrl`; env retention default/override; preferred-port fallback.
- **Smoke (extended):** boots via the same spawn path as production (shim included) and asserts `netstat` shows `127.0.0.1:<port>` and not `0.0.0.0:<port>`; healthcheck-based readiness.
- **Packaged integration script (`scripts/verify-packaged.ts`):** against the built bundle — launch, wait healthy; second launch exits ≤5 s (single instance); hard-kill supervisor (`taskkill /F` without `/T`), verify child survives, relaunch, verify old child reaped; verify `window-state.json` and `instance.json` lifecycle. (Focus/raise itself is visually confirmed — not scriptable headlessly.)
- **Refresh end-to-end:** bump a byte in a temp bundle's vendor manifest, relaunch, assert copy refreshed and `data\` preserved.

## 8. Out of scope (later phases)

Tray, notifications, settings UI, file associations/argv handoff (control server is ready for it), download routing (Windows fires no events), installer/signing/auto-update, app-data dir rename.

## 9. Risks

- Electrobun `--preload` flag position (`bun --preload X run …`) must be verified at implementation; fallback is `bunfig.toml` written next to the copy (still zero vendored-source changes).
- Windows Firewall may still prompt once for loopback-only binds in rare configurations; loopback binding makes approval irrelevant to functionality.
- `did-navigate` timing vs. DOM readiness: interceptor installs a document-level listener (safe pre-DOM-content); `dom-ready` re-injection covers the rest; idempotence flag prevents double handlers.
- Debounced persistence can lose the last ≤500 ms of window movement on hard kill — acceptable.
