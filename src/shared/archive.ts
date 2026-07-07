import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Extract a .zip or .7z with the system bsdtar (libarchive) — present in
 * System32 on Windows 10/11. A bare "tar" may resolve to Git-for-Windows'
 * GNU tar, which cannot read zip/7z, hence the absolute path.
 */
export function extractArchive(archivePath: string, destDir: string): void {
  const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const tar = existsSync(systemTar) ? systemTar : "tar";
  const result = spawnSync(tar, ["-xf", archivePath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tar failed to extract ${archivePath}`);
}

/** Recursively find the first file named `name` (case-insensitive) under `dir`. */
export function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return undefined;
}
