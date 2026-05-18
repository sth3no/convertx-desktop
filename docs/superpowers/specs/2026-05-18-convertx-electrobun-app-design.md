# ConvertX → Electrobun Desktop App — Design

- **Date:** 2026-05-18
- **Status:** Approved (design)
- **Target platform:** Windows 11 (cross-platform kept possible, not built this pass)

## 1. Goal

Turn ConvertX — a self-hosted, web-based file converter — into a native Windows
desktop application using Electrobun. This pass delivers a **runnable dev app**:
it launches through the Electrobun dev workflow as a native window, boots ConvertX
behind it, opens already authenticated, and performs real conversions using a
curated set of bundled converter binaries.

## 2. Background

### ConvertX (github.com/C4illin/ConvertX)

A self-hosted file converter. Stack: TypeScript on the **Bun** runtime, **Elysia**
web framework, server-rendered JSX UI (`@kitajs/html`), **SQLite** database, JWT
auth. It performs conversions by shelling out to ~25 external CLI tools and is
normally shipped as a multi-GB Debian Docker image.

Confirmed details (from source inspection):

- Server entry is `src/index.tsx`; it listens on `process.env.PORT || 3000`.
- All state is written to a **relative** `./data/` directory
  (`./data/uploads/`, `./data/output/`, plus the SQLite database file).
- Authentication is implemented in a `user` Elysia plugin (`.use(user)`).
- Environment variables it reads: `PORT`, `NODE_ENV`, `WEBROOT`,
  `AUTO_DELETE_EVERY_N_HOURS`, `ACCOUNT_REGISTRATION`, `JWT_SECRET`.
- It builds with its own toolchain (TypeScript compile + Tailwind CSS); the
  production entry is `dist/src/index.js`.

### Electrobun (github.com/blackboardsh/electrobun)

A Bun-based cross-platform desktop framework. Supports Windows 11+, macOS 14+,
Ubuntu 22.04+. Scaffolded with `npx electrobun init`, configured via
`electrobun.config.ts`, bundles the Bun runtime (~14 MB baseline). A
`BrowserWindow` can load bundled `views://` assets **or any URL**, including a
local HTTP server. Main process and webviews communicate over typed RPC.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Converter binaries | Bundle a **curated set**: FFmpeg, ImageMagick, Pandoc, Ghostscript, Poppler, resvg, potrace, vtracer. Exclude the multi-GB tools (LibreOffice, Calibre, TeXLive). |
| Scope | **Runnable dev app** — launches via the Electrobun dev workflow, verified with a real conversion. No packaged installer this pass. |
| Auth / first-run | **Auto-login** — first run seeds a local account; the window always opens authenticated, no login screen. |
| Process model | **Approach A — subprocess supervisor** (see §5). |

## 4. Architecture overview

This directory (`C:\Users\PC\Projects\ConvertX`) becomes the **Electrobun app**.
ConvertX is vendored inside it as a near-pristine clone.

```
ConvertX/
├─ electrobun.config.ts          app metadata + build config
├─ package.json                  Electrobun app dependencies
├─ tsconfig.json
├─ .gitignore
├─ scripts/
│  ├─ setup.ts                   clone + build ConvertX, fetch converters
│  └─ fetch-converters.ts        download curated Windows binaries
├─ src/
│  ├─ bun/                       main process (the supervisor)
│  │  ├─ index.ts                entry: orchestrate boot, create window
│  │  ├─ paths.ts                app-data directory resolution
│  │  ├─ port.ts                 free TCP port allocation
│  │  ├─ health.ts               poll ConvertX URL until ready
│  │  ├─ convertx-process.ts     spawn + teardown of the ConvertX child
│  │  └─ bootstrap.ts            first-run JWT secret + account seed
│  └─ mainview/
│     ├─ index.html              splash / loading + error view
│     └─ index.ts                splash view script (RPC target)
├─ vendor/
│  ├─ convertx/                  git clone of C4illin/ConvertX
│  └─ converters/win/            bundled curated Windows binaries
└─ docs/superpowers/specs/       this document
```

The Electrobun app and ConvertX stay **decoupled**: ConvertX keeps its own
`package.json`, dependencies, and build pipeline. The Electrobun app treats
ConvertX as an external process it supervises.

## 5. Approach: subprocess supervisor

Electrobun's Bun main process acts as a **thin supervisor**. It spawns ConvertX
as a separate child Bun process and points a `BrowserWindow` at it.

**Why this over the alternatives:**

- **A — Subprocess supervisor (chosen).** ConvertX builds and runs exactly as
  upstream intends. Crashes are isolated from the window process. Only one small
  ConvertX source patch is needed; port and data location are controlled via
  environment and working directory. Updating ConvertX later is a re-clone.
- **B — In-process embed** (import ConvertX's Elysia app into the Electrobun
  process). Rejected: ConvertX's Tailwind + JSX + static-serving build would have
  to be merged into Electrobun's `Bun.build` config, dependency versions could
  collide, and a ConvertX crash would take the window down with it.
- **C — Thin client** (webview pointed at a Docker-hosted ConvertX). Rejected
  when the curated-bundle converter strategy was chosen over running Docker.

## 6. Components

Each component is a small, independently testable unit.

### 6.1 `src/bun/paths.ts` — app-data paths
- **Purpose:** resolve and create the OS app-data directory tree.
- **Interface:** `getAppPaths()` → `{ dataDir, jwtSecretFile, firstRunMarker }`.
- **Behavior:** base directory is `%APPDATA%\ConvertX-Electrobun\` on Windows;
  ensures it exists. ConvertX's child process uses `dataDir` as its working
  directory so its relative `./data/` lands inside it.
- **Depends on:** Node `os`/`path`/`fs`.

### 6.2 `src/bun/port.ts` — free port allocation
- **Purpose:** find an open loopback TCP port.
- **Interface:** `findFreePort()` → `Promise<number>`.
- **Behavior:** binds an ephemeral port, reads it, releases it, returns the
  number. Avoids collisions with anything already on 3000.

### 6.3 `src/bun/convertx-process.ts` — ConvertX process manager
- **Purpose:** start and stop the ConvertX child process.
- **Interface:** `startConvertX(opts)` → `{ url, stop() }`.
- **Behavior:** spawns `bun run vendor/convertx/dist/src/index.js` with:
  - `cwd` = app-data `dataDir`
  - env: `PORT`, `WEBROOT=/`, `NODE_ENV=production`, `JWT_SECRET`,
    `DESKTOP_MODE=1`, and `PATH` prefixed with the bundled converter directories
  - stdout/stderr captured for diagnostics.
  On `stop()` it terminates the **whole child process tree** (no orphans).
- **Depends on:** `Bun.spawn`, §6.1, §6.2.

### 6.4 `src/bun/health.ts` — health check
- **Purpose:** wait until ConvertX is serving.
- **Interface:** `waitForHealth(url, timeoutMs)` → `Promise<void>`.
- **Behavior:** polls `url` until it responds; rejects on timeout so the
  supervisor can show an error instead of a blank window.

### 6.5 `src/bun/bootstrap.ts` — first-run / auth bootstrap
- **Purpose:** make the app open already authenticated.
- **Interface:** `ensureFirstRun(url, paths)` → `Promise<void>` (idempotent).
- **Behavior:** on first run, generate a stable random `JWT_SECRET` and persist
  it to `jwtSecretFile`; seed one local account via ConvertX's first-account
  setup route; write the first-run marker. On later runs it is a no-op.

### 6.6 ConvertX source patch — `DESKTOP_MODE`
- **Purpose:** skip the login screen for the local desktop user.
- **Change:** in ConvertX's `user` auth plugin, when `process.env.DESKTOP_MODE`
  is set and the request has no valid session, resolve the seeded local account
  instead of redirecting to `/login`.
- **Constraint:** this is the **only** expected ConvertX source change. It is a
  minimal, clearly-marked, tracked diff. The exact file/symbol is confirmed
  against ConvertX's auth source during implementation.

### 6.7 `src/bun/index.ts` — supervisor entry
- **Purpose:** orchestrate boot and own the window.
- **Behavior:** see §7. Creates the `BrowserWindow`, runs the startup sequence,
  registers teardown on app quit / last-window-closed.

### 6.8 `src/mainview/` — splash view
- **Purpose:** show a loading state while ConvertX boots; show a readable error
  if boot fails.
- **Behavior:** window opens at `views://mainview/index.html`. On success the
  supervisor swaps the webview to the ConvertX URL. On failure the supervisor
  sends the captured error over Electrobun RPC and the splash renders it.

### 6.9 `scripts/fetch-converters.ts` — converter acquisition
- **Purpose:** populate `vendor/converters/win/` with the curated binaries.
- **Behavior:** downloads official Windows release builds of FFmpeg, ImageMagick,
  Pandoc, Ghostscript, Poppler, resvg, potrace, vtracer; lays them out so each
  tool is reachable on `PATH` **under the command name ConvertX invokes** (see
  §8 — the Windows binary names differ from the Linux names ConvertX expects).

### 6.10 `scripts/setup.ts` — one-shot project setup
- **Purpose:** make the repo runnable from a fresh clone.
- **Behavior:** clone `C4illin/ConvertX` into `vendor/convertx/`, run its
  `bun install` and build, apply the `DESKTOP_MODE` patch, and run
  `fetch-converters.ts`.

### 6.11 `electrobun.config.ts` — build config
- **Purpose:** Electrobun app metadata and build entrypoints.
- **Contents:** `app.name = "ConvertX"`, an `app.identifier`, `build.bun.entrypoint
  = src/bun/index.ts`, `build.views.mainview`, and `build.copy` for the splash
  HTML. Structured so that packaging (`vendor/` resources, `asarUnpack`) can be
  added later without restructuring.

## 7. Startup sequence

1. Electrobun launches `src/bun/index.ts` (the supervisor).
2. Open a `BrowserWindow` at `views://mainview/index.html` (splash).
3. `getAppPaths()` resolves/creates the app-data directory.
4. `findFreePort()` picks a free loopback port.
5. Read or generate-and-persist `JWT_SECRET`.
6. `startConvertX()` spawns the ConvertX child (env + `cwd` + converter `PATH`).
7. `waitForHealth()` polls until ConvertX responds, or times out.
8. `ensureFirstRun()` seeds the local account on first launch.
9. On success: swap the webview to `http://127.0.0.1:<port>/` — opens
   authenticated thanks to `DESKTOP_MODE`.
10. On failure: send the captured error to the splash view via RPC.
11. On app quit / last window closed: `stop()` terminates the ConvertX child tree.

## 8. Converter bundling

Curated set, placed in `vendor/converters/win/`: **FFmpeg, ImageMagick, Pandoc,
Ghostscript, Poppler, resvg, potrace, vtracer**. The supervisor prepends each
tool's directory to the child process `PATH`. ConvertX auto-detects which
converters are present, so exactly these light up.

**Known gotcha — command names.** ConvertX invokes tools by their Linux names
(e.g. `gs`, `magick`/`convert`). Some Windows builds differ — Ghostscript ships
as `gswin64c.exe`. `fetch-converters.ts` normalizes this: each tool is exposed
on `PATH` under the exact name ConvertX calls (via copy/rename or a thin wrapper).

Excluded by decision: **LibreOffice, Calibre, TeXLive** (multi-GB). Conversions
that need them are simply unavailable; ConvertX degrades gracefully.

## 9. Auth & first-run

ConvertX requires an account and a JWT login. For a single-user local desktop
app the window should open straight into the converter:

- First run: `bootstrap.ts` generates and persists a stable `JWT_SECRET` and
  seeds one local account through ConvertX's first-account setup flow.
- The `DESKTOP_MODE` patch (§6.6) makes ConvertX's auth guard resolve that
  seeded account for local requests instead of redirecting to `/login`.
- The ConvertX server binds to `127.0.0.1` only — it is never exposed off-host.

Net effect: no login screen, ever; the account system stays intact underneath.

## 10. Data & configuration

All persistent state lives under `%APPDATA%\ConvertX-Electrobun\`:

- `data/` — ConvertX's SQLite database, uploads, and outputs (created by
  ConvertX because the child runs with `cwd` set here — **no patch needed**).
- `jwt-secret` — persisted secret so sessions survive restarts.
- `first-run-done` — marker so account seeding runs once.

## 11. Error handling

- **Port collision:** avoided by `findFreePort()`.
- **ConvertX fails to start / times out:** `waitForHealth()` rejects; the
  supervisor shows the captured stderr in the splash view rather than a blank
  window.
- **Orphan processes:** `stop()` kills the child process tree on every exit path.
- **Missing converters:** handled by ConvertX itself — it only offers conversions
  whose tools it can find.

## 12. Testing strategy

The supervisor modules are the only genuinely new code; build them test-first:

- `findFreePort()` — returned port is bindable; concurrent calls differ.
- `getAppPaths()` — returns expected paths and creates directories.
- `waitForHealth()` — resolves against a live stub server; rejects on timeout.
- `ensureFirstRun()` — idempotent; a second run is a no-op.
- `convertx-process` teardown — after `stop()` no child PID remains alive.

**End-to-end (manual) verification** — see §13.

## 13. Definition of done (this pass)

1. From a fresh state, `scripts/setup.ts` then the Electrobun dev command
   launches a native desktop window.
2. ConvertX boots behind the splash and the window swaps to it.
3. The window opens **already authenticated** — no login screen.
4. A real conversion succeeds end-to-end, output downloadable:
   - PNG → JPG via ImageMagick
   - MP4 → GIF via FFmpeg
5. Closing the app leaves no orphaned ConvertX/Bun process.
6. Supervisor unit tests (§12) pass.

## 14. Out of scope (this pass)

- Packaged `.exe` / installer, code signing, auto-update.
- macOS and Linux builds.
- The heavy converters (LibreOffice, Calibre, TeXLive).
- Any ConvertX feature/UI redesign — its UI is used as-is.

## 15. Open items to verify during implementation

- Exact file and symbol of ConvertX's `user` auth guard, and its first-account
  setup route (needed for §6.5 and §6.6).
- Whether ConvertX's first-account setup needs `ACCOUNT_REGISTRATION=true` set
  for the seed call.
- Confirmation that ConvertX's served CSS requires the Tailwind build step
  (assumed yes — setup runs ConvertX's full build).
- Exact command names ConvertX invokes for each bundled converter, to drive the
  name-normalization in `fetch-converters.ts`.
- Which Bun binary runs the child in dev (system `bun`); revisit when packaging.
