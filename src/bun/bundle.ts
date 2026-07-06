import { cpSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { EXCLUDED_CONVERTX_ENTRIES } from "../shared/vendor-spec";

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

export type CopyResult = "created" | "refreshed" | "unchanged";
export type CopyStage = "first-copy" | "refresh";

/** Marker inside the app-data copy recording which vendor manifest built it. */
const COPY_MARKER = ".vendor-manifest.json";

/**
 * Stage a filtered copy of `src` at `dest + ".partial"`. Top-level `data/`
 * and `.git/` are never copied (runtime/developer state). A leftover
 * `.partial` from a crashed previous run is stale by definition — discarded.
 * Compare resolved paths so separator differences can't defeat the filter;
 * nested dirs with the same names (e.g. src/data) are source and must be kept.
 */
function stagePartialCopy(src: string, dest: string): string {
  const excluded = new Set(EXCLUDED_CONVERTX_ENTRIES.map((entry) => resolve(src, entry)));
  const partial = `${dest}.partial`;
  rmSync(partial, { recursive: true, force: true });
  cpSync(src, partial, {
    recursive: true,
    dereference: true,
    filter: (source) => !excluded.has(resolve(source)),
  });
  return partial;
}

/**
 * Ensure a writable, current copy of ConvertX exists at `dest`.
 *
 * - No copy yet -> copy `src` into place ("created").
 * - Copy exists and `vendorManifestFile` matches the marker recorded inside
 *   the copy -> no-op ("unchanged").
 * - Copy exists but the manifest differs (an app update shipped a new vendor)
 *   or the marker is missing (pre-Phase-1 copy) -> staged refresh that
 *   preserves the copy's `data/` (uploads, outputs, SQLite DB): the new copy
 *   is fully staged first, the old `data/` is moved in, then directories are
 *   swapped ("refreshed").
 *
 * Every mutation is staged in `dest + ".partial"` and renamed into place, so
 * an interrupted run self-heals on the next launch. Without a manifest file
 * the legacy behavior is kept: copy once, never refresh.
 */
export function ensureConvertxCopy(
  src: string,
  dest: string,
  vendorManifestFile?: string,
  onStage?: (stage: CopyStage) => void,
): CopyResult {
  const manifest =
    vendorManifestFile && existsSync(vendorManifestFile)
      ? readFileSync(vendorManifestFile, "utf8")
      : undefined;
  const markerFile = join(dest, COPY_MARKER);

  if (existsSync(join(dest, "package.json"))) {
    if (manifest === undefined) return "unchanged";
    const marker = existsSync(markerFile) ? readFileSync(markerFile, "utf8") : undefined;
    if (marker === manifest) return "unchanged";

    onStage?.("refresh");
    const partial = stagePartialCopy(src, dest);
    // Preserve user state: data/ moves from the old copy into the staged one
    // only after the stage completed, so a crash before this point leaves the
    // old copy fully intact.
    const oldData = join(dest, "data");
    if (existsSync(oldData)) renameSync(oldData, join(partial, "data"));
    writeFileSync(join(partial, COPY_MARKER), manifest);
    const trash = `${dest}.old`;
    rmSync(trash, { recursive: true, force: true });
    renameSync(dest, trash);
    renameSync(partial, dest);
    rmSync(trash, { recursive: true, force: true });
    return "refreshed";
  }

  onStage?.("first-copy");
  const partial = stagePartialCopy(src, dest);
  if (manifest !== undefined) writeFileSync(join(partial, COPY_MARKER), manifest);
  // A dest without package.json is a half-copy from before staging existed —
  // clear it so the rename can land.
  rmSync(dest, { recursive: true, force: true });
  renameSync(partial, dest);
  return "created";
}
