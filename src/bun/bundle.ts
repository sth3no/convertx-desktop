import { cpSync, existsSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Pick the vendor directory from `candidates`, in order: the first one
 * containing `convertx/package.json` wins. Candidates that don't exist (e.g.
 * the dev-tree candidate inside a packaged install) are skipped harmlessly.
 * Throws an error listing every candidate if none contains ConvertX.
 */
export function pickVendorDir(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "convertx", "package.json"))) return candidate;
  }
  throw new Error(
    `ConvertX not found. Looked in:\n${candidates.map((c) => `  ${c}`).join("\n")}\n` +
      `For a dev run, run 'bun run setup' first. For a built bundle, build with ` +
      `'bun run package' (plain 'bun run build' does not bake vendor/ into the app).`,
  );
}

/**
 * Ensure a writable copy of ConvertX exists at `dest`, copied from the
 * (possibly read-only) `src` on first run. A no-op once `dest/package.json`
 * exists — delete `dest` to force a refresh after updating the vendored
 * ConvertX.
 *
 * The copy is atomic-ish: it lands in `dest + ".partial"` first and is renamed
 * into place, so an interrupted run self-heals on the next launch instead of
 * leaving a half-copy that passes the package.json check. Top-level `data/`
 * and `.git/` in `src` are never copied (runtime/developer state, not app
 * source).
 */
export function ensureConvertxCopy(src: string, dest: string): void {
  if (existsSync(join(dest, "package.json"))) return;
  // Exclude runtime/developer state from the copy: the TOP-LEVEL "data" dir
  // (ConvertX recreates ./data on boot) and ".git". Compare resolved paths so
  // separator differences can't defeat the filter; nested dirs with the same
  // names (e.g. src/data) are source and must be kept.
  const excluded = new Set([resolve(src, "data"), resolve(src, ".git")]);
  // Copy to a sibling temp dir, then rename into place, so a crash mid-copy
  // never leaves a half-populated `dest` that looks complete. A leftover
  // `.partial` from a previous crash is stale by definition — discard it.
  const partial = `${dest}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(src, partial, {
    recursive: true,
    dereference: true,
    filter: (source) => !excluded.has(resolve(source)),
  });
  // A dest without package.json is a partial from before the copy was atomic
  // (the early-return above already handled the completed case) — clear it so
  // the rename can land.
  rmSync(dest, { recursive: true, force: true });
  renameSync(partial, dest);
}
