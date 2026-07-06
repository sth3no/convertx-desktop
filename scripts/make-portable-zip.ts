import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import electrobunConfig from "../electrobun.config";
import pkg from "../package.json";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const BUNDLE_DIR = join(
  PROJECT_ROOT,
  "build",
  "dev-win-x64",
  `${electrobunConfig.app.name}-dev`,
);
const DIST_DIR = join(PROJECT_ROOT, "dist");
const OUT = join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-win-x64-portable.zip`);

if (!existsSync(join(BUNDLE_DIR, "bin", "launcher.exe"))) {
  console.error(`No packaged bundle at ${BUNDLE_DIR} — run 'bun run package' first.`);
  process.exit(1);
}
mkdirSync(DIST_DIR, { recursive: true });
rmSync(OUT, { force: true });
// Zip the bundle CONTENTS (bin/, Resources/, lib/ at the zip root) — the
// release notes tell users to extract into an empty folder. bin\app.log is
// already scrubbed by bundle-vendor.ts.
const result = spawnSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -Path "${BUNDLE_DIR}\\*" -DestinationPath "${OUT}" -CompressionLevel Optimal`,
  ],
  { stdio: "inherit" },
);
if (result.status !== 0 || !existsSync(OUT)) {
  console.error(`Compress-Archive failed (exit ${result.status ?? "unknown"}).`);
  process.exit(1);
}
console.log(`Portable zip: ${OUT}`);
