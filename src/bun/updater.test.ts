import { afterEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256OfBytes } from "../shared/checksums";
import { createUpdater, isNewerVersion } from "./updater";

let server: ReturnType<typeof Bun.serve> | undefined;
afterEach(() => {
  server?.stop(true);
  server = undefined;
});

test("isNewerVersion compares numerically", () => {
  expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
  expect(isNewerVersion("1.10.0", "1.9.9")).toBe(true);
  expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
  expect(isNewerVersion("0.9.0", "1.0.0")).toBe(false);
  expect(isNewerVersion("2.0", "1.9.9")).toBe(true);
});

function fixture(installerBytes: Uint8Array, opts?: { badSum?: boolean; version?: string }) {
  const version = opts?.version ?? "9.9.9";
  const name = `ConvertX-Desktop-${version}-Setup.exe`;
  const sum = opts?.badSum ? "0".repeat(64) : sha256OfBytes(installerBytes);
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = new URL(req.url).pathname;
      if (path === "/repos/o/r/releases/latest") {
        const base = `http://127.0.0.1:${server!.port}`;
        return Response.json({
          tag_name: `v${version}`,
          published_at: "2026-07-07T00:00:00Z",
          html_url: "https://example.com/release",
          assets: [
            { name, browser_download_url: `${base}/dl/${name}`, size: installerBytes.length },
            { name: "SHA256SUMS.txt", browser_download_url: `${base}/dl/sums`, size: 100 },
          ],
        });
      }
      // Cast: Bun accepts Uint8Array bodies; the TS lib type is narrower.
      if (path === `/dl/${name}`) return new Response(installerBytes as unknown as BodyInit);
      if (path === "/dl/sums") return new Response(`${sum}  ${name}\n`);
      return new Response("nope", { status: 404 });
    },
  });
  return { apiBase: `http://127.0.0.1:${server.port}`, version, name };
}

function makeUpdater(apiBase: string, extra?: { spawned?: string[]; quits?: number[] }) {
  const updatesDir = mkdtempSync(join(tmpdir(), "cx-upd-"));
  return createUpdater({
    currentVersion: "1.0.0",
    repo: "o/r",
    updatesDir,
    installedLauncher: "C:\\fake\\launcher.exe",
    log: () => {},
    apiBase,
    spawnDetached: (cmd) => extra?.spawned?.push(cmd),
    quitApp: () => extra?.quits?.push(1),
  });
}

test("check -> update-available -> download+verify -> ready -> apply spawns and quits", async () => {
  const bytes = new TextEncoder().encode("fake installer bytes");
  const { apiBase, version, name } = fixture(bytes);
  const spawned: string[] = [];
  const quits: number[] = [];
  const updater = makeUpdater(apiBase, { spawned, quits });

  expect(updater.status().state).toBe("idle");
  const afterCheck = await updater.check();
  expect(afterCheck.state).toBe("update-available");
  if (afterCheck.state === "update-available") expect(afterCheck.version).toBe(version);

  const afterDownload = await updater.download();
  expect(afterDownload.state).toBe("ready");

  const applied = await updater.apply();
  expect(applied.ok).toBe(true);
  expect(quits).toHaveLength(1);
  expect(spawned).toHaveLength(1);
  expect(spawned[0]).toContain(name);
  expect(spawned[0]).toContain("/VERYSILENT");
  expect(spawned[0]).toContain("launcher.exe");
});

test("up-to-date when the release is not newer", async () => {
  const { apiBase } = fixture(new Uint8Array(8), { version: "1.0.0" });
  const updater = makeUpdater(apiBase);
  expect((await updater.check()).state).toBe("up-to-date");
});

test("hash mismatch -> error, never ready", async () => {
  const { apiBase } = fixture(new TextEncoder().encode("evil"), { badSum: true });
  const updater = makeUpdater(apiBase);
  await updater.check();
  const result = await updater.download();
  expect(result.state).toBe("error");
  expect((await updater.apply()).ok).toBe(false);
});

test("API failure -> error state, check can be retried", async () => {
  const updater = makeUpdater("http://127.0.0.1:1");
  expect((await updater.check()).state).toBe("error");
});

test("404 (no published release yet) counts as up-to-date, not an error", async () => {
  server = Bun.serve({ port: 0, fetch: () => new Response("not found", { status: 404 }) });
  const updater = makeUpdater(`http://127.0.0.1:${server.port}`);
  expect((await updater.check()).state).toBe("up-to-date");
});

test("apply is rejected unless ready; download rejected unless update-available", async () => {
  const { apiBase } = fixture(new Uint8Array(8), { version: "1.0.0" });
  const updater = makeUpdater(apiBase);
  expect((await updater.apply()).ok).toBe(false);
  expect((await updater.download()).state).toBe("error");
});
