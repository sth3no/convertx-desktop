import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { extractArchive, findFile } from "../src/shared/archive";
import { sha256OfFile } from "./lib/checksums";
import {
  CONVERTER_MANIFEST_PATH,
  loadConverterManifest,
  saveConverterManifest,
  type PinnedTool,
} from "./lib/converter-manifest";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const OUT_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");
const RECORD = process.argv.includes("--record");

/**
 * Resolution recipes for --record mode only. The actual pins (exact URL,
 * version, sha256) live in scripts/converter-manifest.json; a normal run
 * reads that manifest and never queries any release API.
 */
interface ToolSpec {
  name: string;
  /** github: release asset by regex. gyan-ffmpeg: gyan.dev builds. url: fixed. */
  resolve: "github" | "gyan-ffmpeg" | "url";
  repo?: string;
  /** Release tag to record from. Defaults to the latest release. */
  tag?: string;
  url?: string;
  version?: string;
  assetMatch?: RegExp;
  kind: "exe" | "zip";
  exeName: string;
  destSubdir?: string;
}

const TOOLS: ToolSpec[] = [
  {
    name: "ffmpeg",
    resolve: "gyan-ffmpeg",
    kind: "zip",
    exeName: "ffmpeg.exe",
  },
  {
    name: "imagemagick",
    resolve: "github",
    repo: "ImageMagick/ImageMagick",
    assetMatch: /portable-Q16-x64\.7z$/i,
    kind: "zip",
    exeName: "magick.exe",
    destSubdir: "imagemagick",
  },
  {
    name: "pandoc",
    resolve: "github",
    repo: "jgm/pandoc",
    assetMatch: /windows-x86_64\.zip$/i,
    kind: "zip",
    exeName: "pandoc.exe",
  },
  {
    name: "dasel",
    resolve: "github",
    repo: "TomWright/dasel",
    // Pinned major: ConvertX invokes the dasel v2 CLI (--file/--read/--write);
    // dasel v3 removed those flags, so records must stay on the v2 line.
    tag: "v2.8.1",
    assetMatch: /dasel_windows_amd64\.exe$/i,
    kind: "exe",
    exeName: "dasel.exe",
  },
  {
    name: "resvg",
    resolve: "github",
    repo: "linebender/resvg",
    assetMatch: /win.*64.*\.zip$/i,
    kind: "zip",
    exeName: "resvg.exe",
  },
  {
    name: "vtracer",
    resolve: "github",
    repo: "visioncortex/vtracer",
    assetMatch: /pc-windows-msvc\.zip$/i,
    kind: "zip",
    exeName: "vtracer.exe",
  },
  {
    name: "potrace",
    resolve: "url",
    url: "https://potrace.sourceforge.net/download/1.16/potrace-1.16.win64.zip",
    version: "1.16",
    kind: "zip",
    exeName: "potrace.exe",
  },
];

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": "convertx-desktop-setup",
    accept: "application/vnd.github+json",
  };
  // Unauthenticated GitHub API calls are limited to 60/hour per IP; CI and
  // frequent re-records should set GITHUB_TOKEN.
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function resolveGithubAsset(
  repo: string,
  match: RegExp,
  tag?: string,
): Promise<{ url: string; version: string }> {
  const releasePath = tag ? `releases/tags/${tag}` : "releases/latest";
  const res = await fetch(`https://api.github.com/repos/${repo}/${releasePath}`, {
    headers: githubHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${repo} (${releasePath})`);
  const release = (await res.json()) as {
    tag_name: string;
    assets: { name: string; browser_download_url: string }[];
  };
  const asset = release.assets.find((a) => match.test(a.name));
  if (!asset) throw new Error(`No asset matching ${match} in ${tag ?? "latest"} ${repo} release`);
  return { url: asset.browser_download_url, version: release.tag_name };
}

async function resolveGyanFfmpeg(): Promise<{ url: string; version: string }> {
  // gyan.dev publishes the current release version as plain text and keeps
  // versioned archives under /builds/packages/. Pin those — never the
  // floating release-essentials.zip alias, whose content changes in place
  // and would break the recorded sha256.
  const res = await fetch("https://www.gyan.dev/ffmpeg/builds/release-version");
  if (!res.ok) throw new Error(`gyan.dev release-version returned ${res.status}`);
  const version = (await res.text()).trim();
  if (!/^[\w.-]+$/.test(version)) throw new Error(`Unexpected ffmpeg version string: "${version}"`);
  return {
    url: `https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-${version}-essentials_build.zip`,
    version,
  };
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

/** Install a downloaded archive/binary into OUT_DIR per the tool's kind. */
async function install(
  tool: Pick<PinnedTool, "name" | "kind" | "exeName" | "destSubdir">,
  downloadPath: string,
  tmp: string,
): Promise<void> {
  if (tool.kind === "exe") {
    await Bun.write(join(OUT_DIR, tool.exeName), Bun.file(downloadPath));
    return;
  }
  const extractDir = join(tmp, tool.name);
  mkdirSync(extractDir, { recursive: true });
  extractArchive(downloadPath, extractDir);
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

/** Normal mode: download a pinned entry, verify its hash, install it. */
async function fetchPinned(entry: PinnedTool, tmp: string): Promise<void> {
  console.log(`  ${entry.name} ${entry.version}: ${entry.url}`);
  const downloadPath = join(tmp, `${entry.name}.download`);
  await download(entry.url, downloadPath);
  const actual = await sha256OfFile(downloadPath);
  if (actual !== entry.sha256) {
    throw new Error(
      `sha256 mismatch for ${entry.name}:\n  expected ${entry.sha256}\n  actual   ${actual}\n` +
        `The file at the pinned URL changed. Re-run with --record only after ` +
        `verifying the new archive is legitimate.`,
    );
  }
  await install(entry, downloadPath, tmp);
}

/** --record mode: resolve the current URL/version, hash it, install it, return the pin. */
async function recordTool(spec: ToolSpec, tmp: string): Promise<PinnedTool> {
  const resolved =
    spec.resolve === "github"
      ? await resolveGithubAsset(spec.repo!, spec.assetMatch!, spec.tag)
      : spec.resolve === "gyan-ffmpeg"
        ? await resolveGyanFfmpeg()
        : { url: spec.url!, version: spec.version! };
  console.log(`  ${spec.name} ${resolved.version}: ${resolved.url}`);
  const downloadPath = join(tmp, `${spec.name}.download`);
  await download(resolved.url, downloadPath);
  const entry: PinnedTool = {
    name: spec.name,
    version: resolved.version,
    url: resolved.url,
    sha256: await sha256OfFile(downloadPath),
    kind: spec.kind,
    exeName: spec.exeName,
    ...(spec.destSubdir ? { destSubdir: spec.destSubdir } : {}),
  };
  // Installing during record validates the archive really contains the
  // expected exe before the pin is written.
  await install(entry, downloadPath, tmp);
  return entry;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  const tmp = mkdtempSync(join(tmpdir(), "cx-converters-"));
  const results: { name: string; ok: boolean; detail: string }[] = [];
  const recorded: PinnedTool[] = [];

  const work: { name: string; run: () => Promise<void> }[] = RECORD
    ? TOOLS.map((spec) => ({
        name: spec.name,
        run: async () => {
          recorded.push(await recordTool(spec, tmp));
        },
      }))
    : (await loadConverterManifest(CONVERTER_MANIFEST_PATH)).tools.map((entry) => ({
        name: entry.name,
        run: () => fetchPinned(entry, tmp),
      }));

  for (const item of work) {
    console.log(`Fetching ${item.name}…`);
    try {
      await item.run();
      results.push({ name: item.name, ok: true, detail: "ok" });
    } catch (err) {
      results.push({
        name: item.name,
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
    return;
  }

  if (RECORD) {
    saveConverterManifest(CONVERTER_MANIFEST_PATH, { tools: recorded });
    console.log(`\nPinned converter manifest written to ${CONVERTER_MANIFEST_PATH}.`);
    console.log("Review the diff and commit it — normal runs verify against these hashes.");
  }
}

main().catch((err) => {
  console.error("fetch-converters failed:", err);
  process.exitCode = 1;
});
