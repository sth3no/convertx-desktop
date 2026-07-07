import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { sha256OfFile } from "../shared/checksums";

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; checkedAt: number }
  | {
      state: "update-available";
      version: string;
      publishedAt: string;
      notesUrl: string;
      sizeBytes: number;
      checkedAt: number;
    }
  | { state: "downloading"; version: string; received: number; total: number }
  | { state: "verifying"; version: string }
  | { state: "ready"; version: string; installerPath: string }
  | { state: "installing"; version: string }
  | { state: "error"; message: string; at: string };

export interface UpdaterDeps {
  currentVersion: string;
  /** "owner/repo" on github.com. */
  repo: string;
  updatesDir: string;
  /** Path the relaunch step starts after an explicit apply(). */
  installedLauncher: string;
  log: (message: string) => void;
  /** Test seams. */
  apiBase?: string;
  fetchImpl?: typeof fetch;
  spawnDetached?: (cmdLine: string) => void;
  quitApp?: () => void;
}

/** Numeric segment-wise version compare: is `a` newer than `b`? */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = a.split(".").map((s) => Number.parseInt(s, 10) || 0);
  const pb = b.split(".").map((s) => Number.parseInt(s, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da > db;
  }
  return false;
}

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  notesUrl: string;
  installerUrl: string;
  installerName: string;
  sumsUrl: string;
  sizeBytes: number;
}

/**
 * Update engine: GitHub Releases -> verified download -> silent reinstall.
 * All transitions land in a status snapshot the API serves; nothing throws
 * across the boundary (spec §8). The relaunch trick: `cmd /c "A & start B"`
 * runs B only after the installer A exits.
 */
export function createUpdater(deps: UpdaterDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const apiBase = deps.apiBase ?? "https://api.github.com";
  const spawnDetached =
    deps.spawnDetached ??
    ((cmdLine: string) => {
      const child = spawn("cmd", ["/c", cmdLine], { detached: true, stdio: "ignore" });
      child.unref();
    });
  const quitApp = deps.quitApp ?? (() => process.exit(0));

  let status: UpdateStatus = { state: "idle" };
  let release: ReleaseInfo | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  const fail = (message: string, at: string): UpdateStatus => {
    deps.log(`updater error (${at}): ${message}`);
    status = { state: "error", message, at };
    return status;
  };

  function cleanUpdatesDir(): void {
    try {
      mkdirSync(deps.updatesDir, { recursive: true });
      for (const entry of readdirSync(deps.updatesDir)) {
        rmSync(join(deps.updatesDir, entry), { recursive: true, force: true });
      }
    } catch {
      // stale files are cosmetic
    }
  }

  async function check(): Promise<UpdateStatus> {
    if (status.state === "downloading" || status.state === "installing") return status;
    status = { state: "checking" };
    try {
      const res = await fetchImpl(`${apiBase}/repos/${deps.repo}/releases/latest`, {
        headers: { "user-agent": "convertx-desktop", accept: "application/vnd.github+json" },
      });
      if (res.status === 404) {
        // No published release exists (drafts are invisible to the API) —
        // there is nothing to update to, which is not an error.
        status = { state: "up-to-date", checkedAt: Date.now() };
        return status;
      }
      if (!res.ok) return fail(`GitHub API ${res.status}`, "check");
      const data = (await res.json()) as {
        tag_name: string;
        published_at: string;
        html_url: string;
        assets: { name: string; browser_download_url: string; size: number }[];
      };
      const version = data.tag_name.replace(/^v/, "");
      if (!isNewerVersion(version, deps.currentVersion)) {
        status = { state: "up-to-date", checkedAt: Date.now() };
        return status;
      }
      const installerName = `ConvertX-Desktop-${version}-Setup.exe`;
      const installer = data.assets.find((a) => a.name === installerName);
      const sums = data.assets.find((a) => a.name === "SHA256SUMS.txt");
      if (!installer || !sums) {
        return fail("release is missing installer or SHA256SUMS.txt", "check");
      }
      release = {
        version,
        publishedAt: data.published_at,
        notesUrl: data.html_url,
        installerUrl: installer.browser_download_url,
        installerName,
        sumsUrl: sums.browser_download_url,
        sizeBytes: installer.size,
      };
      status = {
        state: "update-available",
        version,
        publishedAt: release.publishedAt,
        notesUrl: release.notesUrl,
        sizeBytes: release.sizeBytes,
        checkedAt: Date.now(),
      };
      return status;
    } catch (err) {
      return fail(err instanceof Error ? err.message : String(err), "check");
    }
  }

  async function download(): Promise<UpdateStatus> {
    if (status.state === "ready") return status;
    if (status.state !== "update-available" || !release) {
      return fail("no update available to download", "download");
    }
    const info = release;
    cleanUpdatesDir();
    const dest = join(deps.updatesDir, info.installerName);
    status = { state: "downloading", version: info.version, received: 0, total: info.sizeBytes };
    try {
      const sumsRes = await fetchImpl(info.sumsUrl);
      if (!sumsRes.ok) return fail(`sums download ${sumsRes.status}`, "download");
      const sumsText = await sumsRes.text();
      const line = sumsText.split("\n").find((l) => l.includes(info.installerName));
      const expected = line?.trim().split(/\s+/)[0];
      if (!expected || !/^[0-9a-f]{64}$/.test(expected)) {
        return fail("installer hash not found in SHA256SUMS.txt", "download");
      }

      const res = await fetchImpl(info.installerUrl);
      if (!res.ok || !res.body) return fail(`installer download ${res.status}`, "download");
      const total = Number(res.headers.get("content-length")) || info.sizeBytes;
      const writer = Bun.file(dest).writer();
      let received = 0;
      for await (const chunk of res.body) {
        writer.write(chunk);
        received += chunk.byteLength;
        status = { state: "downloading", version: info.version, received, total };
      }
      await writer.end();

      status = { state: "verifying", version: info.version };
      const actual = await sha256OfFile(dest);
      if (actual !== expected) {
        rmSync(dest, { force: true });
        return fail("installer hash mismatch — download discarded", "verify");
      }
      status = { state: "ready", version: info.version, installerPath: dest };
      deps.log(`update ${info.version} downloaded and verified`);
      return status;
    } catch (err) {
      rmSync(dest, { force: true });
      return fail(err instanceof Error ? err.message : String(err), "download");
    }
  }

  /** Spawn the verified installer (optionally relaunching after). */
  function spawnInstaller(relaunch: boolean): boolean {
    if (status.state !== "ready") return false;
    const installer = status.installerPath;
    const silent = `"${installer}" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART`;
    const cmdLine = relaunch ? `${silent} & start "" "${deps.installedLauncher}"` : silent;
    deps.log(`applying update: ${cmdLine}`);
    status = { state: "installing", version: status.version };
    spawnDetached(cmdLine);
    return true;
  }

  return {
    status: () => status,
    check,
    download,
    /** Explicit apply: install + relaunch + quit. */
    async apply(): Promise<{ ok: boolean; error?: string }> {
      if (status.state !== "ready") {
        return { ok: false, error: `not ready (state: ${status.state})` };
      }
      spawnInstaller(true);
      quitApp();
      return { ok: true };
    },
    /** Quit path: install without relaunch (the user chose to close the app). */
    applyOnQuit(): boolean {
      return spawnInstaller(false);
    },
    hasReadyUpdate: () => status.state === "ready",
    /** Boot: clean stale downloads, check now, then daily; auto-download per mode. */
    start(getMode: () => "auto" | "notify", intervalMs = 24 * 3600_000): void {
      cleanUpdatesDir();
      const cycle = async () => {
        const result = await check();
        if (result.state === "update-available" && getMode() === "auto") await download();
      };
      void cycle();
      timer = setInterval(() => void cycle(), intervalMs);
    },
    stop(): void {
      clearInterval(timer);
    },
  };
}
