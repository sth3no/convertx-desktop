import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { extractArchive, findFile } from "../shared/archive";
import { sha256OfFile } from "../shared/checksums";
import type { PackDef } from "./pack-registry";

export type PackStatus =
  | { state: "available" }
  | { state: "downloading"; received: number; total: number }
  | { state: "verifying" }
  | { state: "extracting" }
  | { state: "restarting" }
  | { state: "installed"; version: string }
  | { state: "error"; message: string };

export interface PackInfo extends PackDef {
  status: PackStatus;
}

interface PackMarker {
  name: string;
  version: string;
  sha256: string;
  pathEntries: string[];
}

export interface PackManagerDeps {
  packsDir: string;
  registry: PackDef[];
  log: (message: string) => void;
  restartConvertx: (reason: string) => void | Promise<void>;
  fetchImpl?: typeof fetch;
}

/**
 * Optional converter packs: pinned-hash downloads installed under app-data,
 * their bin dirs joined onto the ConvertX child PATH (restart applies it).
 * The `.pack.json` marker is written last, so torn installs read as "not
 * installed" and are simply reinstallable (spec §5).
 */
export function createPackManager(deps: PackManagerDeps) {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ops = new Map<string, PackStatus>();

  const packDir = (name: string) => join(deps.packsDir, name);
  const markerFile = (name: string) => join(packDir(name), ".pack.json");

  function readMarker(name: string): PackMarker | undefined {
    try {
      const raw = JSON.parse(readFileSync(markerFile(name), "utf8")) as PackMarker;
      if (typeof raw.version !== "string" || !Array.isArray(raw.pathEntries)) return undefined;
      return raw;
    } catch {
      return undefined;
    }
  }

  function statusOf(def: PackDef): PackStatus {
    const op = ops.get(def.name);
    if (op) return op;
    const marker = readMarker(def.name);
    return marker ? { state: "installed", version: marker.version } : { state: "available" };
  }

  const fail = (name: string, message: string): PackStatus => {
    deps.log(`pack ${name} error: ${message}`);
    const status: PackStatus = { state: "error", message };
    ops.set(name, status);
    return status;
  };

  async function install(name: string): Promise<PackStatus> {
    const def = deps.registry.find((p) => p.name === name);
    if (!def) return { state: "error", message: `unknown pack: ${name}` };
    const current = statusOf(def);
    if (current.state !== "available" && current.state !== "error") return current;

    mkdirSync(deps.packsDir, { recursive: true });
    const download = join(deps.packsDir, `${name}.download`);
    const partial = join(deps.packsDir, `${name}.partial`);
    try {
      ops.set(name, { state: "downloading", received: 0, total: def.sizeBytes });
      const res = await fetchImpl(def.url, { redirect: "follow" });
      if (!res.ok || !res.body) return fail(name, `download failed (${res.status})`);
      const total = Number(res.headers.get("content-length")) || def.sizeBytes;
      const writer = Bun.file(download).writer();
      let received = 0;
      for await (const chunk of res.body) {
        writer.write(chunk);
        received += chunk.byteLength;
        ops.set(name, { state: "downloading", received, total });
      }
      await writer.end();

      ops.set(name, { state: "verifying" });
      const actual = await sha256OfFile(download);
      if (actual !== def.sha256) {
        return fail(name, `sha256 mismatch (expected ${def.sha256}, got ${actual})`);
      }

      ops.set(name, { state: "extracting" });
      rmSync(partial, { recursive: true, force: true });
      mkdirSync(partial, { recursive: true });
      extractArchive(download, partial);
      const exe = findFile(partial, def.exeName);
      if (!exe) return fail(name, `${def.exeName} not found in the archive`);

      rmSync(packDir(name), { recursive: true, force: true });
      renameSync(partial, packDir(name));
      const installedExe = findFile(packDir(name), def.exeName)!;
      const marker: PackMarker = {
        name,
        version: def.version,
        sha256: def.sha256,
        pathEntries: [dirname(installedExe)],
      };
      writeFileSync(markerFile(name), `${JSON.stringify(marker, null, 2)}\n`);

      ops.set(name, { state: "restarting" });
      await deps.restartConvertx(`pack installed: ${name}`);
      ops.delete(name);
      deps.log(`pack installed: ${name} ${def.version}`);
      return statusOf(def);
    } catch (err) {
      return fail(name, err instanceof Error ? err.message : String(err));
    } finally {
      rmSync(download, { force: true });
      rmSync(partial, { recursive: true, force: true });
    }
  }

  async function remove(name: string): Promise<PackStatus> {
    const def = deps.registry.find((p) => p.name === name);
    if (!def) return { state: "error", message: `unknown pack: ${name}` };
    if (!readMarker(name)) return statusOf(def);
    try {
      rmSync(packDir(name), { recursive: true, force: true });
      ops.set(name, { state: "restarting" });
      await deps.restartConvertx(`pack removed: ${name}`);
      ops.delete(name);
      deps.log(`pack removed: ${name}`);
      return statusOf(def);
    } catch (err) {
      return fail(name, err instanceof Error ? err.message : String(err));
    }
  }

  return {
    list: (): PackInfo[] => deps.registry.map((def) => ({ ...def, status: statusOf(def) })),
    install,
    remove,
    /** PATH entries of every installed pack, for the child spawn env. */
    installedPathEntries(): string[] {
      if (!existsSync(deps.packsDir)) return [];
      const entries: string[] = [];
      for (const name of readdirSync(deps.packsDir)) {
        const marker = readMarker(name);
        if (marker) entries.push(...marker.pathEntries.filter((p) => existsSync(p)));
      }
      return entries;
    },
  };
}
