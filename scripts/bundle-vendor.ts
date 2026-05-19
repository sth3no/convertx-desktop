import { cpSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const VENDOR_SRC = join(PROJECT_ROOT, "vendor");
const BUILD_DIR = join(PROJECT_ROOT, "build");

/**
 * Find the `app` code folder of a built Electrobun bundle under build/ — the
 * directory that contains a `views` subfolder (Resources/app). Returns the
 * first match found by depth-first search.
 */
function findAppCodeDir(dir: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isDirectory()) continue;
    if (entry === "app" && existsSync(join(full, "views"))) return full;
    const hit = findAppCodeDir(full);
    if (hit) return hit;
  }
  return undefined;
}

const appCodeDir = findAppCodeDir(BUILD_DIR);
if (!appCodeDir) {
  console.error(
    `No built app bundle found under ${BUILD_DIR}.\n` +
      `Run 'electrobun build' (or 'bun run build') first.`,
  );
  process.exit(1);
}
console.log(`Found app bundle code dir: ${appCodeDir}`);

for (const parts of [["convertx"], ["converters", "win"]]) {
  const src = join(VENDOR_SRC, ...parts);
  if (!existsSync(src)) {
    console.error(
      `Missing ${src}. Run the setup scripts (setup-convertx.ts, fetch-converters.ts) first.`,
    );
    process.exit(1);
  }
  const dest = join(appCodeDir, "vendor", ...parts);
  console.log(`Copying ${src}\n     -> ${dest}`);
  cpSync(src, dest, { recursive: true, dereference: true });
}

console.log("Vendored ConvertX + converters into the app bundle.");
