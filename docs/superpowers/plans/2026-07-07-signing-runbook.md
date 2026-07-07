# Code-Signing Runbook (both tracks)

> **Suitability:** Opus-class execution once the USER picks a track (decision still open — master plan §6.2). Prices/eligibility researched 2026-07-06; re-verify before purchase.
> The release workflow already contains a marked **SIGNING INSERTION POINT** (`.github/workflows/release.yml`): sign `build\dev-win-x64\ConvertX-dev\bin\launcher.exe` + `bun.exe` there (AFTER the vendor bake — rcedit invalidates signatures — and BEFORE "Build installer"), then sign `dist\ConvertX-Desktop-*-Setup.exe` after it.

## Track A: Azure Artifact Signing (needs a registered business entity — EU orgs OK, EU individuals NOT eligible)

1. Azure: paid subscription (free/trial rejected) → create an Artifact Signing account (Basic, $9.99/mo) → org identity validation (business records; 1–20 business days).
2. Create a certificate profile (Public Trust). Note account name, profile name, endpoint region.
3. GitHub: OIDC federated credential for the repo (avoid secrets) with the Trusted Signing Certificate Profile Signer role.
4. Workflow: insert `azure/artifact-signing-action@v1` (formerly trusted-signing-action) at BOTH insertion points, files-list pointing at the two exes / the Setup exe. Timestamp server `http://timestamp.acs.microsoft.com` is handled by the action (mandatory — certs live 72 h).
5. Verify: `signtool verify /pa /v` on both artifacts in a post-step; release a `vX.Y.Z+1` and confirm the published assets are signed; SmartScreen reputation still builds gradually — keep the README note until warnings stop.

## Track B: Certum Open Source cert (EU individual, ~€69 first year + smartcard, ~€29/yr renewal)

1. Order "Open Source Code Signing" at certum.store with the cryptoCertum smartcard + reader set. Identity verification (IDNow) + proof of the OSS project (this repo). Ships physically — weeks of lead time.
2. Install proCertum CardManager + the Certum middleware; import/activate the cert on the card. Known friction: "No key provider information" errors → certutil repair documented at piers.rocks/2025/10/30/certum-open-source-code-sign.html.
3. Signing is LOCAL-ONLY (key on card). Add `scripts/sign-artifacts.ps1`: `signtool sign /n "Open Source Developer, Vojtěch Stehlík" /tr http://time.certum.pl /td sha256 /fd sha256 <files>`; sign the two bundle exes after `bun run package`, then run `bun run installer`, then sign the Setup exe, then `bun run portable && bun run release-assets`.
4. Release flow becomes the RELEASING.md "local fallback" path (CI can't sign — card is physical): CI dry-run for gating, local `bun run dist` + sign + `gh release create --draft`. Alternatively: self-hosted runner with the card attached (only if release cadence justifies it).

## Track C (parallel, free): SignPath Foundation

Apply at signpath.org (OSI license ✓ AGPL, public repo ✓, active maintenance ✓). If accepted, their GitHub App/CI integration signs release artifacts; wire per their docs at the same insertion points. Can coexist with either track.

## After any track lands

- Remove the SmartScreen warning paragraph from `scripts/make-release-assets.ts` release notes and README known-limitations (keep the checksums note).
- Update master plan §Status.
