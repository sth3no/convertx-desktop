/**
 * Top-level entries of vendor/convertx that must never be copied anywhere:
 * `data` holds runtime state (sqlite DB, uploads, conversion outputs) and
 * `.git` the clone history. Shared by the supervisor's first-run copy
 * (src/bun/bundle.ts) and the packaging bake (scripts/bundle-vendor.ts).
 */
export const EXCLUDED_CONVERTX_ENTRIES = [".git", "data"] as const;

/**
 * Filename of the manifest recording exactly what vendor/ contains (upstream
 * ConvertX ref, converter versions/URLs/hashes). Written by
 * scripts/write-vendor-manifest.ts, baked into the bundle next to vendor/.
 */
export const VENDOR_MANIFEST_NAME = "vendor-manifest.json";
