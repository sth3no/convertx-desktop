# File Handoff ("Open with ConvertX") Plumbing: Design

- **Date:** 2026-07-07
- **Status:** Approved (design)
- **Parent:** master plan Phase 5 (file associations); backend part of the engine layer. The Inno registry entries and the frontend consumption UI are separate, delegable work (see the plans referenced from the master plan).

## 1. Problem and key finding

"Open with ConvertX" needs file paths to reach the app. **Empirically verified 2026-07-07: Electrobun's `launcher.exe` does not forward its argv to `bun.exe`** (live `Win32_Process` command-line inspection; upstream issue #483). Files can therefore never arrive via the launcher.

**Workaround:** shell associations invoke the supervisor directly — `"{app}\bin\bun.exe" "{app}\Resources\main.js" "%1"`. That works only if the supervisor stops depending on its working directory: Electrobun's `PATHS.RESOURCES_FOLDER` is resolved from `process.cwd()` at import time, and shell-launched processes inherit arbitrary cwds.

## 2. Design

- **`src/bun/bootstrap-cwd.ts`** — side-effect module, imported *first* in `index.ts` (before any `electrobun/bun` import): if `dirname(process.execPath)` has a sibling `..\Resources` dir (i.e. we are the packaged bundle's `bin\bun.exe`), `process.chdir()` to the bin dir. Normalizes every launch path (launcher, direct, association); no-ops in dev and project-root runs.
- **`pickVendorDir`** additionally gets an execPath-derived candidate (`<execdir>\..\Resources\app\vendor`) — belt-and-suspenders independent of cwd.
- **`src/bun/pending-files.ts`** — a small queue: `add(paths)` (keeps only existing, absolute-resolved files), `peek()`, `claim()` (drain). Fed by argv at boot and by second instances; consumed by the frontend.
- **Argv capture:** on boot, args after the script path that resolve to existing files are queued (`extractFileArgs(argv, cwd)`).
- **Second instance:** before the exit-after-focus, POST its file args to the running instance's control server (`/enqueue-files`, JSON body).
- **API routes:** `GET /pending-files` → `{files}` (peek); `POST /pending-files/claim` → `{files}` (drain); `POST /enqueue-files` (body `{files: string[]}`) → `{queued: n}`. The frontend polls `/pending-files` (or claims on load/focus) and performs the actual upload through the ConvertX page session — the shell cannot upload on the page's behalf (session cookies live in the webview).

## 3. Testing

Unit: queue semantics (existing-file filter, drain, dedup), argv extraction (flags/URLs/non-files ignored, relative paths resolved). Packaged (verify-packaged): direct `bun.exe Resources\main.js <file>` launch **from a foreign cwd** boots healthy and lists the file in `/pending-files`; a second direct launch with another file exits and the first instance's queue gains it.

## 4. Out of scope

Inno `[Registry]` association entries and the frontend upload flow (delegated plans); drag-onto-exe uses the same argv path automatically.
