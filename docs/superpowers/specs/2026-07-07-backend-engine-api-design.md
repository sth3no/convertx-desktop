# Backend Engine + Local API: Design

- **Date:** 2026-07-07
- **Status:** Approved (design)
- **Parent:** master plan Phases 3 (update engine) + 4 (pack engine) + slices of 5 (settings, output folder). **UI is explicitly out of scope** — the user builds the frontend against the API this phase delivers.
- **Driving requirement (user, 2026-07-07):** "focus on the backend and engine logic so I can continue with creating a better frontend."

## 1. Goal

Everything a frontend needs, behind a documented local HTTP JSON API:

- **Updater engine**: check GitHub Releases → download the new installer with progress → verify against `SHA256SUMS.txt` → silent reinstall + relaunch (on demand or on quit).
- **Pack engine**: install/remove optional converter packs (pinned URL + sha256 registry) into app-data, wire them onto the ConvertX child's PATH, restart the child.
- **Settings store**: retention hours, update mode — persisted, applied to the child env.
- **API.md**: the complete frontend contract (auth, discovery, endpoints, status shapes, examples).

## 2. Architecture

The Phase 1 control server (loopback, random port, per-run token) grows from 4 ad-hoc endpoints into the app's API. Discovery: the injected page script (which already carries port+token for the link guard) now also sets `window.__convertxDesktop = { controlBase, token, version }` on every ConvertX page — any frontend running in the webview reads it and calls the API. The control server adds `Access-Control-Allow-Origin: <app origin>` (the API and the ConvertX UI are different loopback origins) so responses are readable; token stays in the query string, so every call is a CORS "simple request" (no preflight complications).

Engines are separate modules with injectable IO (fetch/spawn/fs) for unit testing; `control.ts` stays a thin authenticated router; `index.ts` wires them.

## 3. API surface (full contract in docs/API.md)

Existing: `GET /ping`, `POST /focus`, `POST /restart`, `POST /open-external?url=`.

| New endpoint | Behavior |
|---|---|
| `GET /info` | `{app, version, appOrigin, convertx: {status: "running"\|"starting"\|"error", port}, logPath}` |
| `GET /update/status` | updater state machine snapshot (see §4) |
| `POST /update/check` | force a check now; returns the new status |
| `POST /update/download` | start download+verify (no-op if not `update-available`) |
| `POST /update/apply` | quit + silent reinstall + relaunch (409 unless `ready`) |
| `GET /packs` | registry merged with installed state + per-pack operation status |
| `POST /packs/install?name=` | download → verify → extract → PATH rewire → child restart |
| `POST /packs/remove?name=` | delete pack dir → PATH rewire → child restart |
| `GET /settings` / `POST /settings` (JSON body) | read/update persisted settings |
| `POST /open-data-folder` | reveal ConvertX's `data\` dir in Explorer |
| `GET /logs/tail?lines=N` | last N log lines (frontend diagnostics view; N ≤ 500) |

POST bodies are JSON; responses are JSON with `{error}` + proper status codes on failure. Long operations (download, pack install) run async — the POST returns immediately and the frontend polls the status endpoint.

## 4. Updater engine (`src/bun/updater.ts`)

- **Version source:** `package.json` version, inlined at build time.
- **Check:** `GET api.github.com/repos/sth3no/convertx-desktop/releases/latest` (unauthenticated; drafts are invisible, so only published releases count). Compare semver-ish (split-numeric compare) against current; find the `ConvertX-Desktop-<v>-Setup.exe` asset and `SHA256SUMS.txt`.
- **State machine:** `idle → checking → up-to-date | update-available{version, publishedAt, notesUrl, sizeBytes} → downloading{received, total} → verifying → ready{installerPath, version} → installing` plus `error{message, at}` from any state. Snapshot served by `/update/status`.
- **Download:** streamed to `%APPDATA%\ConvertX-Electrobun\updates\` with byte progress; sha256-verified against the release's `SHA256SUMS.txt` line before `ready`. Stale files in `updates\` are cleaned on boot.
- **Apply:** spawn detached `cmd /c "<Setup.exe> /VERYSILENT /SUPPRESSMSGBOXES /NORESTART & start "" "<installed launcher.exe>""`, then quit cleanly (child stopped, lock removed) so the installer never needs to force-close anything. The `[Run]`-postinstall path stays silent-skipped; the `start` after the `&` relaunches the new version.
- **Cadence (settings-driven):** check on boot (after ConvertX is healthy) + every 24 h. `updateMode: "auto"` (default; per the user's Phase-1 "full auto-update" decision): auto-download when available, install-on-quit when `ready` (window close spawns the installer before quitting). `"notify"`: stop at `update-available`; the frontend drives download/apply.

## 5. Pack engine (`src/bun/packs.ts`, registry in `src/bun/pack-registry.ts`)

- **Registry (code-reviewed data):** per pack `{name, title, description, version, url, sha256, sizeBytes, kind: "zip", exeName, pathEntries?, unlocks}` — the same pinned-URL+hash discipline as the converter manifest. v1 ships packs whose portable Windows archives are verifiable today (libvips, libjxl; Inkscape if its archive URL proves stable during implementation). LibreOffice/Calibre/GraphicsMagick/Ghostscript ship no official portable archives — they join the registry later as pure data additions (documented in API.md); the master plan's ranking still holds.
- **Layout:** `%APPDATA%\ConvertX-Electrobun\packs\<name>\` + `.pack.json` marker `{name, version, sha256}` written only after successful extraction (torn installs self-heal: no marker → not installed → reinstallable).
- **Install:** download (progress) → sha256 verify → extract via system bsdtar (same tool as setup; present on Win10/11) into a `.partial` dir → verify `exeName` exists inside → rename into place → write marker → recompute child PATH → restart child (splash + `startServer`, the Phase 1 machinery). Remove: delete dir → rewire → restart.
- **PATH wiring:** `packPathEntries(packsDir)` mirrors `converterPathEntries` (each installed pack dir, its `pathEntries` subdirs, plus immediate subdirs containing the exe); appended after the vendor converters in `pathPrepend`.
- **Status:** per-pack `idle | downloading{received,total} | verifying | extracting | restarting | installed{version} | error{message}` merged into `GET /packs`.

## 6. Settings (`src/bun/settings.ts`)

`settings.json` in app-data: `{autoDeleteHours: number (default 168), updateMode: "auto"|"notify" (default "auto")}` — validated on load (bad file → defaults), atomic write. `autoDeleteHours` feeds `buildConvertxEnv` (precedence: settings > `CONVERTX_DESKTOP_AUTO_DELETE_HOURS` env > 168 default); changing it via the API restarts the child to take effect (the response says so). YAGNI: no other keys until a frontend needs them.

## 7. Wiring (`src/bun/index.ts`, `src/bun/linkguard.ts`, `src/bun/control.ts`)

- `control.ts` becomes a router: `startControlServer(handlers, routes)` where engines register `{method, path, handler(req) → Response|Promise}`; token check + CORS headers (`Access-Control-Allow-Origin: <appOrigin>`, set once the origin is known) + OPTIONS handling stay central. Existing 4 endpoints keep their exact shapes (the injected interceptor and instance.ts depend on them).
- `linkguard.ts` injection also sets `window.__convertxDesktop = {controlBase, token, version}` (frozen object) — the frontend's discovery mechanism, documented in API.md.
- `index.ts`: settings loaded at boot → env; pack PATH entries added to spawn; updater started post-health; install-on-quit hook in the window close path; child-restart requests from engines reuse `requestRestart`-style machinery (generalized to `restartConvertx(reason)` that engines call).

## 8. Error handling

Engines never throw across the API boundary: every operation resolves to a state (`error{message}` states are part of the contract). GitHub API failures → `error` with retry allowed; download hash mismatch → file deleted + `error` (never `ready` with a bad file); pack extraction failure → `.partial` discarded, marker untouched; settings write failure → previous settings kept in memory, error surfaced. All transitions logged to the Phase 1 log file.

## 9. Testing

- Unit (injectable IO): updater state machine against a local `Bun.serve` fixture faking the GitHub API + asset host (happy path, 404, hash mismatch, resume-from-error); apply spawns the right detached command (spawn injected, asserted, not executed). Pack install/remove against a fixture serving a real small zip (bsdtar exercised for real); marker/self-heal; PATH computation. Settings load/save/validate/precedence. Router: token, CORS headers, OPTIONS, unknown routes, JSON errors.
- Integration: extend `verify-packaged.ts` — after health, call `/info`, `/update/status` (expect a real check result against the live repo: `up-to-date` once v1.0.0 is published, `update-available` before), `/packs` (registry listed), `/settings` round-trip. Manual full-update test happens naturally on the next real release (v1.0.x → installed 1.0.0 updates itself).
- `bun run dev` spot-check: `window.__convertxDesktop` present on the ConvertX page.

## 10. Out of scope

Any UI (user's domain). winget manifest (needs the published release). Heavyweight pack entries without portable archives (data-only follow-ups). SSE/WebSocket push (polling suffices; revisit only if the frontend wants it). Delta updates (master plan §6.1 fast-follow).

## 11. Risks

- GitHub API rate limit (60/h/IP) — one check per boot + daily is far under it; `error` state degrades gracefully offline.
- Installer relaunch race (installer still copying when `start` fires) — mitigated: `cmd /c "A & B"` runs B only after A exits (`&` is sequential in cmd; the installer process itself waits for completion before exiting).
- Pack archive URL drift — same posture as converters: pinned URL + hash, `--record`-style helper script for maintenance, hash mismatch is a hard error.
- Child restart during an active conversion (pack install/settings change) — the API response warns; the frontend should confirm with the user before installing packs mid-conversion (documented in API.md).
