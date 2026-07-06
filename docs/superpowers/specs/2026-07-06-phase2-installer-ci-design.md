# Phase 2 — Installer, CI, Releases: Design

- **Date:** 2026-07-06
- **Status:** Approved (design)
- **Parent:** `2026-07-06-full-desktop-app-master-plan.md` Phase 2
- **User decisions (2026-07-06):** first release is **1.0.0**; CI creates **draft** releases; uninstaller **keeps user data**. Signing remains deferred — everything ships unsigned with a marked signing insertion point.

## 1. Goal

A git tag `v1.0.0` produces, via GitHub Actions, a draft GitHub Release carrying a per-user Windows installer, a portable zip, checksums, and AGPL-compliant release notes — all built from the pinned Phase 0 inputs and gated by the Phase 1 test/verify suite.

## 2. Verified grounding

- **Inno Setup 6.7.x:** `PrivilegesRequired=lowest` + `DefaultDirName={autopf}\…` installs to `%LOCALAPPDATA%\Programs\…` with no UAC; uninstall entry lands in HKCU. Default compression is already lzma2/max; add `SolidCompression=yes`. `CloseApplications=force` is required — Restart Manager closes console apps via CTRL_C_EVENT, which a Bun runtime ignores; `force` terminates after ~30 s. Silent: `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART`; the uninstaller accepts the same. The uninstaller only removes what it installed — `%APPDATA%\ConvertX-Electrobun` survives by default (matches the user decision). `ISCC.exe /DName=Value` passes defines; exit 0/1/2. Not installed locally (install via `winget install JRSoftware.InnoSetup`).
- **windows-latest (Server 2025 image):** Inno Setup 6.7.1 preinstalled (`iscc` on PATH; keep a `choco install innosetup` fallback guard — it was dropped and re-added once). `oven-sh/setup-bun@v2` supports `bun-version-file: .bun-version`. GUI/WebView2 apps launch on the runner (non-interactive session; give app-launching steps `timeout-minutes`), but the **WebView2 Runtime is not documented on the 2025 image** — detect via the EdgeUpdate registry key and bootstrap with `MicrosoftEdgeWebview2Setup.exe /silent /install` before running the packaged app. `softprops/action-gh-release@v3` with `permissions: contents: write` creates draft releases. `actions/cache@v6` keyed on `hashFiles('scripts/converter-manifest.json')` caches the ~200 MB converter downloads. Tag gate: `${GITHUB_REF_NAME#v}` must equal package.json version.
- **Bundle reality:** `build\dev-win-x64\ConvertX-dev\` is 815 MB (bin\ + lib\ + Resources\); `bin\app.log` is runtime junk that must not ship.

## 3. Decision: stay on Electrobun's dev build channel

The master plan raised moving to `--env=stable` for two reasons: branding (folder literally named `ConvertX-dev`) and Electrobun's updater (disabled on dev). Neither applies anymore: Phase 3's chosen update mechanism is silent reinstall of our own installer (not Electrobun's updater/artifact system), and the installer owns all user-visible naming (install dir, shortcuts, Add/Remove entry) regardless of the build folder's name. Staying on dev keeps `bundle-vendor.ts` working as-is instead of fighting the CLI's tar-and-delete of stable-channel bundles via hooks. Recorded as revisitable if Phase 3's bsdiff optimization is ever picked up.

## 4. Components

### 4.1 `installer/ConvertX-Desktop.iss`

Per-user Inno script. Key directives: stable `AppId` GUID; `AppName=ConvertX Desktop`; `AppVersion` via `/DAppVersion=…`; source dir via `/DBundleDir=…`; `PrivilegesRequired=lowest`; `DefaultDirName={autopf}\ConvertX Desktop`; `DisableProgramGroupPage=yes`; `Compression=lzma2/max` + `SolidCompression=yes`; `CloseApplications=force`; `UninstallDisplayIcon={app}\bin\launcher.exe`; `SetupIconFile=assets\icon.ico`. `[Files]` copies the bundle tree (`recursesubdirs createallsubdirs ignoreversion`), **excluding `bin\app.log`**. `[Icons]` Start-menu shortcut "ConvertX Desktop" → `{app}\bin\launcher.exe`, plus optional desktop shortcut (Task, unchecked by default). `[Run]` postinstall "Launch ConvertX Desktop" (`nowait postinstall skipifsilent`). No `[UninstallDelete]` — user data stays.

### 4.2 `scripts/build-installer.ts`

Locates ISCC (`iscc` on PATH → `%LOCALAPPDATA%\Programs\Inno Setup 6\` → `C:\Program Files (x86)\Inno Setup 6\`), reads the version from package.json, verifies the bundle exists (fails with "run `bun run package` first"), runs ISCC with the defines, emits `dist\ConvertX-Desktop-<version>-Setup.exe`. Fails hard on missing ISCC with the winget/choco hint.

### 4.3 `scripts/make-portable-zip.ts`

PowerShell `Compress-Archive` of the bundle (minus `bin\app.log`) → `dist\ConvertX-Desktop-<version>-win-x64-portable.zip`.

### 4.4 `scripts/make-release-assets.ts`

Generates `dist\SHA256SUMS.txt` (via the Phase 0 checksum lib) over the two artifacts, and `dist\RELEASE-NOTES.md` from `vendor/vendor-manifest.json`: app version, install/portable instructions, the unsigned-binaries SmartScreen note ("More info → Run anyway"), the vendored ConvertX commit with source link (`https://github.com/C4illin/ConvertX/tree/<ref>` — the AGPL source offer), and the converter version table with upstream links.

### 4.5 Workflows

- `.github/workflows/ci.yml` — push to main + PRs: setup-bun (`.bun-version`), converter cache, `bun install`, `bun run setup`, `bun run test`, `bun x tsc --noEmit`, `bun run scripts/smoke.ts`. Fast correctness gate; no packaging.
- `.github/workflows/release.yml` — tags `v*` + `workflow_dispatch` (dry-run: builds and uploads workflow artifacts, no release): everything ci.yml does, then version gate (tag == package.json, tag-triggered only), `bun run package`, WebView2 ensure step, `bun run scripts/verify-packaged.ts` (`timeout-minutes: 15`), build installer, **silent-install probe** (install to the runner with `/VERYSILENT`, assert the installed tree + uninstall silently), portable zip, release assets, then `softprops/action-gh-release@v3` with `draft: true`, `body_path: dist/RELEASE-NOTES.md`, the three files, `permissions: contents: write`.
- **Signing insertion point:** a clearly-marked disabled step between bake and installer compile (sign `launcher.exe`/`bun.exe`) and after compile (sign the Setup exe), referencing master plan §6.2. If CI's verify-packaged proves flaky (non-interactive session quirks), it is demoted to a documented local gate rather than blocking releases — decision recorded in the workflow comment.

### 4.6 rcedit hardening (`package.json`, `scripts/bundle-vendor.ts`)

`rcedit` becomes a direct devDependency; the icon-embed step fails the build instead of warning (an icon-less release must not ship silently).

### 4.7 Release procedure (RELEASING.md rewrite)

Bump version → commit → `git tag v<version>` → push tag → CI drafts the release → review the draft on GitHub → publish. Local fallback path (build installer + zip by hand) retained for CI outages.

## 5. Artifact naming

`ConvertX-Desktop-<version>-Setup.exe`, `ConvertX-Desktop-<version>-win-x64-portable.zip`, `SHA256SUMS.txt`, release title `ConvertX Desktop <version>`. `dist/` is gitignored.

## 6. Error handling

- Version gate fails the release job on tag/package.json mismatch (before any heavy work).
- build-installer verifies bundle presence and ISCC availability with actionable errors; ISCC exit codes 1/2 fail the build.
- The silent-install probe uninstalls even on assertion failure (always-run cleanup) so reruns start clean.
- Draft releases mean a bad artifact never reaches users without a human look.

## 7. Testing

- Local: full chain once — `package` → `build-installer` → silent install to the real per-user dir → launch installed app with an isolated `APPDATA`, probe lock + `/ping` + healthcheck → silent uninstall → assert app dir gone and user data untouched.
- CI: the dry-run (`workflow_dispatch`) exercises the whole release pipeline without a tag; then the real `v1.0.0` tag produces the draft release (the phase's done-when).
- Existing gates unchanged: 63 unit tests, smoke (loopback assert), verify-packaged.

## 8. Out of scope

Signing execution (deferred; insertion points only). winget submission (Phase 3, needs a published release). Auto-update (Phase 3). Fresh-VM manual validation (user-side checklist item in the draft-release notes).

## 9. Risks

- Runner-image churn (Inno dropped/re-added once) → PATH guard + choco fallback.
- WebView2 absence on runners → bootstrap step; verify-packaged demotable to local gate without blocking releases.
- 815 MB bundle → ~6 GB runner disk is ample; compile ~3–8 min lzma2/max; cache keeps converter downloads out of the hot path.
- `CloseApplications=force` terminates a running app mid-update after ~30 s — acceptable for manual updates; Phase 3's auto-update quits the app itself before reinstalling.
