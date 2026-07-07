# winget Submission + Housekeeping Runbook

> **Suitability:** Opus-class (or human). Prerequisite: the v1.0.0 GitHub release is **published** (it exists as a draft; publishing is a user action).

## A. winget submission (first time)

Facts (verified 2026-07): the community repo `microsoft/winget-pkgs` accepts **unsigned** `.exe` installers; Inno's `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART` satisfies the silent-install validation; each version is a PR; `winget-releaser` automation needs one already-published version + a classic PAT + a fork.

- [ ] 1. Publish v1.0.0 (user). Confirm the asset URL is immutable: `https://github.com/sth3no/convertx-desktop/releases/download/v1.0.0/ConvertX-Desktop-1.0.0-Setup.exe`.
- [ ] 2. Generate manifests: `wingetcreate new <that URL>` (or `komac new`). Identifier: `VojtechStehlik.ConvertXDesktop`. InstallerType `inno`, scope `user`. Fill license (AGPL-3.0), homepage, short description from the README intro.
- [ ] 3. Validate locally: `winget validate <manifest dir>` and `winget install --manifest <dir>` on a clean profile.
- [ ] 4. `wingetcreate submit` (opens the PR from a fork). Address automated-pipeline feedback; human moderation takes days.
- [ ] 5. Automation for future releases: fork `microsoft/winget-pkgs`, add a repo secret `WINGET_PAT` (classic PAT, `public_repo`), append a `vedantmgoyal9/winget-releaser` job to `.github/workflows/release.yml` gated on `release.published` — note releases published from a draft created by GITHUB_TOKEN do NOT retrigger workflows; use the `release: types: [published]` trigger which fires on the manual publish action.

## B. Housekeeping (do in one small PR)

- [ ] `actions/checkout@v4` → `@v5` in both workflows (v4 targets deprecated Node 20 — CI prints a warning on every run).
- [ ] Add `docs/API.md` + `RELEASING.md` links to the README top (discoverability).
- [ ] Electrobun policy note in README known-limitations: pinned to 1.18.1 deliberately (single-maintainer project mid-2.0-rewrite; every upgrade needs the full smoke + verify-packaged gate; do NOT track 1.18.4 betas).

## C. Upstream ConvertX bump (when desired — runbook already in RELEASING.md)

`scripts/lib/pins.ts` → new sha → delete `vendor/convertx` → `bun run setup` → re-verify the no-login env vars still exist upstream (`ALLOW_UNAUTHENTICATED`, `UNAUTHENTICATED_USER_SHARING`, `HTTP_ALLOWED` in upstream `src/helpers/env.ts` / `src/pages/user.tsx`) → `bun run test && bun run scripts/smoke.ts` → commit.
