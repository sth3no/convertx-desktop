# File Associations ("Open with ConvertX") Installer Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.
> **Suitability:** Opus-class. The hard plumbing is DONE and verified (see `docs/superpowers/specs/2026-07-07-file-handoff-design.md`); this plan is the Inno Setup registry work + verification.

**Goal:** After installing, right-clicking a common convertible file shows "Open with → ConvertX Desktop"; choosing it launches (or focuses) the app with the file queued at `GET /pending-files` (frontend consumes it — separate work).

**Non-negotiable facts (verified 2026-07-07):**
- Association target MUST be `"{app}\bin\bun.exe" "{app}\Resources\main.js" "%1"` — `launcher.exe` drops argv (Electrobun #483, empirically confirmed). Direct bun.exe launch from arbitrary cwd is supported (bootstrap-cwd fix) and covered by `scripts/verify-packaged.ts`.
- Use `OpenWithProgIds` registrations only — NEVER claim default associations (the app must not steal file types).
- Per-user install → registry root `HKA` (maps to HKCU under `PrivilegesRequired=lowest`); add `ChangesAssociations=yes` to `[Setup]` so Explorer refreshes.

**Extension set (curated, matches bundled converters):** `.png .jpg .jpeg .webp .gif .bmp .tiff .heic .svg .pdf .docx .md .html .epub .mp4 .mkv .avi .mov .mp3 .wav .flac .json .yaml .toml .csv`.

**Files:** modify `installer/ConvertX-Desktop.iss` only, plus a manual verification pass.

---

- [ ] **Task 1:** Add to `[Setup]`: `ChangesAssociations=yes`. Add a ProgID + OpenWith entries in `[Registry]` (define the extension list once via an ISPP `#define` + loop to avoid 25 hand-written blocks):

```innosetup
[Registry]
; ProgID describing the app's open verb (per-user, HKA -> HKCU).
Root: HKA; Subkey: "Software\Classes\ConvertXDesktop.File"; ValueType: string; ValueData: "ConvertX Desktop"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\ConvertXDesktop.File\DefaultIcon"; ValueType: string; ValueData: "{app}\bin\launcher.exe,0"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\ConvertXDesktop.File\shell\open\command"; ValueType: string; ValueData: """{app}\bin\bun.exe"" ""{app}\Resources\main.js"" ""%1"""; Flags: uninsdeletekey

#define Exts ".png,.jpg,.jpeg,.webp,.gif,.bmp,.tiff,.heic,.svg,.pdf,.docx,.md,.html,.epub,.mp4,.mkv,.avi,.mov,.mp3,.wav,.flac,.json,.yaml,.toml,.csv"
#define i 0
#sub RegisterExt
Root: HKA; Subkey: "Software\Classes\{#Copy(Exts, i, Pos(",", Copy(Exts, i, 99)) ... )}"
#endsub
```

⚠ ISPP string-splitting loops are fiddly — if the `#sub` loop fights back, generate the 25 `OpenWithProgIds` lines with a one-off script and paste them literally; each is:

```innosetup
Root: HKA; Subkey: "Software\Classes\.png\OpenWithProgids"; ValueType: none; ValueName: "ConvertXDesktop.File"; ValueType: string; ValueData: ""; Flags: uninsdeletevalue
```

(one line per extension; `uninsdeletevalue` removes only our value on uninstall, leaving the extension key intact).

- [ ] **Task 2:** Rebuild + verify locally: `bun run package && bun run installer`, silent-install, then: right-click a `.png` → "Open with" lists **ConvertX Desktop**; choosing it boots the app; `GET /pending-files` (token from `%APPDATA%\ConvertX-Electrobun\instance.json`) lists the file; opening a second file while running focuses the window and appends to the queue. Silent-uninstall → the OpenWith entry disappears (check `HKCU\Software\Classes\.png\OpenWithProgids`).
- [ ] **Task 3:** Update `docs/API.md` (pending-files section: associations now live) and README known-limitations if it mentions associations. Commit `feat: register Open with ConvertX file associations (per-user)`.
