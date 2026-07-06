# Phase 2 — Installer, CI, Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-06-phase2-installer-ci-design.md`: a per-user Inno Setup installer + portable zip + checksums/notes, built by a tag-triggered GitHub Actions pipeline into a draft release; rcedit hardened; v1.0.0 shipped.

**Architecture:** Three small Bun scripts (build-installer, make-portable-zip, make-release-assets) around one committed `.iss`; two workflows (fast `ci.yml`, full `release.yml` with a `workflow_dispatch` dry-run mode). Packaging stays on Electrobun's dev channel; Inno owns all user-facing branding.

**Tech Stack:** Inno Setup 6.7.x (preinstalled on windows-latest as of image 20260628; local install via jrsoftware.org `/CURRENTUSER`), `oven-sh/setup-bun@v2`, `actions/cache@v6`, `softprops/action-gh-release@v3`, PowerShell `Compress-Archive`.

**Testing note:** the deliverables are orchestration around external tools (ISCC, Compress-Archive, GitHub Actions). TDD-style unit tests don't apply; the acceptance gates are (a) the full local chain — build → silent install → probe the *installed* app → silent uninstall — and (b) a green CI dry-run, then (c) the real `v1.0.0` tag producing a draft release. Existing unit/smoke/verify-packaged gates keep running unchanged.

---

### Task 1: rcedit hardening + bundle debris scrub

**Files:**
- Modify: `package.json` (devDependency)
- Modify: `scripts/bundle-vendor.ts` (icon step fatal; remove `bin\app.log`)

- [ ] **Step 1: Add rcedit as a direct devDependency**

Run: `bun add -d rcedit`
Expected: package.json gains `"rcedit"` in devDependencies; `node_modules/rcedit/bin/rcedit-x64.exe` still present.

- [ ] **Step 2: Make the icon step fatal and scrub app.log**

In `scripts/bundle-vendor.ts`, replace the icon block (from `// Electrobun's own icon embedding …` through the final `for` loop) with:

```typescript
// Electrobun's own icon embedding (build.win.icon) is broken in this install:
// its compiled CLI resolves rcedit against its own CI build path and only
// warns. Embed the icon ourselves with rcedit (a direct devDependency).
// FATAL on failure: an icon-less build must never ship silently (Phase 2).
const rcedit = join(PROJECT_ROOT, "node_modules", "rcedit", "bin", "rcedit-x64.exe");
const icon = join(PROJECT_ROOT, "assets", "icon.ico");
for (const exe of ["launcher.exe", "bun.exe"]) {
  const target = join(BUNDLE_DIR, "bin", exe);
  if (!existsSync(rcedit) || !existsSync(icon) || !existsSync(target)) {
    console.error(`ERROR: cannot embed icon into ${exe} (rcedit, icon, or target missing).`);
    process.exit(1);
  }
  const result = spawnSync(rcedit, [target, "--set-icon", icon], { stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`ERROR: rcedit failed to embed the icon into ${exe} (exit ${result.status}).`);
    process.exit(1);
  }
  console.log(`Embedded icon into ${exe}.`);
}

// Build-machine debris: electrobun's build/dev runs drop an app.log into
// bin/ — it must not ship in any artifact.
rmSync(join(BUNDLE_DIR, "bin", "app.log"), { force: true });
```

- [ ] **Step 3: Verify + commit**

Run: `bun x tsc --noEmit` (clean), then:

```powershell
git add package.json bun.lock scripts/bundle-vendor.ts
git commit -m @'
feat: rcedit as direct dependency, fatal icon embed, scrub bundle debris

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Inno Setup script

**Files:**
- Create: `installer/ConvertX-Desktop.iss`

- [ ] **Step 1: Write the script**

```innosetup
; ConvertX Desktop — per-user Windows installer.
; Compiled by scripts/build-installer.ts, which passes the defines:
;   ISCC /DAppVersion=1.0.0 /DBundleDir=<packaged bundle dir> installer\ConvertX-Desktop.iss

#ifndef AppVersion
  #error Pass /DAppVersion=x.y.z - use scripts/build-installer.ts
#endif
#ifndef BundleDir
  #error Pass /DBundleDir=<packaged bundle dir> - use scripts/build-installer.ts
#endif

[Setup]
; AppId must stay identical across releases so updates reuse the same
; uninstall entry (HKCU\...\Uninstall\<AppId>_is1).
AppId={{B7A9E2C4-6D31-4F5E-9A8B-2C4D7E1F0A63}
AppName=ConvertX Desktop
AppVersion={#AppVersion}
AppPublisher=Vojtech Stehlik
AppPublisherURL=https://github.com/sth3no/convertx-desktop
AppSupportURL=https://github.com/sth3no/convertx-desktop/issues
; Per-user: no UAC prompt; {autopf} resolves to %LOCALAPPDATA%\Programs.
PrivilegesRequired=lowest
DefaultDirName={autopf}\ConvertX Desktop
DisableProgramGroupPage=yes
; The app is a Bun runtime that ignores CTRL_C_EVENT, so Restart Manager's
; graceful close never succeeds - force-terminate on update installs.
CloseApplications=force
Compression=lzma2/max
SolidCompression=yes
OutputDir={#SourcePath}..\dist
OutputBaseFilename=ConvertX-Desktop-{#AppVersion}-Setup
SetupIconFile={#SourcePath}..\assets\icon.ico
UninstallDisplayIcon={app}\bin\launcher.exe
UninstallDisplayName=ConvertX Desktop
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Belt-and-suspenders exclude: bundle-vendor.ts already scrubs bin\app.log.
Source: "{#BundleDir}\*"; DestDir: "{app}"; Excludes: "bin\app.log"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\ConvertX Desktop"; Filename: "{app}\bin\launcher.exe"
Name: "{autodesktop}\ConvertX Desktop"; Filename: "{app}\bin\launcher.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\bin\launcher.exe"; Description: "{cm:LaunchProgram,ConvertX Desktop}"; Flags: nowait postinstall skipifsilent

; No [UninstallDelete]: user data in %APPDATA%\ConvertX-Electrobun survives
; uninstall by design (user decision, Phase 2 spec).
```

Note: `{#SourcePath}` ends with a backslash, hence `{#SourcePath}..\dist`.

- [ ] **Step 2: Commit**

```powershell
git add installer/ConvertX-Desktop.iss
git commit -m @'
feat: add per-user Inno Setup installer script

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 3: build-installer, portable-zip, release-assets scripts

**Files:**
- Create: `scripts/build-installer.ts`
- Create: `scripts/make-portable-zip.ts`
- Create: `scripts/make-release-assets.ts`
- Modify: `package.json` (scripts)

- [ ] **Step 1: scripts/build-installer.ts**

```typescript
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import electrobunConfig from "../electrobun.config";
import pkg from "../package.json";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const BUNDLE_DIR = join(
  PROJECT_ROOT,
  "build",
  "dev-win-x64",
  `${electrobunConfig.app.name}-dev`,
);
const ISS_FILE = join(PROJECT_ROOT, "installer", "ConvertX-Desktop.iss");
const DIST_DIR = join(PROJECT_ROOT, "dist");

/** Locate ISCC: PATH (CI choco shim) -> per-user install -> machine install. */
function findIscc(): string | undefined {
  const probe = spawnSync("iscc", ["/?"], { encoding: "utf8" });
  if (!probe.error) return "iscc";
  const fixed = [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ];
  return fixed.find((c) => c && existsSync(c));
}

if (!existsSync(join(BUNDLE_DIR, "bin", "launcher.exe"))) {
  console.error(`No packaged bundle at ${BUNDLE_DIR} — run 'bun run package' first.`);
  process.exit(1);
}
const iscc = findIscc();
if (!iscc) {
  console.error(
    "Inno Setup (ISCC.exe) not found. Install it:\n" +
      "  winget install JRSoftware.InnoSetup     (or: choco install innosetup)\n" +
      "  or download https://jrsoftware.org/isdl.php and install with /CURRENTUSER",
  );
  process.exit(1);
}
mkdirSync(DIST_DIR, { recursive: true });
console.log(`ISCC: ${iscc}`);
const result = spawnSync(
  iscc,
  [`/DAppVersion=${pkg.version}`, `/DBundleDir=${BUNDLE_DIR}`, ISS_FILE],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  console.error(`ISCC failed (exit ${result.status ?? "unknown"}).`);
  process.exit(result.status ?? 1);
}
const out = join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-Setup.exe`);
if (!existsSync(out)) {
  console.error(`ISCC reported success but ${out} is missing.`);
  process.exit(1);
}
console.log(`Installer: ${out}`);
```

- [ ] **Step 2: scripts/make-portable-zip.ts**

```typescript
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import electrobunConfig from "../electrobun.config";
import pkg from "../package.json";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const BUNDLE_DIR = join(
  PROJECT_ROOT,
  "build",
  "dev-win-x64",
  `${electrobunConfig.app.name}-dev`,
);
const DIST_DIR = join(PROJECT_ROOT, "dist");
const OUT = join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-win-x64-portable.zip`);

if (!existsSync(join(BUNDLE_DIR, "bin", "launcher.exe"))) {
  console.error(`No packaged bundle at ${BUNDLE_DIR} — run 'bun run package' first.`);
  process.exit(1);
}
mkdirSync(DIST_DIR, { recursive: true });
rmSync(OUT, { force: true });
// Zip the bundle CONTENTS (bin/, Resources/, lib/ at the zip root) — the
// release notes tell users to extract into an empty folder. bin\app.log is
// already scrubbed by bundle-vendor.ts.
const result = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path "${BUNDLE_DIR}\\*" -DestinationPath "${OUT}" -CompressionLevel Optimal`,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0 || !existsSync(OUT)) {
  console.error(`Compress-Archive failed (exit ${result.status ?? "unknown"}).`);
  process.exit(1);
}
console.log(`Portable zip: ${OUT}`);
```

- [ ] **Step 3: scripts/make-release-assets.ts**

```typescript
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import pkg from "../package.json";
import { sha256OfFile } from "./lib/checksums";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const MANIFEST_FILE = join(PROJECT_ROOT, "vendor", "vendor-manifest.json");

interface VendorManifest {
  bun: string;
  convertx: { repo: string; ref: string; version: string };
  converters: { name: string; version: string; url: string; sha256: string }[];
}

const artifacts = [
  join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-Setup.exe`),
  join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-win-x64-portable.zip`),
];
for (const file of artifacts) {
  if (!existsSync(file)) {
    console.error(`Missing artifact: ${file} — run the installer/portable scripts first.`);
    process.exit(1);
  }
}
if (!existsSync(MANIFEST_FILE)) {
  console.error(`Missing ${MANIFEST_FILE} — run 'bun run setup' first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as VendorManifest;

let sums = "";
for (const file of artifacts) {
  sums += `${await sha256OfFile(file)}  ${basename(file)}\n`;
}
writeFileSync(join(DIST_DIR, "SHA256SUMS.txt"), sums);

const upstream = manifest.convertx.repo.replace(/\.git$/, "");
const notes = `## ConvertX Desktop ${pkg.version}

A standalone Windows 11 desktop app for converting files — no Docker, no account, works offline.

### Install

- **Installer (recommended):** download \`ConvertX-Desktop-${pkg.version}-Setup.exe\` and run it.
  Installs per-user (no admin rights), adds a Start-menu shortcut, uninstalls from Windows Settings.
- **Portable:** download the zip, extract it into an empty folder, run \`bin\\launcher.exe\`.

> **SmartScreen note:** these binaries are not yet code-signed. Windows shows
> "Windows protected your PC" on first run — click **More info → Run anyway**.
> Verify downloads against \`SHA256SUMS.txt\`.

### What's inside

| Component | Version |
|---|---|
| ConvertX (AGPL-3.0) | ${manifest.convertx.version} ([source](${upstream}/tree/${manifest.convertx.ref})) |
${manifest.converters.map((c) => `| ${c.name} | ${c.version} |`).join("\n")}

This release redistributes [ConvertX](${upstream}) **unmodified** under the GNU AGPL-3.0; the
bundled copy's exact source is the commit linked above. This repository (the desktop shell) is
likewise AGPL-3.0.

Converted files and history are kept for 7 days by default. User data lives in
\`%APPDATA%\\ConvertX-Electrobun\` and survives updates and uninstalls.
`;
writeFileSync(join(DIST_DIR, "RELEASE-NOTES.md"), notes);
console.log("Wrote SHA256SUMS.txt and RELEASE-NOTES.md");
```

- [ ] **Step 4: package.json scripts**

Add after `"package"`:

```json
    "installer": "bun run scripts/build-installer.ts",
    "portable": "bun run scripts/make-portable-zip.ts",
    "release-assets": "bun run scripts/make-release-assets.ts",
    "dist": "bun run package && bun run installer && bun run portable && bun run release-assets",
```

- [ ] **Step 5: Typecheck + commit**

Run: `bun x tsc --noEmit` (clean).

```powershell
git add scripts/build-installer.ts scripts/make-portable-zip.ts scripts/make-release-assets.ts package.json
git commit -m @'
feat: installer build, portable zip, and release-asset scripts

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Local end-to-end chain

- [ ] **Step 1: Install Inno Setup per-user (no admin)**

```powershell
curl.exe -fsSL https://jrsoftware.org/download.php/is.exe -o "$env:TEMP\innosetup.exe"
Start-Process -Wait -FilePath "$env:TEMP\innosetup.exe" -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/CURRENTUSER","/NORESTART"
Test-Path "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
```

Expected: `True`.

- [ ] **Step 2: Build all artifacts**

Run: `bun run package` then `bun run installer` then `bun run portable` then `bun run release-assets`
Expected: `dist\` contains `ConvertX-Desktop-0.1.0-Setup.exe`, `…-win-x64-portable.zip`, `SHA256SUMS.txt`, `RELEASE-NOTES.md`. (Version is still 0.1.0 here; the bump to 1.0.0 is Task 7.)

- [ ] **Step 3: Silent install + probe the installed app + silent uninstall**

```powershell
Start-Process -Wait -FilePath "dist\ConvertX-Desktop-0.1.0-Setup.exe" -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART"
$app = "$env:LOCALAPPDATA\Programs\ConvertX Desktop"
Test-Path "$app\bin\launcher.exe"           # True
Test-Path "$app\bin\app.log"                # False (debris scrubbed)
Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\ConvertX Desktop.lnk"  # True
```

Launch the installed app with an isolated profile and probe it (bash):

```bash
TMPBASE=$(mktemp -d)
APPDATA="$TMPBASE" "$LOCALAPPDATA/Programs/ConvertX Desktop/bin/launcher.exe" &
# poll $TMPBASE/ConvertX-Electrobun/instance.json until control /ping answers,
# then curl http://127.0.0.1:17843/healthcheck -> {"status":"ok"}
# then taskkill //PID <lock pid> //T //F and rm -rf "$TMPBASE"
```

Silent uninstall and confirm removal + user-data survival:

```powershell
$unins = Get-ChildItem "$env:LOCALAPPDATA\Programs\ConvertX Desktop\unins*.exe" | Select-Object -First 1
Start-Process -Wait -FilePath $unins.FullName -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART"
# uninstaller hands off to a temp copy; poll for the dir to disappear
1..20 | ForEach-Object { if (Test-Path "$env:LOCALAPPDATA\Programs\ConvertX Desktop\bin") { Start-Sleep 1 } }
Test-Path "$env:LOCALAPPDATA\Programs\ConvertX Desktop\bin"   # False
Test-Path "$env:APPDATA\ConvertX-Electrobun"                  # True (user data kept)
```

- [ ] **Step 4: Commit nothing (verification only) — note any fixes as their own commits**

---

### Task 5: Workflows

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: ci.yml**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: windows-latest
    timeout-minutes: 40
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Cache converter binaries (keyed on the pin manifest)
        id: conv-cache
        uses: actions/cache@v6
        with:
          path: vendor/converters/win
          key: converters-${{ runner.os }}-${{ hashFiles('scripts/converter-manifest.json') }}

      - run: bun install --frozen-lockfile

      - name: Setup (vendor + converters + manifest)
        if: steps.conv-cache.outputs.cache-hit != 'true'
        run: bun run setup

      - name: Setup without converter re-download (cache hit)
        if: steps.conv-cache.outputs.cache-hit == 'true'
        run: bun run scripts/setup-convertx.ts && bun run scripts/write-vendor-manifest.ts

      - run: bun x tsc --noEmit
      - run: bun run test

      - name: Smoke test (headless end-to-end conversion, loopback assert)
        run: bun run scripts/smoke.ts
        timeout-minutes: 10
```

- [ ] **Step 2: release.yml**

```yaml
name: Release

on:
  push:
    tags: ["v*"]
  workflow_dispatch: # dry run: builds everything, uploads workflow artifacts, no release

permissions:
  contents: write

jobs:
  release:
    runs-on: windows-latest
    timeout-minutes: 90
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version-file: .bun-version

      - name: Version gate (tag must match package.json)
        if: github.ref_type == 'tag'
        shell: bash
        run: |
          TAG="${GITHUB_REF_NAME#v}"
          PKG="$(bun -e 'console.log(require("./package.json").version)')"
          if [ "$TAG" != "$PKG" ]; then
            echo "Tag v$TAG does not match package.json version $PKG" >&2
            exit 1
          fi

      - name: Cache converter binaries (keyed on the pin manifest)
        id: conv-cache
        uses: actions/cache@v6
        with:
          path: vendor/converters/win
          key: converters-${{ runner.os }}-${{ hashFiles('scripts/converter-manifest.json') }}

      - run: bun install --frozen-lockfile

      - name: Setup (vendor + converters + manifest)
        if: steps.conv-cache.outputs.cache-hit != 'true'
        run: bun run setup

      - name: Setup without converter re-download (cache hit)
        if: steps.conv-cache.outputs.cache-hit == 'true'
        run: bun run scripts/setup-convertx.ts && bun run scripts/write-vendor-manifest.ts

      - run: bun x tsc --noEmit
      - run: bun run test

      - name: Smoke test
        run: bun run scripts/smoke.ts
        timeout-minutes: 10

      - name: Package the app bundle
        run: bun run package

      - name: Ensure WebView2 Runtime (not guaranteed on the windows-2025 image)
        shell: pwsh
        run: |
          $key = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
          $pv = (Get-ItemProperty -Path $key -Name pv -ErrorAction SilentlyContinue).pv
          if ($pv -and $pv -ne "0.0.0.0") { Write-Host "WebView2 Runtime present: $pv"; exit 0 }
          Write-Host "Installing WebView2 Runtime..."
          Invoke-WebRequest "https://go.microsoft.com/fwlink/p/?LinkId=2124703" -OutFile "$env:TEMP\wv2setup.exe"
          Start-Process -Wait -FilePath "$env:TEMP\wv2setup.exe" -ArgumentList "/silent","/install"

      # GUI launch on a non-interactive runner: works per Tauri/WebView2 prior
      # art. If this step ever proves flaky, demote it to the local release
      # gate documented in RELEASING.md rather than blocking releases.
      - name: Verify packaged bundle (single instance, stale-lock takeover)
        run: bun run scripts/verify-packaged.ts
        timeout-minutes: 15

      - name: Ensure Inno Setup (preinstalled on current image; guard for churn)
        shell: pwsh
        run: |
          if (-not (Get-Command iscc -ErrorAction SilentlyContinue)) {
            choco install innosetup -y --no-progress
          }

      # ------------------------------------------------------------------
      # SIGNING INSERTION POINT (master plan §6.2 — track deferred by user).
      # When enabled: sign build\dev-win-x64\ConvertX-dev\bin\launcher.exe and
      # bun.exe HERE (before the installer compiles them in), then sign
      # dist\ConvertX-Desktop-*-Setup.exe after the "Build installer" step.
      # ------------------------------------------------------------------

      - name: Build installer
        run: bun run installer

      - name: Silent-install probe (install, verify, uninstall)
        shell: pwsh
        run: |
          $v = bun -e 'console.log(require("./package.json").version)'
          Start-Process -Wait -FilePath "dist\ConvertX-Desktop-$v-Setup.exe" -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART"
          $app = "$env:LOCALAPPDATA\Programs\ConvertX Desktop"
          if (-not (Test-Path "$app\bin\launcher.exe")) { throw "installed launcher missing" }
          if (Test-Path "$app\bin\app.log") { throw "build debris app.log shipped" }
          $unins = Get-ChildItem "$app\unins*.exe" | Select-Object -First 1
          Start-Process -Wait -FilePath $unins.FullName -ArgumentList "/VERYSILENT","/SUPPRESSMSGBOXES","/NORESTART"
          foreach ($i in 1..30) {
            if (-not (Test-Path "$app\bin\launcher.exe")) { break }
            Start-Sleep -Seconds 1
          }
          if (Test-Path "$app\bin\launcher.exe") { throw "uninstall left the app behind" }
          Write-Host "Silent install + uninstall OK"

      - name: Portable zip
        run: bun run portable
        timeout-minutes: 20

      - name: Release assets (checksums + notes)
        run: bun run release-assets

      - name: Upload artifacts (dry-run inspection)
        if: github.ref_type != 'tag'
        uses: actions/upload-artifact@v4
        with:
          name: release-dist
          path: dist/*

      - name: Draft GitHub release
        if: github.ref_type == 'tag'
        uses: softprops/action-gh-release@v3
        with:
          draft: true
          name: ConvertX Desktop ${{ github.ref_name }}
          body_path: dist/RELEASE-NOTES.md
          files: |
            dist/ConvertX-Desktop-*-Setup.exe
            dist/ConvertX-Desktop-*-portable.zip
            dist/SHA256SUMS.txt
```

- [ ] **Step 3: Commit**

```powershell
git add .github/workflows/ci.yml .github/workflows/release.yml
git commit -m @'
ci: add test workflow and tag-triggered draft-release pipeline

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Docs (RELEASING rewrite + README)

**Files:**
- Modify: `RELEASING.md` (rewrite the "Release steps" section)
- Modify: `README.md` (commands + known limitations)

- [ ] **Step 1: Rewrite the release steps in RELEASING.md**

Replace the header note and `## Release steps` section with:

```markdown
Releases are built by CI (`.github/workflows/release.yml`) from a version tag
and published as **drafts** for review. Binaries are **unsigned** (signing
track deferred — master plan §6.2; the workflow contains a marked signing
insertion point).

## Release steps

1. Bump `version` in `package.json` (single source of truth). Commit to main.
2. `git tag v<version> && git push origin v<version>`.
3. CI runs the full gate (tests, smoke, packaged verification, silent-install
   probe) and uploads installer + portable zip + `SHA256SUMS.txt` to a draft
   GitHub Release with generated notes.
4. Review the draft (spot-check the assets; ideally install on a clean VM),
   then **Publish**.

Dry run without a tag: trigger the Release workflow manually
(`gh workflow run release.yml`); it uploads the artifacts to the workflow run
instead of creating a release.

## Local fallback (CI outage)

`bun run dist` produces everything in `dist\` (needs Inno Setup:
`winget install JRSoftware.InnoSetup`). Create the release with
`gh release create v<version> --draft --title "ConvertX Desktop <version>" --notes-file dist/RELEASE-NOTES.md dist/ConvertX-Desktop-*`.
```

(Keep the "Inputs and where they are pinned" and "Updating pins" sections unchanged.)

- [ ] **Step 2: README updates**

In the commands block, after the `verify-packaged` line add:

```markdown
bun run dist               # package + installer + portable zip + checksums/notes
                           # (needs Inno Setup: winget install JRSoftware.InnoSetup)
```

In **Known limitations**, replace the bullet `- No installer and no auto-update; distribution is the raw bundle folder.` with:

```markdown
- No auto-update yet (Phase 3); install updates by running the newer installer.
```

and update the unsigned bullet to mention that releases carry SHA256 checksums.

- [ ] **Step 3: Commit**

```powershell
git add RELEASING.md README.md
git commit -m @'
docs: document the CI release process and installer distribution

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Push, CI green, dry-run green, ship v1.0.0

- [ ] **Step 1: Push and watch ci.yml**

```powershell
git push
gh run watch --exit-status
```

Expected: the CI workflow on main goes green (first run has no cache — full converter download). Fix-forward any CI-only failures as their own commits.

- [ ] **Step 2: Release dry run**

```powershell
gh workflow run release.yml
gh run watch --exit-status
```

Expected: green; `release-dist` artifact contains the four files. Iterate on failures.

- [ ] **Step 3: Bump to 1.0.0 and tag**

`package.json`: `"version": "1.0.0"`.

```powershell
git add package.json
git commit -m @'
release: v1.0.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
git push
git tag v1.0.0
git push origin v1.0.0
gh run watch --exit-status
```

Expected: release workflow green; draft release "ConvertX Desktop v1.0.0" with Setup exe, portable zip, SHA256SUMS.txt.

- [ ] **Step 4: Verify the draft + mark the phase complete**

```powershell
gh release view v1.0.0 --json name,isDraft,assets --jq '{name, isDraft, assets: [.assets[].name]}'
```

Update the master plan status line (append `; Phase 2 complete (2026-07-06, plan: ../plans/2026-07-06-phase2-installer-ci.md) — v1.0.0 draft release pending user publish`), commit, push.

---

## Self-review notes

- **Spec coverage:** iss (T2 = spec §4.1), build-installer (T3 §4.2), portable zip (T3 §4.3), release assets (T3 §4.4), workflows incl. dry-run + WebView2 + silent probe + signing insertion (T5 §4.5), rcedit + debris (T1 §4.6), RELEASING/README (T6 §4.7), local chain (T4 §7), v1.0.0 tag (T7). Dev-channel decision needs no code (spec §3).
- **Consistency:** artifact names identical across iss `OutputBaseFilename`, all three scripts, the workflow globs, and RELEASING. `bun run installer/portable/release-assets` names match package.json.
- **Judgment calls:** portable zip has a loose root (documented in notes); ISCC probed on PATH first (CI) then fixed paths (local per-user install); version stays 0.1.0 until the final task so local artifacts don't masquerade as 1.0.0.
