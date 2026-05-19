import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Pick the vendor directory. Prefers `packagedVendor` (the copy baked into a
 * packaged app bundle); falls back to `devVendor` (the project-root `vendor/`
 * used during development). Throws if neither contains ConvertX.
 */
export function pickVendorDir(packagedVendor: string, devVendor: string): string {
  if (existsSync(join(packagedVendor, "convertx", "package.json"))) return packagedVendor;
  if (existsSync(join(devVendor, "convertx", "package.json"))) return devVendor;
  throw new Error(
    `ConvertX not found. Looked in:\n  ${packagedVendor}\n  ${devVendor}\n` +
      `For a dev run, run 'bun run scripts/setup-convertx.ts' first.`,
  );
}

/**
 * Ensure a writable copy of ConvertX exists at `dest`, copied from the
 * (possibly read-only) `src` on first run. A no-op once `dest` exists — delete
 * `dest` to force a refresh after updating the vendored ConvertX.
 */
export function ensureConvertxCopy(src: string, dest: string): void {
  if (existsSync(join(dest, "package.json"))) return;
  cpSync(src, dest, { recursive: true, dereference: true });
}
