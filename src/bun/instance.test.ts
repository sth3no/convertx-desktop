import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startControlServer, type ControlServer } from "./control";
import {
  isLockAlive,
  isProcessImage,
  lockFilePath,
  readLock,
  reapStaleConvertx,
  removeLock,
  requestFocus,
  sendFiles,
  updateLockChildPid,
  writeLock,
} from "./instance";

let control: ControlServer | undefined;
afterEach(() => {
  control?.stop();
  control = undefined;
});

function tempLockFile(): string {
  return lockFilePath(mkdtempSync(join(tmpdir(), "cx-lock-")));
}

test("write/read/update/remove lock round-trip", () => {
  const file = tempLockFile();
  writeLock(file, { pid: 123, controlPort: 45678, token: "t" });
  expect(readLock(file)).toEqual({ pid: 123, controlPort: 45678, token: "t" });
  updateLockChildPid(file, 999);
  expect(readLock(file)?.convertxPid).toBe(999);
  removeLock(file);
  expect(existsSync(file)).toBe(false);
});

test("readLock returns undefined for missing or malformed files", () => {
  const file = tempLockFile();
  expect(readLock(file)).toBeUndefined();
  writeFileSync(file, "{broken");
  expect(readLock(file)).toBeUndefined();
  writeFileSync(file, JSON.stringify({ pid: "nope" }));
  expect(readLock(file)).toBeUndefined();
});

test("isLockAlive is true only for a live control server with matching pid", async () => {
  let focused = 0;
  control = startControlServer({
    handlers: {
      onFocus: () => focused++,
      onRestart: () => {},
      onOpenExternal: () => {},
    },
  });
  const live = { pid: process.pid, controlPort: control.port, token: control.token };
  expect(await isLockAlive(live)).toBe(true);

  // Wrong pid in the lock (stale file reused by another process) -> not alive.
  expect(await isLockAlive({ ...live, pid: process.pid + 1 })).toBe(false);
  // Wrong token -> not alive.
  expect(await isLockAlive({ ...live, token: "wrong" })).toBe(false);
  // Dead port -> not alive (fast).
  expect(await isLockAlive({ pid: 1, controlPort: 1, token: "t" })).toBe(false);
  // Port 0 (control server failed at write time) -> not alive, no fetch.
  expect(await isLockAlive({ pid: 1, controlPort: 0, token: "t" })).toBe(false);

  await requestFocus(live);
  expect(focused).toBe(1);
});

test("isProcessImage matches tasklist CSV output for the pid", () => {
  const csv = `"bun.exe","4242","Console","1","120,000 K"\r\n`;
  expect(isProcessImage(4242, "bun.exe", () => csv)).toBe(true);
  expect(isProcessImage(4242, "ffmpeg.exe", () => csv)).toBe(false);
  expect(isProcessImage(4243, "bun.exe", () => csv)).toBe(false);
  expect(isProcessImage(4242, "bun.exe", () => "INFO: No tasks are running.")).toBe(false);
});

test("reapStaleConvertx kills only verified bun.exe pids", () => {
  const killed: number[] = [];
  const logs: string[] = [];
  const deps = {
    runTasklist: () => `"bun.exe","555","Console","1","1,000 K"`,
    kill: (pid: number) => killed.push(pid),
  };
  reapStaleConvertx(
    { pid: 1, controlPort: 0, token: "", convertxPid: 555 },
    (m) => logs.push(m),
    deps,
  );
  expect(killed).toEqual([555]);

  // Image mismatch (pid was reused by another program) -> no kill.
  killed.length = 0;
  reapStaleConvertx(
    { pid: 1, controlPort: 0, token: "", convertxPid: 777 },
    (m) => logs.push(m),
    {
      runTasklist: () => `"notepad.exe","777","Console","1","1,000 K"`,
      kill: (pid) => killed.push(pid),
    },
  );
  expect(killed).toEqual([]);

  // No recorded child pid -> no kill.
  reapStaleConvertx({ pid: 1, controlPort: 0, token: "" }, (m) => logs.push(m), deps);
  expect(killed).toEqual([]);
});

test("sendFiles posts the launch's files to the running instance's queue route", async () => {
  const received: string[][] = [];
  control = startControlServer({
    handlers: { onFocus: () => {}, onRestart: () => {}, onOpenExternal: () => {} },
    routes: [
      {
        method: "POST",
        path: "/enqueue-files",
        handler: async (req) => {
          const body = (await req.json()) as { files?: string[] };
          received.push(body.files ?? []);
          return { body: { queued: body.files?.length ?? 0 } };
        },
      },
    ],
  });
  const lock = { pid: process.pid, controlPort: control.port, token: control.token };
  await sendFiles(lock, ["C:/x/a.png", "C:/x/b.docx"]);
  expect(received).toEqual([["C:/x/a.png", "C:/x/b.docx"]]);

  // Empty list and dead ports are silent no-ops.
  await sendFiles(lock, []);
  await sendFiles({ pid: 1, controlPort: 0, token: "t" }, ["C:/x/a.png"]);
  expect(received).toHaveLength(1);
});
