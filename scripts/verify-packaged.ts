/**
 * Integration checks against the PACKAGED bundle (bun run package first).
 * Uses an isolated APPDATA so the real profile is untouched. The app window
 * will appear briefly — this script is a local gate, not part of `bun test`.
 *
 * Verifies the Phase 1 done-when items that are scriptable:
 *   1. packaged app boots healthy (lock file + control /ping)
 *   2. second launch exits quickly and leaves the first instance running
 *   3. hard-killing the supervisor kills the direct child too (Bun's
 *      kill-on-close job object — verified empirically) and leaves a stale
 *      lock; the next launch takes the lock over and boots healthy. The
 *      reapStaleConvertx path is defense-in-depth for children that escape
 *      the job object; its logic is unit-tested in src/bun/instance.test.ts.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const LAUNCHER = join(PROJECT_ROOT, "build", "dev-win-x64", "ConvertX-dev", "bin", "launcher.exe");

interface Lock {
  pid: number;
  controlPort: number;
  token: string;
  convertxPid?: number;
}

function readLock(file: string): Lock | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Lock;
  } catch {
    return undefined;
  }
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function pingOk(lock: Lock): Promise<boolean> {
  if (lock.controlPort <= 0) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${lock.controlPort}/ping?token=${lock.token}`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string };
    return body.app === "convertx-desktop";
  } catch {
    return false;
  }
}

async function waitFor(
  desc: string,
  timeoutMs: number,
  probe: () => boolean | Promise<boolean>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await Bun.sleep(500);
  }
  throw new Error(`Timed out waiting for ${desc}`);
}

function launch(appDataBase: string) {
  return spawn(LAUNCHER, [], {
    env: { ...process.env, APPDATA: appDataBase },
    stdio: "ignore",
  });
}

async function main(): Promise<void> {
  if (!existsSync(LAUNCHER)) {
    throw new Error(`No packaged bundle at ${LAUNCHER} — run 'bun run package' first.`);
  }
  const base = mkdtempSync(join(tmpdir(), "cx-verify-"));
  const lockFile = join(base, "ConvertX-Electrobun", "instance.json");
  console.log(`app-data base: ${base}`);
  let lastSupervisorPid = 0;

  try {
    // 1. First launch reaches healthy.
    launch(base);
    await waitFor("first instance healthy", 120_000, async () => {
      const lock = readLock(lockFile);
      return !!lock && (await pingOk(lock));
    });
    const lock1 = readLock(lockFile)!;
    lastSupervisorPid = lock1.pid;
    console.log(`OK first instance healthy (supervisor pid ${lock1.pid})`);

    await waitFor("child pid recorded in lock", 120_000, () => !!readLock(lockFile)?.convertxPid);
    const childPid1 = readLock(lockFile)!.convertxPid!;
    console.log(`OK convertx child pid recorded (${childPid1})`);

    // Read-only probes of the local API surface (contract: docs/API.md).
    const api = async (path: string) => {
      const sep = path.includes("?") ? "&" : "?";
      const res = await fetch(
        `http://127.0.0.1:${lock1.controlPort}${path}${sep}token=${lock1.token}`,
      );
      if (!res.ok) throw new Error(`${path} -> ${res.status}`);
      return res.json();
    };
    const info = (await api("/info")) as { version?: string; convertx?: { status?: string } };
    if (!info.version) throw new Error("/info missing version");
    console.log(`OK /info (version ${info.version}, convertx ${info.convertx?.status})`);
    const packList = (await api("/packs")) as unknown[];
    if (!Array.isArray(packList) || packList.length < 2) throw new Error("/packs registry empty");
    console.log(`OK /packs (${packList.length} packs listed)`);
    const settingsBody = (await api("/settings")) as { autoDeleteHours?: number };
    if (typeof settingsBody.autoDeleteHours !== "number") throw new Error("/settings malformed");
    const update = (await api("/update/status")) as { state?: string };
    if (!update.state) throw new Error("/update/status malformed");
    console.log(`OK /settings + /update/status (update state: ${update.state})`);

    // 2. Second launch exits fast; first instance keeps the lock and stays healthy.
    const second = launch(base);
    await waitFor("second launch to exit", 20_000, () => second.exitCode !== null);
    const lockAfter = readLock(lockFile)!;
    if (lockAfter.pid !== lock1.pid) throw new Error("second launch stole the instance lock");
    if (!(await pingOk(lockAfter))) throw new Error("first instance unhealthy after second launch");
    console.log("OK single instance (second launch exited; first still healthy)");

    // 3. Hard-kill the supervisor only (no /T). Bun's kill-on-close job
    //    object takes the direct child down with it; cleanup never ran, so
    //    the lock file is left stale. The relaunch must take it over.
    spawnSync("taskkill", ["/PID", String(lock1.pid), "/F"]);
    await waitFor("child to die with the supervisor (job object)", 10_000, () =>
      !processAlive(childPid1),
    );
    console.log("OK supervisor hard-killed; job object took the child down");
    if (!existsSync(lockFile)) {
      throw new Error("hard kill unexpectedly removed the lock file — stale-lock path untested");
    }

    launch(base);
    await waitFor("relaunch healthy under a new pid (stale-lock takeover)", 120_000, async () => {
      const lock = readLock(lockFile);
      return !!lock && lock.pid !== lock1.pid && (await pingOk(lock));
    });
    lastSupervisorPid = readLock(lockFile)!.pid;
    console.log("OK relaunch took over the stale lock and reached healthy");

    console.log("\nVERIFY-PACKAGED PASSED");
  } finally {
    const lock = readLock(lockFile);
    const pids = new Set(
      [lock?.pid, lock?.convertxPid, lastSupervisorPid].filter(
        (pid): pid is number => typeof pid === "number" && pid > 0,
      ),
    );
    for (const pid of pids) spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]);
    await Bun.sleep(1_000);
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(base, { recursive: true, force: true });
        break;
      } catch {
        await Bun.sleep(500);
      }
    }
  }
}

main().catch((err) => {
  console.error(`\nVERIFY-PACKAGED FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
