import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CONVERTX_REF, CONVERTX_REPO } from "./lib/pins";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");

function run(cmd: string, args: string[], cwd: string): void {
  console.log(`> ${cmd} ${args.join(" ")}  (cwd: ${cwd})`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed (exit ${result.status}): ${cmd} ${args.join(" ")}`);
  }
}

function gitOutput(args: string[], cwd: string): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed (exit ${result.status}): ${result.stderr}`);
  }
  return result.stdout.trim();
}

if (existsSync(join(CONVERTX_DIR, "package.json"))) {
  const head = gitOutput(["rev-parse", "HEAD"], CONVERTX_DIR);
  if (head !== CONVERTX_REF) {
    throw new Error(
      `vendor/convertx is at ${head},\nbut the pinned ref is  ${CONVERTX_REF}.\n` +
        `Delete vendor/convertx and re-run 'bun run setup' to re-vendor at the pin, or\n` +
        `update CONVERTX_REF in scripts/lib/pins.ts if this bump is intentional.`,
    );
  }
  console.log(`ConvertX already vendored at pinned ref ${CONVERTX_REF.slice(0, 7)} — skipping clone.`);
} else {
  // Fetch exactly the pinned commit (GitHub serves reachable-sha fetches),
  // depth 1 — same download size as the old unpinned shallow clone.
  mkdirSync(CONVERTX_DIR, { recursive: true });
  run("git", ["init"], CONVERTX_DIR);
  run("git", ["remote", "add", "origin", CONVERTX_REPO], CONVERTX_DIR);
  run("git", ["fetch", "--depth", "1", "origin", CONVERTX_REF], CONVERTX_DIR);
  run("git", ["checkout", "--detach", CONVERTX_REF], CONVERTX_DIR);
}

run("bun", ["install"], CONVERTX_DIR);
// ConvertX runs in production mode in the packaged app, which serves a
// pre-built Tailwind stylesheet. Compile it now (same command as ConvertX's
// own `build` script, CSS half only). ConvertX pins @tailwindcss/cli in its
// own package.json + bun.lock and `bun x` resolves the locally installed
// copy first, so this toolchain is pinned transitively by CONVERTX_REF.
run(
  "bun",
  ["x", "@tailwindcss/cli", "-i", "./src/main.css", "-o", "./public/generated.css"],
  CONVERTX_DIR,
);
console.log("ConvertX is vendored and ready (unmodified, CSS pre-built).");
