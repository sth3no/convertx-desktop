# Releasing ConvertX Desktop

Releases are built by CI (`.github/workflows/release.yml`) from a version tag
and published as **drafts** for review. Binaries are **unsigned** (signing
track deferred — master plan §6.2; the workflow contains a marked signing
insertion point).

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

1. Bump `version` in `package.json` (single source of truth). Commit to main.
2. `git tag v<version> && git push origin v<version>`.
3. CI runs the full gate (tests, smoke, packaged verification, silent-install
   probe) and uploads installer + portable zip + `SHA256SUMS.txt` to a draft
   GitHub Release with generated notes (AGPL source ref included).
4. Review the draft (spot-check the assets; ideally install on a clean VM),
   then **Publish**.

Dry run without a tag: trigger the Release workflow manually
(`gh workflow run release.yml`); it uploads the artifacts to the workflow run
instead of creating a release.

## Local fallback (CI outage)

`bun run dist` produces everything in `dist\` (needs Inno Setup:
`winget install JRSoftware.InnoSetup`, or the jrsoftware.org installer with
`/CURRENTUSER` for a no-admin install). Then:
`gh release create v<version> --draft --title "ConvertX Desktop <version>" --notes-file dist/RELEASE-NOTES.md dist/ConvertX-Desktop-* dist/SHA256SUMS.txt`.

## Updating pins

- **ConvertX**: bump `CONVERTX_REF` in `scripts/lib/pins.ts`, delete
  `vendor/convertx`, `bun run setup`, re-verify the no-login env vars still
  exist upstream (master plan §7 "Upstream ConvertX drift"), run the smoke test.
- **Converters**: `bun run scripts/fetch-converters.ts --record`, review the
  manifest diff (versions and hashes), run the smoke test, commit.
- A hash mismatch on a *normal* fetch means the upstream file changed in place
  — investigate before re-recording; never re-record just to silence it.
