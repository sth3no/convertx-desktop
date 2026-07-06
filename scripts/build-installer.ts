import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
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
const ISS_FILE = join(PROJECT_ROOT, "installer", "ConvertX-Desktop.iss");
const DIST_DIR = join(PROJECT_ROOT, "dist");

/** Locate ISCC: PATH (CI choco shim) -> per-user install -> machine install. */
function findIscc(): string | undefined {
  const probe = spawnSync("iscc", ["/?"], { encoding: "utf8" });
  if (!probe.error) return "iscc";
  const fixed = [
    join(process.env.LOCALAPPDATA ?? "", "Programs", "Inno Setup 6", "ISCC.exe"),
    "C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe",
    "C:\\Program Files\\Inno Setup 6\\ISCC.exe",
  ];
  return fixed.find((c) => c && existsSync(c));
}

if (!existsSync(join(BUNDLE_DIR, "bin", "launcher.exe"))) {
  console.error(`No packaged bundle at ${BUNDLE_DIR} — run 'bun run package' first.`);
  process.exit(1);
}
const iscc = findIscc();
if (!iscc) {
  console.error(
    "Inno Setup (ISCC.exe) not found. Install it:\n" +
      "  winget install JRSoftware.InnoSetup     (or: choco install innosetup)\n" +
      "  or download https://jrsoftware.org/isdl.php and install with /CURRENTUSER",
  );
  process.exit(1);
}
mkdirSync(DIST_DIR, { recursive: true });
console.log(`ISCC: ${iscc}`);
const result = spawnSync(
  iscc,
  [`/DAppVersion=${pkg.version}`, `/DBundleDir=${BUNDLE_DIR}`, ISS_FILE],
  { stdio: "inherit" },
);
if (result.status !== 0) {
  console.error(`ISCC failed (exit ${result.status ?? "unknown"}).`);
  process.exit(result.status ?? 1);
}
const out = join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-Setup.exe`);
if (!existsSync(out)) {
  console.error(`ISCC reported success but ${out} is missing.`);
  process.exit(1);
}
console.log(`Installer: ${out}`);
