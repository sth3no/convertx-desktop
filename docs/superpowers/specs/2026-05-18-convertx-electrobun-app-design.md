# ConvertX → Electrobun Desktop App — Design

- **Date:** 2026-05-18
- **Status:** Approved (design) — revised after inspecting ConvertX source and Electrobun tooling
- **Target platform:** Windows 11 (cross-platform kept possible, not built this pass)

> **Revision note:** §15 of the original draft listed items to verify against
> ConvertX's source. They were verified. The findings *simplified* the design:
> ConvertX needs **zero source patches** (auth is handled by existing env vars),
> there is **no first-run account seeding**, and the curated converter set was
> corrected to ConvertX's actual converter tools. Those corrections are folded in
> below.

## 1. Goal

Turn ConvertX — a self-hosted, web-based file converter — into a native Windows
desktop application using Electrobun. This pass delivers a **runnable dev app**:
it launches through the Electrobun dev workflow as a native window, boots ConvertX
behind it, opens straight into the converter (no login), and performs real
conversions using a curated set of bundled converter binaries.

## 2. Background

### ConvertX (github.com/C4illin/ConvertX, v0.17.0)

A self-hosted file converter. Stack: TypeScript on the **Bun** runtime, **Elysia**
web framework, server-rendered JSX UI (`@kitajs/html`), **SQLite** (`bun:sqlite`),
JWT auth (`@elysiajs/jwt`). It runs conversions by shelling out (`execFile`) to
external CLI tools. Normally shipped as a multi-GB Debian Docker image.

Confirmed from source:

- Server entry `src/index.tsx`; listens on `process.env.PORT || 3000`.
- Bun runs `src/index.tsx` directly — `package.json` `bun-create.start` is
  `bun run src/index.tsx`. No build step is required to run it.
- All state is written to a **cwd-relative** `./data/` directory: SQLite DB
  `./data/mydb.sqlite`, `./data/uploads/`, `./data/output/`.
- Static assets are served by `@elysiajs/static` from a **cwd-relative** `public/`
  directory. When `NODE_ENV !== "production"`, the Tailwind CSS file is generated
  at runtime from the cwd-relative `./src/main.css`.
- **Auth:** an Elysia `auth` macro guards most routes. ConvertX already supports
  an unauthenticated mode via two env vars (see §9) — **no patch is needed.**
- Env vars it reads: `PORT`, `NODE_ENV`, `WEBROOT`, `JWT_SECRET`,
  `ACCOUNT_REGISTRATION`, `ALLOW_UNAUTHENTICATED`, `UNAUTHENTICATED_USER_SHARING`,
  `HTTP_ALLOWED`, `AUTO_DELETE_EVERY_N_HOURS`, `HIDE_HISTORY`, `MAX_CONVERT_PROCESS`.
- Converters are registered **statically** — ConvertX always offers every
  converter/format. It does **not** hide converters whose tool is missing; an
  unavailable tool simply makes that conversion fail at runtime (the converter
  catches the error and returns `"Failed, check logs"`).

### Electrobun (github.com/blackboardsh/electrobun, v1.18.1)

A Bun-based cross-platform desktop framework. Verified on this machine:

- Installs cleanly on Windows (`bun add electrobun`). On first CLI run it
  downloads a ~50 MB `win-x64` core (its own bundled `bun.exe`, `launcher.exe`,
  `WebView2Loader.dll`, etc.). Windows uses the system **WebView2** runtime.
- App layout: `src/bun/index.ts` (main process), `src/mainview/` (webview
  assets), `electrobun.config.ts` (config). Dev command: `electrobun dev`.
- `import { BrowserWindow } from "electrobun/bun"` → `new BrowserWindow({ title,
  url, frame: { width, height, x, y } })`. `win.webview.loadURL(url)` loads any
  URL including `http://127.0.0.1:…`; `win.webview.loadHTML(html)` loads inline
  HTML. The main process is a normal Bun process — `Bun.spawn` and `node:*` work.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Converter binaries | Bundle a **curated set**: FFmpeg, ImageMagick, Pandoc, dasel, resvg, potrace, vtracer — ConvertX's converter tools that have simple portable Windows binaries. Excludes the heavy tools (LibreOffice, Calibre, TeXLive, Inkscape, …). |
| Scope | **Runnable dev app** — launches via `electrobun dev`, verified with a real conversion. No packaged installer this pass. |
| Auth / first-run | **No login** — the window opens straight into the converter. Achieved with ConvertX's built-in env vars; no source patch. |
| Process model | **Approach A — subprocess supervisor** (see §5). |

## 4. Architecture overview

This directory (`C:\Users\PC\Projects\ConvertX`) is the **Electrobun app**.
ConvertX is vendored inside it, **completely unmodified**.

```
ConvertX/
├─ electrobun.config.ts          app metadata + build config
├─ package.json                  Electrobun app dependencies + scripts
├─ tsconfig.json
├─ .gitignore
├─ scripts/
│  ├─ setup-convertx.ts           clone + `bun install` ConvertX
│  ├─ fetch-converters.ts         download curated Windows binaries
│  └─ smoke.ts                    drive ConvertX over HTTP to verify conversions
├─ src/
│  ├─ bun/                        main process (the supervisor)
│  │  ├─ index.ts                 entry: orchestrate boot, own the window
│  │  ├─ paths.ts                 app-data dir resolution + data junction
│  │  ├─ port.ts                  free TCP port allocation
│  │  ├─ health.ts                poll ConvertX URL until ready
│  │  └─ convertx.ts              ConvertX child env assembly + spawn/teardown
│  └─ mainview/
│     ├─ index.html               splash shown while ConvertX boots
│     ├─ index.css
│     └─ index.ts                 splash view entrypoint (minimal)
└─ vendor/
   ├─ convertx/                   git clone of C4illin/ConvertX (UNMODIFIED)
   └─ converters/win/             bundled curated Windows binaries
```

`vendor/convertx/`, `vendor/converters/`, and the OS app-data directory are
git-ignored — they are populated by the setup scripts, not committed.

## 5. Approach: subprocess supervisor

Electrobun's Bun main process is a **thin supervisor**. It spawns ConvertX as a
separate child Bun process and points a `BrowserWindow` at it.

**Why this over the alternatives:**

- **A — Subprocess supervisor (chosen).** ConvertX runs exactly as upstream
  intends, as its own process, fully unmodified. Crashes are isolated from the
  window. Updating ConvertX is a clean re-clone.
- **B — In-process embed.** Rejected: merging ConvertX's Tailwind/JSX/static
  pipeline into Electrobun's build is fragile, dependency versions could collide,
  and a ConvertX crash would take the window down with it.
- **C — Thin client (Docker).** Rejected when the curated-bundle strategy was
  chosen over running Docker.

## 6. Components

Each component is a small, independently testable unit.

### 6.1 `src/bun/paths.ts` — app-data paths + data junction
- **Purpose:** resolve the OS app-data directory and link ConvertX's data into it.
- **Interface:** `getAppPaths()` → `{ appDataDir, dataDir, jwtSecretFile }`;
  `ensureDataJunction(convertxDir, dataDir)`.
- **Behavior:** app-data base is `%APPDATA%\ConvertX-Electrobun\`. `ensureDataJunction`
  makes `vendor/convertx/data` a Windows directory **junction** pointing at
  `<appDataDir>\data`, so ConvertX's cwd-relative `./data` physically lands in
  app-data with no ConvertX change. Idempotent; if `vendor/convertx/data` already
  exists it is left as-is.

### 6.2 `src/bun/port.ts` — free port allocation
- **Purpose:** find an open loopback TCP port.
- **Interface:** `findFreePort()` → `Promise<number>`.
- **Behavior:** binds an ephemeral port, reads it, releases it, returns it.

### 6.3 `src/bun/health.ts` — health check
- **Purpose:** wait until ConvertX is serving.
- **Interface:** `waitForHealth(url, timeoutMs)` → `Promise<void>`.
- **Behavior:** polls `url` until it responds; rejects on timeout.

### 6.4 `src/bun/convertx.ts` — ConvertX process manager
- **Purpose:** assemble the child environment and run/stop ConvertX.
- **Interface:** `buildConvertxEnv(opts)` → env record (pure, testable);
  `startConvertX(opts)` → `{ stop() }`.
- **Behavior:** spawns ConvertX with the supervisor's bundled Bun
  (`process.execPath`) running `vendor/convertx/src/index.tsx`, with:
  - `cwd` = `vendor/convertx/` (so `public/` and `./src/main.css` resolve;
    `./data` resolves through the junction to app-data)
  - env: `PORT`, `JWT_SECRET`, `ALLOW_UNAUTHENTICATED=true`,
    `UNAUTHENTICATED_USER_SHARING=true`, and `PATH` prefixed with
    `vendor/converters/win`
  - `NODE_ENV` left unset (non-production → Tailwind CSS generated at runtime,
    no pre-build needed)
  - stdout/stderr captured.
  `stop()` terminates the child.

### 6.5 `src/bun/index.ts` — supervisor entry
- **Purpose:** orchestrate boot and own the window.
- **Behavior:** see §7. Creates the `BrowserWindow`, runs the startup sequence,
  terminates the ConvertX child on exit.

### 6.6 `src/mainview/` — splash view
- **Purpose:** a loading screen while ConvertX boots.
- **Behavior:** window opens at `views://mainview/index.html` (static
  "Starting ConvertX…"). On success the supervisor calls
  `webview.loadURL(<convertx-url>)`. On failure it calls `webview.loadHTML(...)`
  with the captured error embedded.

### 6.7 `scripts/setup-convertx.ts` — vendor ConvertX
- **Behavior:** clone `C4illin/ConvertX` into `vendor/convertx/` (skip if present)
  and run `bun install` there. No build, no patching.

### 6.8 `scripts/fetch-converters.ts` — converter acquisition
- **Behavior:** download the curated tools (manifest-driven) into
  `vendor/converters/win/`, each exposed as `<command>.exe` matching the name
  ConvertX invokes (`ffmpeg`, `magick`, `pandoc`, `dasel`, `resvg`, `potrace`,
  `vtracer`). Best-effort: prints a per-tool success/failure summary.

### 6.9 `scripts/smoke.ts` — HTTP smoke test
- **Behavior:** drives a running ConvertX instance over HTTP (mimicking the
  browser cookie flow) to convert sample files, asserting the output is produced.
  Exercises the supervisor's env/PATH wiring without needing the GUI.

### 6.10 `electrobun.config.ts` — build config
- **Contents:** `app.{name,identifier,version}`, `build.bun.entrypoint =
  src/bun/index.ts`, `build.views.mainview`, `build.copy` for the splash assets,
  `runtime.exitOnLastWindowClosed = true`. The project root is injected for the
  supervisor via a `build.bun.define` entry computed from the config's own
  `import.meta.dir`.

## 7. Startup sequence

1. Electrobun launches `src/bun/index.ts` (the supervisor).
2. Open a `BrowserWindow` at `views://mainview/index.html` (splash).
3. Resolve app-data paths; ensure the `vendor/convertx/data` junction exists.
4. Read or generate-and-persist `JWT_SECRET`.
5. `findFreePort()` picks a free loopback port.
6. `startConvertX()` spawns the ConvertX child (env + cwd + converter `PATH`).
7. `waitForHealth()` polls until ConvertX responds, or times out.
8. On success: `webview.loadURL("http://127.0.0.1:<port>/")` — opens straight
   into the converter (unauthenticated mode, no login screen).
9. On failure: `webview.loadHTML(...)` with the captured error.
10. On app exit: terminate the ConvertX child.

## 8. Converter bundling

Curated set in `vendor/converters/win/`, chosen as ConvertX converter tools with
simple portable Windows binaries: **FFmpeg** (`ffmpeg`), **ImageMagick**
(`magick`), **Pandoc** (`pandoc`), **dasel** (`dasel`), **resvg** (`resvg`),
**potrace** (`potrace`), **vtracer** (`vtracer`). The supervisor prepends this
directory to the child `PATH`; ConvertX's converters call these via `execFile`,
which resolves `<name>` to `<name>.exe` on `PATH` on Windows.

**Known limitation.** ConvertX's UI lists *every* converter and format regardless
of what is installed (its converter registry is static). Conversions that need a
non-bundled tool (LibreOffice, Calibre, Inkscape, TeX, …) will appear in the UI
and **fail at runtime** with "Failed, check logs". This is acceptable for this
pass; hiding unavailable converters would require patching ConvertX and is out of
scope.

## 9. Auth — no login, no patch

ConvertX already supports the exact behaviour wanted, via env vars:

- `ALLOW_UNAUTHENTICATED=true` — the root page (`/`) skips the login/setup
  redirect, mints a JWT, sets the auth cookie, and renders the converter directly.
- `UNAUTHENTICATED_USER_SHARING=true` — pins that implicit user to a stable id
  (`0`) instead of a random id per page load, so conversion history persists
  across restarts.

With both set, opening `/` lands straight in the converter; the auth cookie it
sets satisfies the `auth` macro on every other route. **No ConvertX source change
is needed.** A stable `JWT_SECRET` is generated once and persisted in app-data so
cookies remain valid across restarts. The ConvertX server binds to `127.0.0.1`
only.

## 10. Data & configuration

All persistent state lives under `%APPDATA%\ConvertX-Electrobun\`:

- `data/` — ConvertX's SQLite DB, uploads, and outputs, reached via the
  `vendor/convertx/data` → `<appDataDir>\data` directory junction (§6.1).
- `jwt-secret` — persisted secret so sessions survive restarts.

## 11. Error handling

- **Port collision:** avoided by `findFreePort()`.
- **ConvertX fails to start / times out:** `waitForHealth()` rejects; the
  supervisor shows the captured stderr via `webview.loadHTML(...)` instead of a
  blank or stuck splash.
- **Child cleanup:** the ConvertX child is killed on supervisor exit.
- **Missing converters:** surfaced per-conversion by ConvertX (see §8).

## 12. Testing strategy

The supervisor modules are the only genuinely new code; build them test-first
with `bun test`:

- `port.ts` — `findFreePort()` returns a bindable port; two calls differ.
- `paths.ts` — `getAppPaths()` returns expected paths under a temp `APPDATA`.
- `health.ts` — `waitForHealth()` resolves against a live stub server; rejects
  on timeout.
- `convertx.ts` — `buildConvertxEnv()` produces the expected env (auth vars set,
  `PATH` prefixed with the converters dir, `PORT` set).

**Integration:** `scripts/smoke.ts` converts sample files through a supervised
ConvertX over HTTP. **Manual:** `electrobun dev` opens the window into the
converter (see §13).

## 13. Definition of done (this pass)

1. `bun install`, `bun run scripts/setup-convertx.ts`, and
   `bun run scripts/fetch-converters.ts` complete; `vendor/convertx/` and
   `vendor/converters/win/` are populated (FFmpeg + ImageMagick present).
2. `bun test` passes for the supervisor modules.
3. `electrobun dev` launches a native window; the splash shows, then the window
   loads ConvertX's converter UI — no login screen.
4. `scripts/smoke.ts` converts PNG → JPG (ImageMagick) and MP4 → GIF (FFmpeg)
   against the supervised instance and confirms output files are produced.
5. Closing the window terminates the ConvertX child (no orphaned Bun process).

## 14. Out of scope (this pass)

- Packaged `.exe` / installer, code signing, auto-update.
- macOS and Linux builds.
- The heavy converters (LibreOffice, Calibre, TeXLive, Inkscape, …).
- Hiding unavailable converters in ConvertX's UI.
- Any ConvertX feature/UI change — it runs unmodified.

## 15. Open items (verified — for awareness)

- ConvertX `src/index.tsx`, `pages/user.tsx`, `pages/root.tsx`, `helpers/env.ts`,
  `db/db.ts`, and the converter modules were inspected; the auth-via-env-vars and
  zero-patch conclusions above are based on that source (v0.17.0). A future
  ConvertX version could change these; re-check on upgrade.
- The supervisor resolves the project root from a `build.bun.define` value, with
  `process.cwd()` as a fallback; if neither resolves correctly under a given
  Electrobun version, bake the root explicitly.
- `fetch-converters.ts` uses release-artifact URLs that drift over time; treat a
  stale URL as routine version maintenance, not a design flaw.
