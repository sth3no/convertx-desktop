# ConvertX → Electrobun MVP — Standalone Packaged Build

- **Date:** 2026-05-19
- **Status:** Approved (design)
- **Builds on:** `2026-05-18-convertx-electrobun-app-design.md` (the dev build, now complete)
- **Target platform:** Windows 11

## 1. Goal

Turn the working *dev build* of the ConvertX Electrobun app into a **standalone
packaged Windows app** — a self-contained build the user runs by double-clicking,
with **no Bun install, no dev toolchain, no setup scripts, and no network access
required at runtime**. This is the MVP "version 1": a real, self-contained
product for the user's own machine.

## 2. Current state (the dev build)

The dev build is complete and verified: an Electrobun app whose Bun "supervisor"
(`src/bun/`) boots a vendored, unmodified ConvertX server as a child process and
shows it in a WebView2 window. It runs via `electrobun dev`. Limitations that
block "standalone":

- ConvertX (`vendor/convertx/`) and the converter binaries (`vendor/converters/`)
  are populated by dev-time scripts and are **git-ignored and excluded from any
  build** — a packaged app would not contain them.
- The supervisor locates `vendor/` via a **build-time absolute path** injected by
  `electrobun.config.ts` — invalid on any machine other than the build machine.
- ConvertX runs in **non-production mode**, generating its Tailwind CSS at runtime
  from its dev-dependencies.
- `electrobun build` (the packaging command) has never been run.

## 3. Decisions (locked)

| Decision | Choice |
|---|---|
| Distribution | Standalone packaged build for the user's own machine. **Unsigned; no installer; no auto-update; Windows only.** |
| ConvertX runtime in the package | **Production mode + Tailwind CSS pre-built at build time.** |
| Writable ConvertX location | **First-run copy** of ConvertX into `%APPDATA%`; ConvertX runs from there. Applied uniformly in dev and packaged builds; the dev build's data-junction is removed. |

## 4. Approach

The MVP is a **packaging project**: make `electrobun build` produce a bundle that
contains everything and runs anywhere. Five changes turn the dev build into a
standalone app. They are deliberately designed so **dev and packaged builds run
ConvertX through the same code path** — the packaged path is exercised every time
`electrobun dev` runs, so it cannot silently rot.

### 4.1 Build-time bundle preparation

Before `electrobun build`, the project must have a fully prepared `vendor/`:
ConvertX cloned + `bun install`ed **+ its Tailwind CSS compiled**
(`public/generated.css`), and `vendor/converters/win/` populated. The existing
`setup-convertx.ts` and `fetch-converters.ts` already do the clone/install/
download; the new piece is the **CSS compile**, which `setup-convertx.ts` is
extended to also perform. After this step the vendored ConvertX is production-ready.

### 4.2 Bundling `vendor/` into the app

`electrobun build` must place `vendor/convertx/` and `vendor/converters/win/`
inside the app bundle's resources. The converter executables and their DLLs must
remain **real on-disk files** (not packed inside an `asar` archive) so they can be
spawned and dynamically linked. The exact Electrobun mechanism (config `copy`
entries, a build-hook script, `asarUnpack`) is finalized in the implementation
plan (see §9).

### 4.3 Runtime path resolution

The supervisor must locate the bundled `vendor/` **relative to its own runtime
location**, not a build-time absolute path. It detects whether it is running:

- **dev** — `vendor/` sits at the project root; or
- **packaged** — `vendor/` sits in the app bundle's resources directory.

It resolves the bundled-ConvertX *source* and the converters directory
accordingly. The build-time `CONVERTX_PROJECT_ROOT` define is retired; the
supervisor resolves these paths at runtime, mode-aware.

### 4.4 First-run copy of ConvertX

On launch the supervisor ensures a **writable** ConvertX exists at
`%APPDATA%\ConvertX-Electrobun\convertx\`:

- If absent, it copies the bundled (read-only-safe) ConvertX there once.
- ConvertX then always runs from that app-data copy: working directory =
  `%APPDATA%\ConvertX-Electrobun\convertx\`, so `public/` (with the pre-built CSS)
  and `./data/` both resolve inside a writable location.

This removes the dev build's directory-junction entirely — `./data` is naturally
under the writable app-data directory because the working directory is. The same
logic runs in dev and packaged builds; the only difference is the *source* the
copy is taken from (project `vendor/` vs. bundle resources). To refresh ConvertX
after updating the vendored copy, the app-data copy is deleted and re-created on
next launch.

### 4.5 ConvertX runs in production mode

`buildConvertxEnv` sets `NODE_ENV=production` (instead of clearing it). In
production mode ConvertX serves the pre-built `public/generated.css` and never
invokes its runtime Tailwind toolchain. The Bun used to run ConvertX is the
Electrobun-bundled `bun.exe` (the supervisor's own `process.execPath`) — no system
Bun is needed.

## 5. Components affected

| File | Change |
|---|---|
| `scripts/setup-convertx.ts` | Also compile ConvertX's Tailwind CSS after install. |
| `electrobun.config.ts` | Bundle `vendor/convertx/` + `vendor/converters/win/` into the build; keep converter binaries unpacked. |
| `src/bun/bundle.ts` *(new)* | Resolve the bundled `vendor/` location (dev vs. packaged); perform the first-run copy of ConvertX into app-data. |
| `src/bun/paths.ts` | Add the app-data ConvertX-copy path; **remove `ensureDataJunction`** (no longer used). |
| `src/bun/convertx.ts` | `buildConvertxEnv` sets `NODE_ENV=production`. |
| `src/bun/index.ts` | Use `bundle.ts` for path resolution + first-run copy; run ConvertX from the app-data copy; drop the junction call. |
| `scripts/smoke.ts` | Mirror the supervisor: run ConvertX from the app-data copy, production env. |

Each `src/bun/` module keeps one clear responsibility; the new `bundle.ts`
isolates all dev-vs-packaged path logic so the rest of the supervisor is unaware
of which mode it is in.

## 6. Data & configuration

All writable state stays under `%APPDATA%\ConvertX-Electrobun\`:

- `convertx/` — the writable copy of ConvertX (first-run copy).
- `convertx/data/` — ConvertX's SQLite DB, uploads, and outputs (cwd-relative).
- `jwt-secret` — the persisted session secret.

The bundled (read-only) `vendor/` inside the app is treated as an immutable
source; nothing is written into it.

## 7. Error handling

Unchanged from the dev build: free-port selection, the `waitForHealth` timeout
showing a `loadHTML` error page with captured ConvertX stderr, and child cleanup
on supervisor exit. The known limitations recorded in the dev-build spec §11
(single-`kill` cleanup, ~45 s fast-fail) **remain** — see §10.

## 8. Definition of done

1. `bun run scripts/setup-convertx.ts` + `bun run scripts/fetch-converters.ts`
   leave `vendor/` fully prepared (ConvertX installed with compiled CSS,
   converters present).
2. `bun test src/bun` still passes.
3. `electrobun dev` still launches and works (the shared dev/packaged code path).
4. `electrobun build` completes and produces a packaged Windows app folder.
5. The produced app, launched by double-clicking its `.exe` **from a fresh
   location with no dev environment present**, opens the window, loads ConvertX's
   converter UI (no login), and converts a file (PNG → JPG) successfully.
6. Closing the app leaves no orphaned ConvertX process (existing behavior).

## 9. Out of scope (this MVP)

- Code signing / Windows SmartScreen; an installer; auto-update.
- App-icon / window-chrome polish.
- macOS and Linux builds.
- The robustness follow-ups (process-tree kill, faster fast-fail) — deferred,
  documented in the dev-build spec §11.
- Expanding the converter set beyond the bundled seven.

## 10. Open items (finalized in the implementation plan)

- The exact Electrobun `build` mechanism for copying directory trees into the
  bundle, and the `asar` / `asarUnpack` configuration for the converter binaries.
- The exact runtime API/technique for the supervisor to locate its own bundle
  resources directory in a packaged Electrobun app.
- Whether bundle preparation runs via an Electrobun `preBuild` hook or a manual
  step before `electrobun build`.
- Packaged app size, and whether pruning ConvertX's dev-dependencies
  (`bun install --production`) is worth doing for the MVP.
- Confirming a packaged app run from a non-writable location (e.g. `Program
  Files`) still works given the first-run-copy design.
