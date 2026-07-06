import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONTROL_APP_ID } from "./control";

/**
 * Single-instance lock file. `pid`/`controlPort`/`token` identify the running
 * supervisor; `convertxPid` is recorded after the child spawns so a later
 * launch can reap it if the supervisor was hard-killed (taskkill /F, crash)
 * and never ran its cleanup.
 */
export interface InstanceLock {
  pid: number;
  controlPort: number;
  token: string;
  convertxPid?: number;
}

export function lockFilePath(appDataDir: string): string {
  return join(appDataDir, "instance.json");
}

export function readLock(file: string): InstanceLock | undefined {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (
      typeof raw.pid !== "number" ||
      typeof raw.controlPort !== "number" ||
      typeof raw.token !== "string"
    ) {
      return undefined;
    }
    return {
      pid: raw.pid,
      controlPort: raw.controlPort,
      token: raw.token,
      ...(typeof raw.convertxPid === "number" ? { convertxPid: raw.convertxPid } : {}),
    };
  } catch {
    return undefined;
  }
}

export function writeLock(file: string, lock: InstanceLock): void {
  writeFileSync(file, `${JSON.stringify(lock, null, 2)}\n`);
}

export function updateLockChildPid(file: string, convertxPid: number): void {
  const lock = readLock(file);
  if (lock) writeLock(file, { ...lock, convertxPid });
}

export function removeLock(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch {
    // best effort
  }
}

/**
 * True only if the lock's control server answers /ping as our app with the
 * lock's pid — a stale file, a dead process, or an unrelated server on a
 * reused port all fail this check.
 */
export async function isLockAlive(lock: InstanceLock, timeoutMs = 1500): Promise<boolean> {
  if (lock.controlPort <= 0) return false;
  try {
    const res = await fetch(
      `http://127.0.0.1:${lock.controlPort}/ping?token=${lock.token}`,
      { signal: AbortSignal.timeout(timeoutMs) },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { app?: string; pid?: number };
    return body.app === CONTROL_APP_ID && body.pid === lock.pid;
  } catch {
    return false;
  }
}

/** Ask the running instance to raise its window. Best-effort. */
export async function requestFocus(lock: InstanceLock, timeoutMs = 1500): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${lock.controlPort}/focus?token=${lock.token}`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    // the window not raising is not fatal
  }
}

function defaultTasklist(pid: number): string {
  const result = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  return result.stdout ?? "";
}

/** True if tasklist reports `pid` running with the given image name. */
export function isProcessImage(
  pid: number,
  imageName: string,
  runTasklist: (pid: number) => string = defaultTasklist,
): boolean {
  const out = runTasklist(pid).toLowerCase();
  return out.includes(`"${imageName.toLowerCase()}","${pid}"`);
}

export interface ReapDeps {
  runTasklist?: (pid: number) => string;
  kill?: (pid: number) => void;
}

/**
 * Kill the ConvertX child recorded in a stale lock — but only after
 * verifying the pid still belongs to a bun.exe (PID reuse guard). Never
 * throws; cleanup must not block startup.
 */
export function reapStaleConvertx(
  lock: InstanceLock,
  log: (message: string) => void,
  deps: ReapDeps = {},
): void {
  const { convertxPid } = lock;
  if (!convertxPid) return;
  try {
    const runTasklist = deps.runTasklist ?? defaultTasklist;
    if (!isProcessImage(convertxPid, "bun.exe", runTasklist)) {
      log(`stale lock child pid ${convertxPid} is not bun.exe — not reaping`);
      return;
    }
    const kill =
      deps.kill ??
      ((pid: number) => spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"]));
    kill(convertxPid);
    log(`reaped stale ConvertX process tree (pid ${convertxPid})`);
  } catch (err) {
    log(`orphan reap failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
