import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const OUT_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");

interface Tool {
  name: string;
  /** github: resolve a release asset by regex. url: fixed URL. */
  source: "github" | "url";
  repo?: string;
  /** Release tag to fetch from. Defaults to the latest release. */
  tag?: string;
  url?: string;
  assetMatch?: RegExp;
  /** "exe": the download is the binary. "zip": extract and find exeName. */
  kind: "exe" | "zip";
  /** Basename to find inside an extracted zip and to write into OUT_DIR. */
  exeName: string;
  /** If set, copy the whole folder containing exeName into OUT_DIR/<dir>. */
  destSubdir?: string;
}

const TOOLS: Tool[] = [
  {
    name: "ffmpeg",
    source: "url",
    url: "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip",
    kind: "zip",
    exeName: "ffmpeg.exe",
  },
  {
    name: "imagemagick",
    source: "github",
    repo: "ImageMagick/ImageMagick",
    assetMatch: /portable-Q16-x64\.7z$/i,
    kind: "zip",
    exeName: "magick.exe",
    destSubdir: "imagemagick",
  },
  {
    name: "pandoc",
    source: "github",
    repo: "jgm/pandoc",
    assetMatch: /windows-x86_64\.zip$/i,
    kind: "zip",
    exeName: "pandoc.exe",
  },
  {
    name: "dasel",
    source: "github",
    repo: "TomWright/dasel",
    // Pinned: ConvertX invokes the dasel v2 CLI (--file/--read/--write);
    // dasel v3 removed those flags, so "latest" ships a binary every dasel
    // conversion fails against. Last v2 release as of 2026-06.
    tag: "v2.8.1",
    assetMatch: /dasel_windows_amd64\.exe$/i,
    kind: "exe",
    exeName: "dasel.exe",
  },
  {
    name: "resvg",
    source: "github",
    repo: "linebender/resvg",
    assetMatch: /win.*64.*\.zip$/i,
    kind: "zip",
    exeName: "resvg.exe",
  },
  {
    name: "vtracer",
    source: "github",
    repo: "visioncortex/vtracer",
    assetMatch: /pc-windows-msvc\.zip$/i,
    kind: "zip",
    exeName: "vtracer.exe",
  },
  {
    name: "potrace",
    source: "url",
    url: "https://potrace.sourceforge.net/download/1.16/potrace-1.16.win64.zip",
    kind: "zip",
    exeName: "potrace.exe",
  },
];

async function resolveGithubAsset(repo: string, match: RegExp, tag?: string): Promise<string> {
  const releasePath = tag ? `releases/tags/${tag}` : "releases/latest";
  const res = await fetch(`https://api.github.com/repos/${repo}/${releasePath}`, {
    headers: { "user-agent": "convertx-electrobun-setup", accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo} (${releasePath})`);
  const release = (await res.json()) as { assets: { name: string; browser_download_url: string }[] };
  const asset = release.assets.find((a) => match.test(a.name));
  if (!asset) throw new Error(`No asset matching ${match} in ${tag ?? "latest"} ${repo} release`);
  return asset.browser_download_url;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download ${res.status} for ${url}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(`Download for ${url} returned an HTML page, not a file`);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 10_000) {
    throw new Error(`Download for ${url} is too small (${bytes.byteLength} bytes) — not a real archive`);
  }
  await Bun.write(dest, bytes);
}

/** Recursively find the first file named `name` under `dir`. */
function findFile(dir: string, name: string): string | undefined {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      const hit = findFile(full, name);
      if (hit) return hit;
    } else if (entry.toLowerCase() === name.toLowerCase()) {
      return full;
    }
  }
  return undefined;
}

function unzip(zipPath: string, destDir: string): void {
  // Use the system bsdtar (libarchive) by absolute path — it extracts both .zip
  // and .7z. A bare "tar" may resolve to Git-for-Windows' GNU tar, which cannot.
  const systemTar = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe");
  const tar = existsSync(systemTar) ? systemTar : "tar";
  const result = spawnSync(tar, ["-xf", zipPath, "-C", destDir], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`tar failed to extract ${zipPath}`);
}

async function fetchTool(tool: Tool, tmp: string): Promise<void> {
  const url =
    tool.source === "github"
      ? await resolveGithubAsset(tool.repo!, tool.assetMatch!, tool.tag)
      : tool.url!;
  console.log(`  ${tool.name}: ${url}`);

  if (tool.kind === "exe") {
    await download(url, join(OUT_DIR, tool.exeName));
    return;
  }

  const zipPath = join(tmp, `${tool.name}.zip`);
  await download(url, zipPath);
  const extractDir = join(tmp, tool.name);
  mkdirSync(extractDir, { recursive: true });
  unzip(zipPath, extractDir);

  const exePath = findFile(extractDir, tool.exeName);
  if (!exePath) throw new Error(`${tool.exeName} not found in ${tool.name} archive`);

  if (tool.destSubdir) {
    const dest = join(OUT_DIR, tool.destSubdir);
    rmSync(dest, { recursive: true, force: true });
    cpSync(dirname(exePath), dest, { recursive: true });
  } else {
    await Bun.write(join(OUT_DIR, tool.exeName), Bun.file(exePath));
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "cx-converters-"));
  const results: { name: string; ok: boolean; detail: string }[] = [];

  for (const tool of TOOLS) {
    console.log(`Fetching ${tool.name}…`);
    try {
      await fetchTool(tool, tmp);
      results.push({ name: tool.name, ok: true, detail: "ok" });
    } catch (err) {
      results.push({
        name: tool.name,
        ok: false,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  rmSync(tmp, { recursive: true, force: true });

  console.log("\n=== Converter download summary ===");
  for (const r of results) {
    console.log(`  ${r.ok ? "OK  " : "FAIL"}  ${r.name}${r.ok ? "" : " — " + r.detail}`);
  }
  const haveFfmpeg = existsSync(join(OUT_DIR, "ffmpeg.exe"));
  const haveMagick = existsSync(join(OUT_DIR, "imagemagick", "magick.exe"));
  if (!haveFfmpeg || !haveMagick) {
    console.log(
      "\nWARNING: ffmpeg and/or ImageMagick are missing. The smoke test needs them.\n" +
        "Download them manually into vendor/converters/win/ if their URLs have moved:\n" +
        "  ffmpeg.exe                -> vendor/converters/win/ffmpeg.exe\n" +
        "  ImageMagick portable dir  -> vendor/converters/win/imagemagick/ (contains magick.exe)",
    );
  }

  // Any failed download must fail the setup chain ('bun run setup' uses &&),
  // otherwise 'bun run package' ships a bundle whose converters are missing
  // and conversions only break at runtime. The on-disk WARNING above covers
  // the complementary case of stale leftovers masking a total failure.
  if (results.some((r) => !r.ok)) {
    console.error("\nERROR: one or more converter downloads failed (see FAIL lines above).");
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("fetch-converters failed:", err);
  process.exitCode = 1;
});
