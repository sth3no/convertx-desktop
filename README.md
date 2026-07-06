# ConvertX Desktop

ConvertX Desktop — a standalone Windows 11 desktop app that packages the [ConvertX](https://github.com/C4illin/ConvertX)
self-hosted file converter inside an [Electrobun](https://electrobun.dev) shell. ConvertX is
vendored **unmodified** — no Docker, no login screen, and no network access needed at runtime.
Converter binaries (ffmpeg, ImageMagick, pandoc, …) are bundled alongside the app.

## Architecture

A Bun "supervisor" (`src/bun/index.ts`) drives everything:

1. Resolves the `vendor/` directory (`pickVendorDir` in `src/bun/bundle.ts`) from an ordered
   candidate list — in a packaged app it is baked into the bundle at `Resources/app/vendor`; in
   dev it is the project-root `vendor/`, reached relative to the built bundle's `Resources`
   folder (`electrobun dev` runs the launcher with cwd = the bundle's `bin` dir, not the project
   root); a cwd-based fallback covers running the supervisor directly from the project root.
2. On first run, copies `vendor/convertx` into a writable location:
   `%APPDATA%\ConvertX-Electrobun\convertx` (`ensureConvertxCopy`). ConvertX then runs with that
   copy as its cwd, so its `./data` (uploads, output, SQLite DB) lands in writable app-data.
3. Spawns ConvertX (`bun run src/index.tsx`) on a free loopback port with the bundled converter
   binaries prepended to `PATH` (`src/bun/convertx.ts`). It runs in ConvertX's built-in
   unauthenticated mode (`ALLOW_UNAUTHENTICATED=true`) with `NODE_ENV=production`, serving the
   Tailwind CSS pre-built at setup time.
4. Polls the server's `/healthcheck` until it answers (`src/bun/health.ts`, 45 s timeout), showing
   a splash page with stage updates meanwhile, then points the native window at
   `http://127.0.0.1:<port>/`. On failure it renders an error page including ConvertX's stderr
   tail, the log-file path, and a Restart button.

The supervisor also enforces desktop behavior: a single-instance lock (second launches focus the
running window), a token-authed loopback control server (focus/restart/open-external), a Bun
`--preload` shim that pins the ConvertX server to 127.0.0.1 (it would otherwise bind 0.0.0.0 —
LAN-visible with authentication disabled), a stable preferred port (17843) so webview state
survives restarts, window-state persistence, one guarded auto-restart on crashes, rotating log
files, and an automatic refresh of the app-data ConvertX copy whenever the bundled
`vendor-manifest.json` changes (user `data\` is preserved). External links open in the system
browser. Converted files and history are kept for 7 days by default
(`CONVERTX_DESKTOP_AUTO_DELETE_HOURS` overrides; `0` disables cleanup).

## Prerequisites (build machine)

- [Bun](https://bun.sh) on `PATH` (developed with Bun 1.3.14)
- `git` on `PATH` (the setup script clones ConvertX)
- Windows' built-in `tar.exe` (bsdtar, in `C:\Windows\System32` — present on Windows 10/11; the
  converter fetch script uses it to extract `.zip` and `.7z` archives)
- Network access during setup only (clones ConvertX, downloads converter binaries)

The packaged app itself needs none of these — it is fully self-contained and offline.

## Setup and commands

```powershell
bun install     # install the shell's dependencies (electrobun)
bun run setup   # vendor ConvertX + download converter binaries (see below)
```

`bun run setup` runs three scripts:

- `scripts/setup-convertx.ts` — shallow-clones ConvertX from
  `https://github.com/C4illin/ConvertX.git` into `vendor/convertx` (skipped if already present),
  runs `bun install` inside it, and pre-builds its Tailwind CSS (`public/generated.css`) so it can
  run in production mode. The clone is pinned to the commit in `scripts/lib/pins.ts`; delete
  `vendor/convertx` and re-run setup after bumping the pin.
- `scripts/fetch-converters.ts` — downloads the converter binaries listed below into
  `vendor/converters/win/`. Downloads are pinned by `scripts/converter-manifest.json` (exact
  URL + sha256 per tool) and hash-verified; the script prints a per-tool OK/FAIL summary and
  fails the setup chain on any failure. To bump converter versions, run
  `bun run scripts/fetch-converters.ts --record` and commit the manifest diff.
- `scripts/write-vendor-manifest.ts` — records all pins (ConvertX ref + version, converter
  versions/URLs/hashes, Bun version) into `vendor/vendor-manifest.json`, which is baked into
  packaged bundles as the build's bill of materials.

See `RELEASING.md` for the release process and how to update pins.

Then:

```powershell
bun run dev                # launch the app in dev mode (electrobun dev)
bun run test               # unit tests (src + scripts)
bun run scripts/smoke.ts   # end-to-end smoke test: boots ConvertX headless,
                           # uploads a PNG, converts it to JPG via ImageMagick,
                           # asserts the server binds loopback-only
bun run package            # electrobun build + bake vendor/ into the bundle
bun run scripts/verify-packaged.ts  # integration checks against the built
                                    # bundle (single instance, stale-lock takeover)
bun run dist               # package + installer + portable zip + checksums/notes
                           # (needs Inno Setup: winget install JRSoftware.InnoSetup)
```

`bun run package` runs `electrobun build` and then `scripts/bundle-vendor.ts`, which copies
`vendor/convertx` and `vendor/converters/win` into the built bundle's `Resources/app/vendor`.
With the default build channel the bundle lands at `build\dev-win-x64\ConvertX-dev\`; launch
**`bin\launcher.exe`** inside it. The folder is self-contained — copy it anywhere (no Bun or dev
toolchain needed on the target machine).

## Bundled converters

`scripts/fetch-converters.ts` fetches these Windows binaries into `vendor/converters/win/`:

| Tool | Source | Covers |
|---|---|---|
| ffmpeg | gyan.dev release-essentials build | audio and video formats |
| ImageMagick (`magick.exe`, portable dir) | latest GitHub release | raster image formats |
| pandoc | latest GitHub release | document/markup formats (Markdown, DOCX, HTML, EPUB, …) |
| dasel | latest GitHub release | structured data (JSON, YAML, TOML, XML, CSV) |
| resvg | latest GitHub release | SVG → PNG rendering |
| vtracer | latest GitHub release | raster → SVG vectorization |
| potrace | potrace.sourceforge.net 1.16 | bitmap tracing to vector (SVG/PDF/EPS) |

The supervisor prepends `vendor/converters/win` and each of its immediate subdirectories (the
ImageMagick portable folder) to the ConvertX child's `PATH`.

## Data locations

Everything writable lives under `%APPDATA%\ConvertX-Electrobun\`:

- `convertx\` — the running copy of ConvertX (its `data\` holds uploads, output, and the SQLite DB)
- `jwt-secret` — the persisted JWT secret, generated on first run
- `instance.json` — single-instance lock (pid, control port, token, child pid)
- `window-state.json` — window bounds + maximized flag
- `logs\convertx.log` (+ `.1`) — rotating supervisor + ConvertX log
- `loopback-shim.ts` — generated Bun preload shim (pins the server to loopback)

Copies and refreshes are atomic: they are staged in a `convertx.partial` directory and renamed
into place, so an interrupted copy heals itself on the next launch. The copy refreshes
automatically when the bundled vendor manifest changes; `data\` (uploads, output, DB) is
preserved across refreshes. (The copy excludes the vendored checkout's `data\` and `.git` —
ConvertX creates a fresh `data\` on first boot.)

## Known limitations

- The exe is unsigned — Windows SmartScreen warns on first launch. Releases
  carry `SHA256SUMS.txt` for download verification.
- No auto-update yet (Phase 3); install updates by running the newer installer.
- Windows-only: only Windows converter binaries are fetched, and the packaged build is only
  exercised on Windows 11.
- The app icon (`assets/icon.ico`) is embedded into the packaged bundle's exes by
  `scripts/bundle-vendor.ts` (via rcedit; Electrobun 1.18.1's own `build.win.icon` embedding is
  broken — its compiled CLI fails to resolve rcedit and only warns). The icon shows in the
  taskbar, Explorer, and shortcuts; dev-mode windows and the window *title-bar* glyph stay
  generic (the latter is unsupported by Electrobun on Windows).
- The converter set is limited to the bundled tools above. Upstream ConvertX supports more
  backends (LibreOffice, Calibre, Inkscape, …); conversions that need a tool that is not bundled
  will fail.

## Licensing

This repository is licensed under the **GNU AGPL-3.0** (see `LICENSE`), the same license as
ConvertX itself (see `vendor/convertx/LICENSE` after setup).
This repo's scripts vendor ConvertX unmodified and bundle it together with its converter
binaries. If you distribute the packaged bundle, you are distributing ConvertX, and the
AGPL-3.0 terms apply to that distribution. The bundled converter binaries each carry their own
licenses as well.
