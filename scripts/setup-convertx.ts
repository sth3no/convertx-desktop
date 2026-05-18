import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTX_REPO = "https://github.com/C4illin/ConvertX.git";

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`> ${cmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

if (existsSync(join(CONVERTX_DIR, "package.json"))) {
  console.log(`ConvertX already vendored at ${CONVERTX_DIR} — skipping clone.`);
} else {
  run("git", ["clone", "--depth", "1", CONVERTX_REPO, CONVERTX_DIR], PROJECT_ROOT);
}

run("bun", ["install"], CONVERTX_DIR);
console.log("ConvertX is vendored and ready (unmodified).");
