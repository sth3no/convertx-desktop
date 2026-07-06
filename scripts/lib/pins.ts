/** Upstream ConvertX repository vendored (unmodified) into vendor/convertx. */
export const CONVERTX_REPO = "https://github.com/C4illin/ConvertX.git";

/**
 * Pinned upstream commit: v0.17.0 plus the path-traversal fix (upstream PR
 * #532, 2026-04-27). To bump: update this sha, delete vendor/convertx, run
 * 'bun run setup', re-verify the no-login env flags still exist upstream
 * (master plan §7, "Upstream ConvertX drift"), and run the smoke test.
 */
export const CONVERTX_REF = "0965928949319e2839770fbf57a8337440d42630";
