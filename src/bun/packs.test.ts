import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256OfFile } from "../shared/checksums";
import type { PackDef } from "./pack-registry";
import { createPackManager } from "./packs";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

async function fixture(): Promise<{ def: PackDef; packsDir: string; restarts: string[] }> {
  const base = mkdtempSync(join(tmpdir(), "cx-packs-"));
  const content = join(base, "content", "tool-1.0", "bin");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "fakepack.exe"), "exe bytes");
  const zip = join(base, "pack.zip");
  spawnSync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"), [
    "-a",
    "-cf",
    zip,
    "-C",
    join(base, "content"),
    ".",
  ]);
  const bytes = readFileSync(zip);
  server = Bun.serve({ port: 0, fetch: () => new Response(bytes) });
  const def: PackDef = {
    name: "fakepack",
    title: "Fake Pack",
    description: "test",
    version: "1.0",
    url: `http://127.0.0.1:${server.port}/pack.zip`,
    sha256: await sha256OfFile(zip),
    sizeBytes: bytes.length,
    kind: "zip",
    exeName: "fakepack.exe",
    unlocks: "testing",
  };
  const packsDir = join(base, "packs");
  const restarts: string[] = [];
  return { def, packsDir, restarts };
}

function manager(def: PackDef, packsDir: string, restarts: string[]) {
  return createPackManager({
    packsDir,
    registry: [def],
    log: () => {},
    restartConvertx: (reason) => {
      restarts.push(reason);
    },
  });
}

test("install: download, verify, extract, marker, PATH entries, restart", async () => {
  const { def, packsDir, restarts } = await fixture();
  const packs = manager(def, packsDir, restarts);

  expect(packs.list()[0]!.status).toEqual({ state: "available" });
  const result = await packs.install("fakepack");
  expect(result.state).toBe("installed");
  expect(restarts).toHaveLength(1);

  const entries = packs.installedPathEntries();
  expect(entries).toHaveLength(1);
  expect(entries[0]!.toLowerCase()).toContain("fakepack");
  expect(existsSync(join(entries[0]!, "fakepack.exe"))).toBe(true);
  expect(packs.list()[0]!.status).toEqual({ state: "installed", version: "1.0" });

  // A fresh manager over the same dir sees the marker (persistence).
  const again = manager(def, packsDir, restarts);
  expect(again.list()[0]!.status).toEqual({ state: "installed", version: "1.0" });
});

test("hash mismatch -> error, nothing installed", async () => {
  const { def, packsDir, restarts } = await fixture();
  const bad = { ...def, sha256: "0".repeat(64) };
  const packs = manager(bad, packsDir, restarts);
  const result = await packs.install("fakepack");
  expect(result.state).toBe("error");
  expect(packs.installedPathEntries()).toHaveLength(0);
  expect(restarts).toHaveLength(0);
});

test("remove deletes the pack and restarts; unknown names error", async () => {
  const { def, packsDir, restarts } = await fixture();
  const packs = manager(def, packsDir, restarts);
  await packs.install("fakepack");
  const removed = await packs.remove("fakepack");
  expect(removed.state).toBe("available");
  expect(packs.installedPathEntries()).toHaveLength(0);
  expect(restarts).toHaveLength(2);
  expect((await packs.install("nope")).state).toBe("error");
});
