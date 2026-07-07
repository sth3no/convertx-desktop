# ConvertX Desktop — Full Desktop App Master Plan

- **Date:** 2026-07-06
- **Status:** Approved 2026-07-06. Phase 0 complete (2026-07-06, plan: `../plans/2026-07-06-phase0-release-foundations.md`); Phase 1 complete (2026-07-06, plan: `../plans/2026-07-06-phase1-desktop-robustness.md`); Phase 2 complete (2026-07-07, plan: `../plans/2026-07-06-phase2-installer-ci.md`) — v1.0.0 draft release awaiting user publish, signing still deferred; Phases 3+4 **engine layer** complete (2026-07-07, plan: `../plans/2026-07-07-backend-engine-api.md`) — update/pack/settings engines shipped behind the local API (`docs/API.md`), UI intentionally left to the user; winget submission and heavyweight pack registry entries remain open.
- **Scope:** Everything between today's working packaged bundle and a polished, distributable Windows desktop app.
- **Relationship to other docs:** This is the roadmap. Each phase below gets its own design spec + implementation plan (the repo convention already used by `2026-05-18-convertx-electrobun-app-design.md` and `2026-05-19-convertx-electrobun-mvp-packaging-design.md`). This document decides *what* and *in which order*; the per-phase specs decide *how*.

## 1. Goal

ConvertX works as a seamless Windows desktop app: double-click install, no Docker, no login, no SmartScreen scare wall, converts files offline, updates itself, and fails gracefully with diagnostics a normal user can act on. "Seamless" concretely means:

- Install via a normal per-user installer (no admin rights) or portable zip; uninstall cleanly.
- Signed binaries with a real publisher name.
- The app keeps itself up to date.
- Conversions that need a tool we don't bundle either work (via an on-demand pack) or fail with a helpful message — not a silent "Failed, check logs".
- No orphaned processes, no lost window positions, no mystery state.

## 2. Where we are today

Delivered by the two previous passes (see git history through `3658eac`):

- Electrobun 1.18.1 shell + Bun supervisor that spawns vendored ConvertX (v0.17.0, commit `0965928`, includes the path-traversal fix from upstream PR #532) on a free loopback port in no-login mode, health-polls, and shows it in a WebView2 window.
- First-run atomic copy of ConvertX into `%APPDATA%\ConvertX-Electrobun\convertx`; process-tree kill on graceful shutdown; error page with stderr tail.
- 7 bundled converters (ffmpeg, ImageMagick, pandoc, dasel v2.8.1, resvg, vtracer, potrace); ~687 MB uncompressed vendor payload.
- `bun run package` produces a self-contained folder; smoke test converts PNG→JPG end to end; 5 unit-test files cover the supervisor.
- App icon embedded via rcedit workaround (Electrobun's own embedding is broken in 1.18.1).

Known gaps (from the specs' own deferral lists + fresh code review): unsigned, no installer, no auto-update, no CI, no git remote, unpinned upstream/converter downloads with no checksums, dev-channel-only packaging (output folder is literally `ConvertX-dev`), no single-instance lock, no log files, hardcoded window frame, random port each launch, no refresh of the app-data ConvertX copy after upgrades, footer links navigate the app window to GitHub, output auto-deletes after 24 h by default, conversions needing unbundled tools fail opaquely.

## 3. Locked decisions (user, 2026-07-06)

| Decision | Choice | Caveat discovered in research |
|---|---|---|
| Code signing | Azure Trusted Signing (now "Artifact Signing", $9.99/mo) | **Individuals are eligible only in US/Canada.** EU individuals must onboard via a registered organization (US/CA/EU/UK orgs OK). See the decision gate in Phase 2. |
| Distribution | Per-user installer + portable zip, on GitHub Releases, later winget | None — Inno Setup fits all requirements. |
| Updates | Full auto-update | Two viable mechanisms; recommendation in §6.1. |
| Converters | Keep curated 7, add on-demand packs | Feasible; some upstream tools (Perl/Python/TeX-based) stay excluded. See Phase 4. |

Standing principle carried over from the previous specs: **ConvertX runs unmodified** (zero patches). Desktop behavior is added in the shell. If a phase can't meet its goal without patching, the spec for that phase must call it out explicitly and justify it.

## 4. The plan at a glance

| Phase | Theme | Outcome | Depends on |
|---|---|---|---|
| 0 | Release foundations | Repo on GitHub, every build input pinned + checksummed, one version source of truth | — |
| 1 | Desktop robustness | Single instance, logs, stable port, window state, crash recovery, app-copy refresh, link interception, sane data defaults | — |
| 2 | Installer, signing, CI | Signed Inno installer + portable zip built and released by GitHub Actions | 0 (1 partially) |
| 3 | Auto-update | App updates itself from GitHub Releases; winget manifest | 2 |
| 4 | Converter packs | On-demand install of LibreOffice/Calibre/Inkscape/vips/… from a shell-side pack manager | 1 (restart plumbing), 2 (CI hosting) |
| 5 | Desktop integration polish | File associations / "Open with", tray, notifications, settings pane, output-folder UX | 1, 2 |
| 6 | Horizon options | Microsoft Store, macOS/Linux, Electrobun 2.0/Tauri contingency | 2–5 |

Phases 0 and 1 can run in parallel. **Start the signing acquisition (Phase 2's decision gate) immediately** — identity verification and smartcard shipping have multi-week lead times regardless of which path is chosen.

## 5. Phases

### Phase 0 — Release foundations

*Why first:* every later phase produces artifacts; artifacts that can't be reproduced can't be trusted, signed, or diffed.

- Create the GitHub repository and push (the repo currently has **no remote**). Decide the public name (the bundle is a repackaging of C4illin/ConvertX — name should not imply upstream affiliation, e.g. "ConvertX Desktop").
- Pin the ConvertX vendor ref: `setup-convertx.ts` takes an explicit tag/commit (currently: unpinned `--depth 1` clone of default branch), records it in a `vendor-manifest.json` baked into the bundle.
- Pin converter versions: replace all four "latest GitHub release" resolutions (ImageMagick, pandoc, resvg, vtracer) and the floating gyan.dev ffmpeg URL with explicit versions, like dasel already is.
- Add **sha256 verification** for every downloaded binary (the current integrity check is only "not HTML and >10 KB" — the pipeline's biggest supply-chain hole).
- Add `GITHUB_TOKEN` support to the GitHub API calls (unauthenticated limit of 60 req/h will break CI).
- Pin the Tailwind CLI version used in setup and the Bun version (document 1.3.14; enforce in CI).
- Single source of truth for the version (feed `electrobun.config.ts` and `bundle-vendor.ts` from `package.json`) and for the app name / copy-exclusion lists currently duplicated by hand.
- AGPL-3.0 compliance layout: releases must carry ConvertX's license, the exact vendored commit, a source-availability notice, and the bundled converters' licenses.

*Done when:* two consecutive `bun run setup && bun run package` runs from a clean checkout produce byte-identical vendor manifests, and a documented `RELEASING.md` exists.

### Phase 1 — Desktop robustness

*Why:* these are the "seams" a user hits in normal use, and several later features (file associations, auto-update) depend on them.

- **Single-instance lock** (lock file or named mutex in app-data) + focus-existing-window on second launch. Electrobun has no built-in API for this (open upstream issue #465); implement in the supervisor. Prerequisite for file-association handoff in Phase 5. Also fixes the current race where two first-runs collide on the same `.partial` copy directory.
- **Log files**: rotating supervisor + ConvertX log under `%APPDATA%\ConvertX-Electrobun\logs\`; error page references the log path. Today all diagnostics go to stdout, which is invisible in a packaged GUI app.
- **Stable port**: prefer a fixed default port with fallback scan, so the webview origin (localStorage etc.) survives restarts; health-check against ConvertX's `/healthcheck` endpoint instead of accepting any HTTP responder (also narrows the port-squat window).
- **Window state persistence**: size/position/maximized to JSON in app-data, clamped to visible displays (currently hardcoded 1100×800 at 150,100).
- **Crash recovery**: "Restart" button on the error page (wire the currently-unused RPC bridge) and/or auto-respawn with a crash-loop guard; faster fast-fail than the current 45 s worst case; first-run copy progress messaging on the splash.
- **Orphan cleanup on hard kill**: PID file + stale-process reap on next launch (a Windows Job Object is the stronger alternative; spec decides). Graceful-shutdown tree-kill already works.
- **App-data copy refresh**: bake a vendor version/hash marker; when the installed bundle's vendor differs from the app-data copy, re-copy on launch (preserving `data/`). Without this, shipped updates silently keep running the old ConvertX — a hard blocker for Phase 3.
- **External link interception**: `will-navigate`/`new-window-open` → open non-`127.0.0.1` URLs in the system browser (ConvertX's footer "Powered by ConvertX" link currently navigates the app window to GitHub).
- **Desktop-sane data defaults**: surface/override `AUTO_DELETE_EVERY_N_HOURS` (upstream default silently deletes converted files after 24 h — surprising on desktop); pin the server bind to loopback explicitly.

*Done when:* the smoke test covers restart-preserves-state, second-launch focuses the first, kill −9 leaves no orphans after next launch, and a vendored-version bump refreshes the app-data copy.

### Phase 2 — Installer, signing, CI (ships v1.0)

- **Packaging channel fix**: move off the `dev` electrobun channel (artifact folder is literally named `ConvertX-dev`, and the updater is disabled on dev). Use `--env=stable` with a `postBuild` hook to bake `vendor/` in before Electrobun tars the bundle — `bundle-vendor.ts` currently can't run after stable-channel builds at all.
- **Inno Setup 6.7.x installer**: `PrivilegesRequired=lowest` (per-user, no UAC), LZMA2 compression, Start-menu shortcut, proper uninstaller. Payload (~687 MB uncompressed) is comfortably inside Inno's ~2.1 GB cap and GitHub's 2 GiB/asset limit. Also `Compress-Archive` the bundle as a portable zip. (Electrobun's own Setup.exe is a crude self-extractor — shortcuts but `rmdir`-style uninstall; we keep its artifact format only if Phase 3 chooses the Electrobun updater.)
- **Signing — decision gate** (start immediately, lead time weeks):
  - *If a registered business entity is available* (Czech živnost/s.r.o. counts as an EU organization): **Artifact Signing**, $9.99/mo, signs in GitHub Actions via the official `Azure/artifact-signing-action`; requires a paid Azure subscription and org identity validation (1–20 business days).
  - *Else:* **Certum Open Source cert** (~€69 first year with smartcard+reader, ~€29/yr renewal; publisher shows as "Open Source Developer, Vojtěch Stehlík") — signing is local (smartcard), so CI produces unsigned artifacts and a local script signs + uploads. In parallel, apply to **SignPath Foundation** (free CI signing for OSS; requires public repo + OSI license, so it can only start after Phase 0's publication).
  - Signing order matters: build → bake vendor → rcedit icon → **sign `launcher.exe`/`bun.exe`** → compile installer → **sign installer**. (rcedit invalidates signatures, so it must precede signing.)
  - Expectation-setting: since Aug 2024 *no* certificate bypasses SmartScreen instantly; reputation builds from clean downloads and carries across releases only when signed. Document the first-launch flow in the README.
- **rcedit hardening**: declare rcedit as a direct devDependency (currently a transitive dep of Electrobun that could vanish) and make icon-embed failure fatal in release builds (currently warn-only).
- **CI (GitHub Actions, windows-latest)**: pinned Bun → `bun install` → `setup` (pinned + checksummed, with `GITHUB_TOKEN`) → unit tests → smoke test → `package` → **smoke-test the packaged bundle** (today only the dev vendor tree is smoke-tested) → build installer → sign → draft GitHub Release with installer, zip, sha256sums, licenses, vendored-source ref.

*Done when:* a git tag produces a signed installer + zip on a GitHub Release via CI (or CI artifacts + one local signing step, on the Certum path), and a fresh Windows 11 VM installs, converts a file, and uninstalls cleanly.

### Phase 3 — Auto-update

- **Mechanism** (recommendation and trade-offs in §6.1; per-phase spec makes the final call):
  - *Recommended v1:* *silent reinstall* — the app checks a small version manifest on GitHub Releases, downloads the new signed installer, verifies its hash, runs it `/VERYSILENT`, relaunches. Full-size download (~300–400 MB compressed) per update, but dead simple, uses the exact artifact users install manually, and inherits the installer's signing.
  - *Later optimization:* Electrobun's built-in bsdiff updater (tiny delta patches; proven on Windows as of 1.18.1) — requires stable-channel artifacts at a `release.baseUrl`, entangles install layout with Electrobun's extractor, has an open "fails on battery power" bug (#300), and does not verify signatures on downloaded tarballs.
- Update UX: check on launch + daily; toast/menu notice; "install on quit" option; never interrupt a running conversion.
- App-data ConvertX copy refresh on update (delivered by Phase 1's marker mechanism — verify end to end here).
- **winget**: first manifest via `wingetcreate`/Komac PR to `microsoft/winget-pkgs` (unsigned installers are accepted; silent install must work — Inno's `/VERYSILENT` satisfies the validation pipeline), then automate per-release with `winget-releaser` or Komac in CI. `winget upgrade` becomes a second update channel for users who prefer it.

*Done when:* an old installed version updates itself to a new release without user interaction beyond consent, twice in a row (n → n+1 → n+2), including the app-data copy refresh.

### Phase 4 — On-demand converter packs

*Goal:* conversions beyond the curated 7 work without bloating the base install. Upstream registers 21 backends; we bundle 7. The heavyweights we can realistically add as packs, in value order:

| Pack | Tool(s) | Unlocks | Notes |
|---|---|---|---|
| Office documents | LibreOffice (`soffice`, portable) | doc/docx/xls/ppt/odt… 41→22 formats | Largest (~350 MB); highest demand |
| E-books | Calibre CLI (`ebook-convert`) | 26→19 e-book formats | Portable Windows build exists |
| Vector/EMF | Inkscape | 7→17 incl. EMF/WMF | Registry priority: upstream deliberately puts Inkscape first for EMF |
| Fast images | libvips (`vips`) | 45→23 formats, fast large-image ops | Small, static Windows build |
| Legacy images | GraphicsMagick (`gm`) | 167→130 formats | Overlaps ImageMagick; lower priority |
| Modern codecs | libjxl (`cjxl`/`djxl`) | JPEG-XL | Official Windows release binaries |
| PDF/PS toolchain | Ghostscript (+dvisvgm) | PDF/EPS delegates, dvisvgm | Also improves ImageMagick PDF handling |
| 3D models | assimp CLI | 77→23 3D formats | Niche |

Excluded (poor Windows fit, revisit on demand): TeX Live/XeLaTeX (gigabytes), msgconvert (Perl), markitdown (Python/pipx), libheif's `heif-convert` (no official Windows build — investigate alternatives if HEIC demand appears).

- **Pack registry**: pinned URLs + sha256 per pack, shipped with the app, updatable via app updates.
- **Supervisor pack manager**: download to `%APPDATA%\ConvertX-Electrobun\packs\<tool>\`, verify, unpack, prepend to the child `PATH`, restart the ConvertX child (fast — the window stays open on the splash during restart).
- **Shell-side UI** (zero-patch): a pack manager page owned by the shell (native menu / tray → local page), listing packs with size, install/remove, and what each unlocks.
- **Failure UX**: map "conversion failed" for known missing tools to a "this needs the X pack — install?" hint. May require log inspection from the shell; if it can't be done zero-patch, the spec escalates per §3's standing principle.

*Done when:* a fresh install converts a .docx→.pdf after one click on the Office pack, offline installs fail gracefully, and removing a pack returns the app to the pre-pack state.

### Phase 5 — Desktop integration polish

- **File associations / "Open with ConvertX"**: Inno registry entries (HKA `Software\Classes`, `ChangesAssociations=yes`) for common convertible types as *secondary* handlers ("Open with"), never stealing defaults. The app parses `process.argv` and hands files to the running instance via the single-instance channel (Phase 1). *Risk:* Electrobun's argv delivery on Windows has an open issue (#483) — verify early; fallback is a tiny handoff shim.
- **Tray + menu**: optional close-to-tray; app menu with Open output folder (`Utils.showItemInFolder`), Check for updates, Converter packs, Settings, Logs.
- **Notifications**: "conversion finished" via `Utils.showNotification` (fire-and-forget on Windows — no click actions; tray/menu is the fallback affordance).
- **Settings pane (shell-side, zero-patch)**: auto-delete hours, max concurrent conversions, ffmpeg args, port, close-to-tray, pack management — persisted JSON in app-data, passed to the child as env on restart.
- **Output UX**: webview `download-*` events route downloads to the user's Downloads folder (or a chosen folder) + "Show in folder"; note Electrobun has no native save dialog (only open), so per-download "Save as" needs the directory-picker workaround.
- **Drag-and-drop**: verify WebView2 delivers drops to ConvertX's web UI (likely works); add splash/error-page handling only if needed.
- Window polish: verify/mitigate Electrobun's open Windows cosmetics issues as they bite (resize white bands #484, initial viewport #462, AppUserModelID for taskbar grouping #181).

*Done when:* right-click → Open with ConvertX on a .png lands the file in an already-running window, a finished conversion notifies, and settings survive restarts.

### Phase 6 — Horizon (explicitly optional, decide later)

- **Microsoft Store**: MSIX signed by Microsoft (no SmartScreen ever, ~$19 one-time) — but MSIX containerization vs. our spawn-bundled-exes model needs a real spike before committing.
- **macOS/Linux**: the scripts and supervisor are structured for it, but converter matrices, signing, and packaging are per-OS projects. Only on demand.
- **Framework contingency**: pin Electrobun 1.18.1 (single maintainer, 2.0 rewrite in progress — treat every Electrobun bug as ours to patch). Escape hatch documented: Tauri with the Bun supervisor as a sidecar keeps ~all our code and gains real NSIS/MSI + signed updater; Electron is the low-effort JS-to-JS port at ~6× binary size. Re-evaluate when Electrobun 2.0 has a migration guide.

## 6. Key design recommendations

### 6.1 Update mechanism: silent reinstall first, bsdiff later

Full auto-update (locked decision) does not force Electrobun's updater. Recommendation: **v1 = silent reinstall** (check manifest → download signed installer → verify → `/VERYSILENT` → relaunch). Rationale: one artifact for manual installs, winget, *and* auto-update; the payload is signed and hash-verified; no coupling to Electrobun's extractor layout or its open updater bugs; trivially debuggable. Cost: full-size downloads. The Electrobun bsdiff updater (4 KB–14 MB patches) is a Phase-3-follow-up optimization once stable-channel artifact generation (Phase 2) is proven — it saves real bandwidth for an app this size, but it should not gate v1.

### 6.2 Signing: pursue two tracks at once

Apply for the chosen primary (Artifact Signing via org, if an entity exists; else Certum OSS) **and** SignPath Foundation in parallel the moment the repo is public. Whichever lands first unblocks Phase 2; they're not mutually exclusive (SignPath can sign CI builds while a Certum card signs local emergency releases).

### 6.3 Zero-patch boundary

Everything in this plan fits the shell except two possible pressure points: hiding/annotating converters whose tool isn't installed (Phase 4 failure UX) and per-conversion progress notifications (Phase 5). Both specs must first attempt shell-side solutions (log parsing, DOM-side injection via the webview preload); patching vendored ConvertX is a last resort requiring explicit sign-off, because it breaks the "vendored unmodified" property that makes upstream upgrades cheap.

## 7. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Artifact Signing ineligibility (EU individual) | Blocks preferred signing path | Decision gate in Phase 2; Certum OSS + SignPath fallbacks; start immediately |
| SmartScreen warns despite signing (reputation ramp) | First users still see warnings | Expectation-setting docs; winget/Store channels bypass browser SmartScreen; keep publisher identity stable |
| Electrobun bus-factor 1 / 2.0 pivot | Framework bugs unfixed; breaking migration looms | Pin 1.18.1; vendor workarounds (already the pattern); Tauri-sidecar exit documented; don't track 1.18.4 betas |
| Electrobun Windows gaps (no argv event, no single-instance, no save dialog, no file associations) | Phase 1/5 features need hand-rolled solutions | Planned as our own code from the start; nothing assumes upstream fixes |
| Upstream ConvertX drift (env-var auth mechanism could change) | No-login mode breaks on upgrade | Pinned ref + vendor manifest; upgrade checklist re-verifies env flags + smoke test |
| Converter download sources move/break | Setup/CI failures; pack installs fail | Pins + checksums (Phase 0); pack registry updatable via app updates |
| AGPL/licensing missteps in distribution | Legal/compliance exposure | Phase 0 compliance layout; licenses + source ref ride every release |
| Update payload size (~300–400 MB per update) | User annoyance on metered connections | "Install on quit" UX; bsdiff optimization as fast-follow (§6.1) |
| winget review latency (days) | Release channel lag | Treat winget as trailing channel; GitHub Release is canonical |

## 8. Open questions (user input needed)

1. **Do you have a registered business entity** (živnost/s.r.o.) usable for Artifact Signing onboarding? This picks the Phase 2 signing track (§6.2).
2. **Public repo name** — "ConvertX Desktop" or something more distinct from upstream?
3. Any converter pack you'd promote into the *base* install (e.g. if office docs are your main use, LibreOffice could ship in the installer despite size)?

## 8b. Handoff queue (ready-to-run plans, 2026-07-07)

Self-contained implementation plans/runbooks with this session's verified research baked in — suited to Opus-class execution (or any competent executor) without re-derivation:

| Plan | Blocker |
|---|---|
| `../plans/2026-07-07-tray-and-menu.md` | none |
| `../plans/2026-07-07-conversion-notifications.md` | none |
| `../plans/2026-07-07-settings-passthroughs.md` | none |
| `../plans/2026-07-07-file-associations-installer.md` | none (plumbing shipped + verified) |
| `../plans/2026-07-07-winget-and-housekeeping.md` | v1.0.0 must be published first |
| `../plans/2026-07-07-signing-runbook.md` | user's signing-track decision |

The frontend itself remains the user's domain; its contract is `docs/API.md`.

## 9. Process

Execution order: Phase 0 → 1 → 2 → 3 → 4 → 5 (0∥1 parallelizable; signing acquisition starts now). Each phase: brainstorm → spec → plan → implement → smoke-gated merge, per the existing superpowers convention. This document gets updated (checkboxes per phase) as phases land.
