# Releasing ConvertX Desktop

Phase 0 state: releases are built locally and are **unsigned** (signing track
deferred — master plan §6.2). CI, the installer, and auto-update arrive in
Phases 2–3.

## Inputs and where they are pinned

| Input | Pin |
|---|---|
| ConvertX source | `scripts/lib/pins.ts` (`CONVERTX_REF`) |
| Converter binaries | `scripts/converter-manifest.json` (URL + sha256 each) |
| Bun | `.bun-version` |
| Electrobun | `package.json` / `bun.lock` |
| Tailwind CLI | transitively via `CONVERTX_REF` (ConvertX's own lockfile) |
| App version | `package.json` `version` (electrobun.config.ts reads it) |

## Release steps

1. Bump `version` in `package.json` (semver). Commit.
2. Clean build from pinned inputs:
   ```powershell
   bun install
   bun run setup        # vendors ConvertX at the pin, hash-verifies converters,
                        # writes vendor/vendor-manifest.json
   bun run test
   bun run scripts/smoke.ts
   bun run package      # electrobun build + vendor bake (incl. the manifest)
   ```
3. Zip the bundle:
   ```powershell
   Compress-Archive -Path build\dev-win-x64\ConvertX-dev\* -DestinationPath ConvertX-Desktop-<version>-win-x64.zip
   ```
4. Create a GitHub Release for the tag with:
   - the zip;
   - a `SHA256SUMS.txt` (`Get-FileHash` output for every asset);
   - the exact vendored ConvertX commit (from `vendor/vendor-manifest.json`) and
     a source link: `https://github.com/C4illin/ConvertX/tree/<ref>` — this is
     the AGPL source offer for the ConvertX code being distributed;
   - a note that binaries are unsigned and SmartScreen will warn
     ("More info → Run anyway").

## Updating pins

- **ConvertX**: bump `CONVERTX_REF` in `scripts/lib/pins.ts`, delete
  `vendor/convertx`, `bun run setup`, re-verify the no-login env vars still
  exist upstream (master plan §7 "Upstream ConvertX drift"), run the smoke test.
- **Converters**: `bun run scripts/fetch-converters.ts --record`, review the
  manifest diff (versions and hashes), run the smoke test, commit.
- A hash mismatch on a *normal* fetch means the upstream file changed in place
  — investigate before re-recording; never re-record just to silence it.
