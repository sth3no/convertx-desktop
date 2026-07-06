# Phase 0 — Release Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every build input pinned, checksummed, and recorded; publish the repo publicly as `convertx-desktop`; establish single sources of truth and a documented release process — per Phase 0 of `docs/superpowers/specs/2026-07-06-full-desktop-app-master-plan.md`.

**Architecture:** Pins live in committed files (`scripts/lib/pins.ts` for the ConvertX ref, `scripts/converter-manifest.json` for converter URLs+sha256). `fetch-converters.ts` gets two modes: default (offline-resolvable, manifest-driven, hash-verified) and `--record` (resolves current versions once, writes the manifest). A deterministic `vendor/vendor-manifest.json` — assembled from those pins — is baked into the bundle, giving releases an exact bill of materials (and Phase 1 its refresh marker). Duplicated constants (app name, version, copy-exclusion list) collapse into imports from one owner each.

**Tech Stack:** Bun 1.3.14, TypeScript, `bun test`, `gh` CLI (authenticated as `sth3no`), Inno-free — packaging itself is Phase 2.

**User decisions already made (2026-07-06):** repo name `convertx-desktop`, public, signing deferred, lean base install. Branch renames `master` → `main` at publication.

---

### Task 1: License the repo (AGPL-3.0)

The repo distributes ConvertX (AGPL-3.0); licensing the shell under AGPL-3.0 makes the combined distribution unambiguous. Must land before the repo goes public.

**Files:**
- Create: `LICENSE`
- Modify: `package.json` (add `license` field)
- Modify: `README.md` (Licensing section)

- [ ] **Step 1: Download the canonical AGPL-3.0 text**

```powershell
curl.exe -fsSL https://www.gnu.org/licenses/agpl-3.0.txt -o LICENSE
Get-Content LICENSE -TotalCount 2
```

Expected output contains: `GNU AFFERO GENERAL PUBLIC LICENSE` / `Version 3, 19 November 2007`.

- [ ] **Step 2: Add the license field to package.json**

In `package.json`, after `"private": true,` add:

```json
  "license": "AGPL-3.0-only",
```

- [ ] **Step 3: Update the README Licensing section**

In `README.md`, replace the first sentence of the `## Licensing` section:

Old:
```markdown
ConvertX is licensed under the **GNU AGPL-3.0** (see `vendor/convertx/LICENSE` after setup).
```

New:
```markdown
This repository is licensed under the **GNU AGPL-3.0** (see `LICENSE`), the same license as
ConvertX itself (see `vendor/convertx/LICENSE` after setup).
```

- [ ] **Step 4: Commit**

```powershell
git add LICENSE package.json README.md
git commit -m @'
chore: license the repo under AGPL-3.0

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 2: Publish to GitHub as `convertx-desktop` (public)

**Files:**
- Modify: `README.md` (title + intro)
- Modify: `package.json` (name)

- [ ] **Step 1: Rename the project in README and package.json**

`README.md` line 1, old: `# ConvertX-Electrobun` → new: `# ConvertX Desktop`.

In the intro paragraph, old:
```markdown
A standalone Windows 11 desktop app that packages the [ConvertX](https://github.com/C4illin/ConvertX)
```
new:
```markdown
ConvertX Desktop — a standalone Windows 11 desktop app that packages the [ConvertX](https://github.com/C4illin/ConvertX)
```

`package.json`, old: `"name": "convertx-electrobun",` → new: `"name": "convertx-desktop",`.

Note: the app-data directory stays `%APPDATA%\ConvertX-Electrobun` (renaming it would orphan existing user data; revisit in Phase 1 only if a migration is written). Do NOT change `src/bun/paths.ts`.

- [ ] **Step 2: Commit the rename**

```powershell
git add README.md package.json
git commit -m @'
chore: rename project to convertx-desktop

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

- [ ] **Step 3: Rename the branch and create the public repo**

```powershell
git branch -m master main
gh repo create convertx-desktop --public --source . --remote origin --push --description "ConvertX as a standalone Windows desktop app - no Docker, no login, converter binaries bundled (Electrobun shell around the AGPL ConvertX web app)"
```

Expected: repo created, `main` pushed and tracking `origin/main`.

- [ ] **Step 4: Verify**

```powershell
git remote -v
git status
gh repo view --json url,visibility,defaultBranchRef
```

Expected: origin points at the new repo, working tree clean, visibility `PUBLIC`, default branch `main`.

---

### Task 3: Single sources of truth (version, app name, exclusion list)

**Files:**
- Create: `src/shared/vendor-spec.ts`
- Modify: `src/bun/bundle.ts:33-49`
- Modify: `scripts/bundle-vendor.ts:1-41`
- Modify: `electrobun.config.ts:1-8`
- Modify: `package.json` (test script)

- [ ] **Step 1: Create the shared vendor-spec module**

Create `src/shared/vendor-spec.ts`:

```typescript
/**
 * Top-level entries of vendor/convertx that must never be copied anywhere:
 * `data` holds runtime state (sqlite DB, uploads, conversion outputs) and
 * `.git` the clone history. Shared by the supervisor's first-run copy
 * (src/bun/bundle.ts) and the packaging bake (scripts/bundle-vendor.ts).
 */
export const EXCLUDED_CONVERTX_ENTRIES = [".git", "data"] as const;

/**
 * Filename of the manifest recording exactly what vendor/ contains (upstream
 * ConvertX ref, converter versions/URLs/hashes). Written by
 * scripts/write-vendor-manifest.ts, baked into the bundle next to vendor/.
 */
export const VENDOR_MANIFEST_NAME = "vendor-manifest.json";
```

- [ ] **Step 2: Use it in src/bun/bundle.ts**

Add the import at the top:

```typescript
import { EXCLUDED_CONVERTX_ENTRIES } from "../shared/vendor-spec";
```

In `ensureConvertxCopy`, replace:

```typescript
  const excluded = new Set([resolve(src, "data"), resolve(src, ".git")]);
```

with:

```typescript
  const excluded = new Set(EXCLUDED_CONVERTX_ENTRIES.map((entry) => resolve(src, entry)));
```

and shorten the comment above it to drop the now-stale name list (keep the "Compare resolved paths…" sentence).

- [ ] **Step 3: Use shared constants in scripts/bundle-vendor.ts**

Add imports:

```typescript
import electrobunConfig from "../electrobun.config";
import { EXCLUDED_CONVERTX_ENTRIES } from "../src/shared/vendor-spec";
```

Delete the local `APP_NAME` constant and its "Kept in sync by hand" comment; replace with:

```typescript
const APP_NAME = electrobunConfig.app.name;
```

Delete the local `EXCLUDED_CONVERTX_ENTRIES` constant and its "duplicated on purpose" comment block. Change the `excludeTopLevel` signature to accept a readonly array:

```typescript
function excludeTopLevel(srcRoot: string, excluded: readonly string[]): (source: string) => boolean {
```

- [ ] **Step 4: Thread the version from package.json into electrobun.config.ts**

At the top of `electrobun.config.ts` add:

```typescript
import pkg from "./package.json";
```

and replace `version: "0.1.0",` with `version: pkg.version,`.

- [ ] **Step 5: Widen the test glob**

`package.json`, old: `"test": "bun test src/bun",` → new: `"test": "bun test src scripts",`
(scripts/lib tests arrive in Task 4; `vendor/` and `node_modules/` are outside both roots so upstream tests never run).

- [ ] **Step 6: Verify**

```powershell
bun run test
bun x tsc --noEmit
```

Expected: all existing tests pass (5 files), tsc clean.

- [ ] **Step 7: Commit**

```powershell
git add src/shared/vendor-spec.ts src/bun/bundle.ts scripts/bundle-vendor.ts electrobun.config.ts package.json
git commit -m @'
refactor: single sources of truth for version, app name, vendor excludes

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 4: Checksum helper (TDD)

**Files:**
- Create: `scripts/lib/checksums.ts`
- Test: `scripts/lib/checksums.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/lib/checksums.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sha256OfBytes, sha256OfFile } from "./checksums";

describe("sha256OfBytes", () => {
  test("matches the known vector for the empty input", () => {
    expect(sha256OfBytes(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test('matches the known vector for "abc"', () => {
    expect(sha256OfBytes(new TextEncoder().encode("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("sha256OfFile", () => {
  test("hashes file contents", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cx-checksums-"));
    try {
      const path = join(dir, "abc.txt");
      writeFileSync(path, "abc");
      expect(await sha256OfFile(path)).toBe(
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bun test scripts/lib/checksums.test.ts`
Expected: FAIL — cannot resolve `./checksums`.

- [ ] **Step 3: Implement**

Create `scripts/lib/checksums.ts`:

```typescript
import { createHash } from "node:crypto";

export function sha256OfBytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function sha256OfFile(path: string): Promise<string> {
  return sha256OfBytes(new Uint8Array(await Bun.file(path).arrayBuffer()));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test scripts/lib/checksums.test.ts`
Expected: 3 pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/checksums.ts scripts/lib/checksums.test.ts
git commit -m @'
feat: add sha256 checksum helpers for converter downloads

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 5: Converter manifest module (TDD)

**Files:**
- Create: `scripts/lib/converter-manifest.ts`
- Test: `scripts/lib/converter-manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `scripts/lib/converter-manifest.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadConverterManifest,
  saveConverterManifest,
  validateConverterManifest,
} from "./converter-manifest";

const VALID_TOOL = {
  name: "dasel",
  version: "v2.8.1",
  url: "https://github.com/TomWright/dasel/releases/download/v2.8.1/dasel_windows_amd64.exe",
  sha256: "a".repeat(64),
  kind: "exe" as const,
  exeName: "dasel.exe",
};

describe("validateConverterManifest", () => {
  test("accepts a valid manifest", () => {
    const manifest = validateConverterManifest({ tools: [VALID_TOOL] });
    expect(manifest.tools).toHaveLength(1);
    expect(manifest.tools[0]!.name).toBe("dasel");
  });

  test("accepts an optional destSubdir", () => {
    const manifest = validateConverterManifest({
      tools: [{ ...VALID_TOOL, kind: "zip", destSubdir: "imagemagick" }],
    });
    expect(manifest.tools[0]!.destSubdir).toBe("imagemagick");
  });

  test("rejects a missing field", () => {
    const { url: _url, ...noUrl } = VALID_TOOL;
    expect(() => validateConverterManifest({ tools: [noUrl] })).toThrow(/"url"/);
  });

  test("rejects a malformed sha256", () => {
    expect(() =>
      validateConverterManifest({ tools: [{ ...VALID_TOOL, sha256: "beef" }] }),
    ).toThrow(/sha256/);
  });

  test("rejects an unknown kind", () => {
    expect(() =>
      validateConverterManifest({ tools: [{ ...VALID_TOOL, kind: "tarball" }] }),
    ).toThrow(/kind/);
  });

  test("rejects non-https URLs", () => {
    expect(() =>
      validateConverterManifest({ tools: [{ ...VALID_TOOL, url: "http://example.com/x.exe" }] }),
    ).toThrow(/https/);
  });

  test("rejects an empty tools list", () => {
    expect(() => validateConverterManifest({ tools: [] })).toThrow(/empty/);
  });
});

describe("save + load round-trip", () => {
  test("loads back what was saved", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cx-manifest-"));
    try {
      const path = join(dir, "converter-manifest.json");
      saveConverterManifest(path, { tools: [VALID_TOOL] });
      const loaded = await loadConverterManifest(path);
      expect(loaded.tools).toEqual([VALID_TOOL]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("load fails with a helpful message when the file is missing", async () => {
    await expect(loadConverterManifest(join(tmpdir(), "nope", "missing.json"))).rejects.toThrow(
      /--record/,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `bun test scripts/lib/converter-manifest.test.ts`
Expected: FAIL — cannot resolve `./converter-manifest`.

- [ ] **Step 3: Implement**

Create `scripts/lib/converter-manifest.ts`:

```typescript
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Committed pin file: exact converter versions, URLs, and archive hashes. */
export const CONVERTER_MANIFEST_PATH = join(
  import.meta.dir.replace(/[\\/]scripts[\\/]lib$/, ""),
  "scripts",
  "converter-manifest.json",
);

export interface PinnedTool {
  name: string;
  /** Human-readable version (release tag or upstream version string). */
  version: string;
  /** Exact download URL the sha256 was recorded from. */
  url: string;
  /** Hex sha256 of the file at `url`. */
  sha256: string;
  /** "exe": the download is the binary. "zip": extract and find exeName. */
  kind: "exe" | "zip";
  exeName: string;
  /** If set, install the whole folder containing exeName as OUT_DIR/<dir>. */
  destSubdir?: string;
}

export interface ConverterManifest {
  tools: PinnedTool[];
}

export function validateConverterManifest(value: unknown): ConverterManifest {
  if (typeof value !== "object" || value === null || !Array.isArray((value as { tools?: unknown }).tools)) {
    throw new Error("converter manifest: expected an object with a tools[] array");
  }
  const rawTools = (value as { tools: unknown[] }).tools;
  if (rawTools.length === 0) throw new Error("converter manifest: tools[] is empty");

  const tools = rawTools.map((raw, i): PinnedTool => {
    const t = raw as Record<string, unknown>;
    const at = `converter manifest tools[${i}]`;
    for (const field of ["name", "version", "url", "sha256", "kind", "exeName"] as const) {
      if (typeof t[field] !== "string" || t[field] === "") {
        throw new Error(`${at}: missing or empty "${field}"`);
      }
    }
    if (!/^[0-9a-f]{64}$/.test(t.sha256 as string)) {
      throw new Error(`${at}: sha256 must be a 64-char lowercase hex digest`);
    }
    if (t.kind !== "exe" && t.kind !== "zip") {
      throw new Error(`${at}: kind must be "exe" or "zip"`);
    }
    if (!(t.url as string).startsWith("https://")) {
      throw new Error(`${at}: url must be https`);
    }
    if (t.destSubdir !== undefined && (typeof t.destSubdir !== "string" || t.destSubdir === "")) {
      throw new Error(`${at}: destSubdir must be a non-empty string when present`);
    }
    return {
      name: t.name as string,
      version: t.version as string,
      url: t.url as string,
      sha256: t.sha256 as string,
      kind: t.kind,
      exeName: t.exeName as string,
      ...(t.destSubdir !== undefined ? { destSubdir: t.destSubdir as string } : {}),
    };
  });
  return { tools };
}

export async function loadConverterManifest(path: string): Promise<ConverterManifest> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `No converter manifest at ${path}.\n` +
        `Run 'bun run scripts/fetch-converters.ts --record' once to resolve, hash, and pin the converters.`,
    );
  }
  return validateConverterManifest(await file.json());
}

export function saveConverterManifest(path: string, manifest: ConverterManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test scripts/lib/converter-manifest.test.ts`
Expected: 9 pass.

- [ ] **Step 5: Commit**

```powershell
git add scripts/lib/converter-manifest.ts scripts/lib/converter-manifest.test.ts
git commit -m @'
feat: add pinned converter manifest schema, load/save, validation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 6: Manifest-driven fetch-converters with --record mode

**Files:**
- Modify: `scripts/fetch-converters.ts` (substantial rewrite; `download`/`findFile`/`unzip` and the summary/fail-hard logic survive unchanged)

- [ ] **Step 1: Rewrite scripts/fetch-converters.ts**

Replace the file's contents with:

```typescript
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
  unzip(downloadPath, extractDir);
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
```

- [ ] **Step 2: Typecheck and confirm the missing-manifest error path**

```powershell
bun x tsc --noEmit
bun run scripts/fetch-converters.ts
```

Expected: tsc clean; the script fails fast with `No converter manifest at …\scripts\converter-manifest.json. Run 'bun run scripts/fetch-converters.ts --record' …` and exit code 1 (the manifest doesn't exist yet).

- [ ] **Step 3: Commit**

```powershell
git add scripts/fetch-converters.ts
git commit -m @'
feat: manifest-driven converter downloads with sha256 pins and --record mode

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 7: Record the initial converter manifest

Network-heavy (~700 MB total). Requires the same environment as `bun run setup`.

**Files:**
- Create: `scripts/converter-manifest.json` (generated, then committed)

- [ ] **Step 1: Record**

```powershell
bun run scripts/fetch-converters.ts --record
```

Expected: 7× `OK`, then `Pinned converter manifest written to …`. If any tool FAILs on asset-pattern drift, fix the affected `assetMatch`/URL in `TOOLS` and re-run (that is routine version maintenance, not a plan failure).

- [ ] **Step 2: Inspect the manifest**

```powershell
Get-Content scripts\converter-manifest.json
```

Expected: 7 entries, each with a non-empty `version`, an `https://` URL that includes an explicit version (ffmpeg's must point at `/builds/packages/ffmpeg-<ver>-essentials_build.zip`, not the alias), and a 64-hex `sha256`. `dasel` must be `v2.8.1`.

- [ ] **Step 3: Verify the pinned path end to end**

```powershell
bun run scripts/fetch-converters.ts
```

Expected: 7× `OK` — every download re-fetched and hash-verified against the fresh pins.

- [ ] **Step 4: Commit**

```powershell
git add scripts/converter-manifest.json
git commit -m @'
feat: pin converter versions and archive hashes in a committed manifest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 8: Pin the ConvertX vendor ref

**Files:**
- Create: `scripts/lib/pins.ts`
- Modify: `scripts/setup-convertx.ts`

- [ ] **Step 1: Create the pins module**

Create `scripts/lib/pins.ts`:

```typescript
/** Upstream ConvertX repository vendored (unmodified) into vendor/convertx. */
export const CONVERTX_REPO = "https://github.com/C4illin/ConvertX.git";

/**
 * Pinned upstream commit: v0.17.0 plus the path-traversal fix (upstream PR
 * #532, 2026-04-27). To bump: update this sha, delete vendor/convertx, run
 * 'bun run setup', re-verify the no-login env flags still exist upstream
 * (master plan §7, "Upstream ConvertX drift"), and run the smoke test.
 */
export const CONVERTX_REF = "0965928949319e2839770fbf57a8337440d42630";
```

- [ ] **Step 2: Rewrite scripts/setup-convertx.ts**

Replace the file's contents with:

```typescript
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
```

- [ ] **Step 3: Verify against the existing vendored copy (already at the pin)**

```powershell
bun x tsc --noEmit
bun run scripts/setup-convertx.ts
```

Expected: tsc clean; output includes `already vendored at pinned ref 0965928 — skipping clone.` and the Tailwind build succeeds.

- [ ] **Step 4: Commit**

```powershell
git add scripts/lib/pins.ts scripts/setup-convertx.ts
git commit -m @'
feat: pin the vendored ConvertX to an explicit upstream commit

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 9: Deterministic vendor manifest baked into the bundle

**Files:**
- Create: `.bun-version`
- Create: `scripts/write-vendor-manifest.ts`
- Test: `scripts/write-vendor-manifest.test.ts`
- Modify: `package.json` (setup script chain)
- Modify: `scripts/bundle-vendor.ts` (copy the manifest into the bundle)

- [ ] **Step 1: Pin the Bun version**

Create `.bun-version` containing exactly:

```
1.3.14
```

(CI's `oven-sh/setup-bun` reads this via `bun-version-file` in Phase 2.)

- [ ] **Step 2: Write the failing test**

Create `scripts/write-vendor-manifest.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { buildVendorManifest } from "./write-vendor-manifest";

const INPUT = {
  bunVersion: "1.3.14",
  convertxVersion: "0.17.0",
  converters: {
    tools: [
      {
        name: "dasel",
        version: "v2.8.1",
        url: "https://github.com/TomWright/dasel/releases/download/v2.8.1/dasel_windows_amd64.exe",
        sha256: "a".repeat(64),
        kind: "exe" as const,
        exeName: "dasel.exe",
      },
    ],
  },
};

describe("buildVendorManifest", () => {
  test("is deterministic and carries the pins", () => {
    const a = buildVendorManifest(INPUT);
    const b = buildVendorManifest(INPUT);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.schema).toBe(1);
    expect(a.bun).toBe("1.3.14");
    expect(a.convertx.version).toBe("0.17.0");
    expect(a.convertx.ref).toMatch(/^[0-9a-f]{40}$/);
    expect(a.converters).toEqual([
      {
        name: "dasel",
        version: "v2.8.1",
        url: "https://github.com/TomWright/dasel/releases/download/v2.8.1/dasel_windows_amd64.exe",
        sha256: "a".repeat(64),
      },
    ]);
  });

  test("contains no timestamp-like fields", () => {
    const manifest = buildVendorManifest(INPUT) as unknown as Record<string, unknown>;
    for (const key of Object.keys(manifest)) {
      expect(key.toLowerCase()).not.toContain("time");
      expect(key.toLowerCase()).not.toContain("date");
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `bun test scripts/write-vendor-manifest.test.ts`
Expected: FAIL — cannot resolve `./write-vendor-manifest`.

- [ ] **Step 4: Implement**

Create `scripts/write-vendor-manifest.ts`:

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VENDOR_MANIFEST_NAME } from "../src/shared/vendor-spec";
import {
  CONVERTER_MANIFEST_PATH,
  loadConverterManifest,
  type ConverterManifest,
} from "./lib/converter-manifest";
import { CONVERTX_REF, CONVERTX_REPO } from "./lib/pins";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");

export interface VendorManifest {
  schema: 1;
  bun: string;
  convertx: { repo: string; ref: string; version: string };
  converters: { name: string; version: string; url: string; sha256: string }[];
}

/**
 * Pure assembly — deliberately no timestamps or machine-specific fields, so
 * identical pins produce byte-identical manifests (release reproducibility,
 * master plan Phase 0 "done when").
 */
export function buildVendorManifest(input: {
  bunVersion: string;
  convertxVersion: string;
  converters: ConverterManifest;
}): VendorManifest {
  return {
    schema: 1,
    bun: input.bunVersion,
    convertx: { repo: CONVERTX_REPO, ref: CONVERTX_REF, version: input.convertxVersion },
    converters: input.converters.tools.map(({ name, version, url, sha256 }) => ({
      name,
      version,
      url,
      sha256,
    })),
  };
}

if (import.meta.main) {
  const bunVersion = readFileSync(join(PROJECT_ROOT, ".bun-version"), "utf8").trim();
  const convertxVersion = (
    JSON.parse(readFileSync(join(PROJECT_ROOT, "vendor", "convertx", "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const converters = await loadConverterManifest(CONVERTER_MANIFEST_PATH);
  const manifest = buildVendorManifest({ bunVersion, convertxVersion, converters });
  const dest = join(PROJECT_ROOT, "vendor", VENDOR_MANIFEST_NAME);
  writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${dest}`);
}
```

- [ ] **Step 5: Run the test, then generate the real manifest**

```powershell
bun test scripts/write-vendor-manifest.test.ts
bun run scripts/write-vendor-manifest.ts
Get-Content vendor\vendor-manifest.json
```

Expected: 2 tests pass; `vendor/vendor-manifest.json` shows `"schema": 1`, bun `1.3.14`, convertx ref `0965928…` version `0.17.0`, and 7 converters. (The file lives under gitignored `vendor/` — it is a build product; its inputs are what's committed.)

- [ ] **Step 6: Wire into the setup chain**

`package.json`, old:

```json
    "setup": "bun run scripts/setup-convertx.ts && bun run scripts/fetch-converters.ts"
```

new:

```json
    "setup": "bun run scripts/setup-convertx.ts && bun run scripts/fetch-converters.ts && bun run scripts/write-vendor-manifest.ts"
```

- [ ] **Step 7: Bake the manifest into the bundle**

In `scripts/bundle-vendor.ts`, extend the vendor-spec import (Task 3 added it):

```typescript
import { EXCLUDED_CONVERTX_ENTRIES, VENDOR_MANIFEST_NAME } from "../src/shared/vendor-spec";
```

and after the `for (const parts of …)` copy loop, add:

```typescript
// The vendor manifest records exactly which upstream ref and converter
// binaries this bundle ships — needed for accurate AGPL source-offer text on
// releases and, later, the app-data refresh marker (master plan Phase 1).
const manifestSrc = join(VENDOR_SRC, VENDOR_MANIFEST_NAME);
if (!existsSync(manifestSrc)) {
  console.error(`Missing ${manifestSrc}. Run 'bun run setup' (it writes the vendor manifest) first.`);
  process.exit(1);
}
cpSync(manifestSrc, join(vendorDest, VENDOR_MANIFEST_NAME));
console.log(`Copied ${VENDOR_MANIFEST_NAME} into the bundle.`);
```

- [ ] **Step 8: Verify**

```powershell
bun run test
bun x tsc --noEmit
```

Expected: all tests pass, tsc clean.

- [ ] **Step 9: Commit**

```powershell
git add .bun-version scripts/write-vendor-manifest.ts scripts/write-vendor-manifest.test.ts package.json scripts/bundle-vendor.ts
git commit -m @'
feat: bake a deterministic vendor manifest into the bundle

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 10: RELEASING.md

**Files:**
- Create: `RELEASING.md`

- [ ] **Step 1: Write RELEASING.md**

```markdown
# Releasing ConvertX Desktop

Phase 0 state: releases are built locally and are **unsigned** (signing track
deferred — master plan §6.2). CI, the installer, and auto-update arrive in
Phases 2–3.

## Inputs and where they are pinned

| Input | Pin |
|---|---|
| ConvertX source | `scripts/lib/pins.ts` (`CONVERTX_REF`) |
| Converter binaries | `scripts/converter-manifest.json` (URL + sha256 each) |
| Bun | `.bun-version` |
| Electrobun | `package.json` / `bun.lock` |
| Tailwind CLI | transitively via `CONVERTX_REF` (ConvertX's own lockfile) |
| App version | `package.json` `version` (electrobun.config.ts reads it) |

## Release steps

1. Bump `version` in `package.json` (semver). Commit.
2. Clean build from pinned inputs:
   ```powershell
   bun install
   bun run setup        # vendors ConvertX at the pin, hash-verifies converters,
                        # writes vendor/vendor-manifest.json
   bun run test
   bun run scripts/smoke.ts
   bun run package      # electrobun build + vendor bake (incl. the manifest)
   ```
3. Zip the bundle:
   ```powershell
   Compress-Archive -Path build\dev-win-x64\ConvertX-dev\* -DestinationPath ConvertX-Desktop-<version>-win-x64.zip
   ```
4. Create a GitHub Release for the tag with:
   - the zip;
   - a `SHA256SUMS.txt` (`Get-FileHash` output for every asset);
   - the exact vendored ConvertX commit (from `vendor/vendor-manifest.json`) and
     a source link: `https://github.com/C4illin/ConvertX/tree/<ref>` — this is
     the AGPL source offer for the ConvertX code being distributed;
   - a note that binaries are unsigned and SmartScreen will warn
     ("More info → Run anyway").

## Updating pins

- **ConvertX**: bump `CONVERTX_REF` in `scripts/lib/pins.ts`, delete
  `vendor/convertx`, `bun run setup`, re-verify the no-login env vars still
  exist upstream (master plan §7 "Upstream ConvertX drift"), run the smoke test.
- **Converters**: `bun run scripts/fetch-converters.ts --record`, review the
  manifest diff (versions and hashes), run the smoke test, commit.
- A hash mismatch on a *normal* fetch means the upstream file changed in place
  — investigate before re-recording; never re-record just to silence it.
```

- [ ] **Step 2: Commit**

```powershell
git add RELEASING.md
git commit -m @'
docs: add RELEASING.md documenting the pinned release process

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
```

---

### Task 11: README refresh, full verification, determinism check, push

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README setup docs**

In the `bun run setup` section, replace the sentence about the unpinned clone:

Old (inside the `scripts/setup-convertx.ts` bullet):
```markdown
  Note: this is **not** a pinned ref — a fresh clone gets the current
  upstream default branch; delete `vendor/convertx` to re-vendor.
```
New:
```markdown
  The clone is pinned to the commit in `scripts/lib/pins.ts`; delete
  `vendor/convertx` and re-run setup after bumping the pin.
```

In the `scripts/fetch-converters.ts` bullet, replace:
```markdown
  Tools resolved from "latest GitHub release" may move; the script
  prints a per-tool OK/FAIL summary and warns if ffmpeg or ImageMagick are missing (the smoke
  test needs them). Re-run it or drop the binaries in manually if a download fails.
```
with:
```markdown
  Downloads are pinned by `scripts/converter-manifest.json` (exact URL + sha256 per
  tool) and hash-verified; the script prints a per-tool OK/FAIL summary and fails the
  setup chain on any failure. To bump converter versions, run
  `bun run scripts/fetch-converters.ts --record` and commit the manifest diff.
```

Also append to that section: the setup chain ends with `scripts/write-vendor-manifest.ts`, which records the pins into `vendor/vendor-manifest.json` (baked into packaged bundles). Update the test command mention `bun test src/bun` → `bun run test`, and add `RELEASING.md` to the docs the README points at.

- [ ] **Step 2: Full local verification**

```powershell
bun run test
bun run scripts/smoke.ts
bun run package
Test-Path build\dev-win-x64\ConvertX-dev\Resources\app\vendor\vendor-manifest.json
```

Expected: tests pass, smoke test converts PNG→JPG, package succeeds, `Test-Path` prints `True`.

- [ ] **Step 3: Determinism check (master plan "done when")**

Fresh clone, two consecutive setup runs, byte-identical manifests:

```powershell
$tmp = Join-Path $env:TEMP "cx-determinism"
Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
git clone C:\Users\PC\Projects\ConvertX $tmp
Push-Location $tmp
bun install
bun run setup
$h1 = (Get-FileHash vendor\vendor-manifest.json).Hash
bun run setup
$h2 = (Get-FileHash vendor\vendor-manifest.json).Hash
Pop-Location
"run1: $h1"; "run2: $h2"; if ($h1 -eq $h2) { "DETERMINISTIC" } else { "MISMATCH" }
```

Expected: `DETERMINISTIC`. (The second `bun run setup` also proves idempotency: pinned-ref verify path + hash-verified re-downloads.)

- [ ] **Step 4: Clean up, commit, push**

```powershell
Remove-Item -Recurse -Force (Join-Path $env:TEMP "cx-determinism")
git add README.md
git commit -m @'
docs: document pinned setup, record mode, and the vendor manifest

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
'@
git push
```

Expected: push succeeds; `gh repo view convertx-desktop --json defaultBranchRef` still shows `main`.

---

## Self-review notes

- **Spec coverage:** GitHub publication (T2), ConvertX pin + manifest (T8, T9), converter pins + sha256 (T5–T7), GITHUB_TOKEN (T6 `githubHeaders`), Tailwind/Bun pins (T8 comment / T9 `.bun-version`), version + name + exclusion-list single sources (T3), AGPL layout (T1, RELEASING source-offer text in T10), RELEASING.md (T10), determinism done-when (T11). The master plan's "GITHUB_TOKEN for API calls" shrank in scope by design: normal fetches no longer call any API (pins are direct URLs), so the token only matters for `--record`.
- **Deliberate scope cuts (YAGNI):** no app-data dir rename (orphans user data; Phase 1 decision), no CI yaml (Phase 2), no signing steps (deferred by user).
- **Type consistency check:** `PinnedTool` is defined once (T5) and imported by T6/T9; `VENDOR_MANIFEST_NAME`/`EXCLUDED_CONVERTX_ENTRIES` defined once (T3) and imported by T6-adjacent files and T9; `CONVERTX_REF`/`CONVERTX_REPO` defined once (T8) and imported by T9. `buildVendorManifest` signature in T9's test matches the implementation.
- **Ordering constraint:** T3 must precede T9 (bundle-vendor import exists); T5 precedes T6; T6 precedes T7; T7+T8 precede T9's real-manifest generation. Tasks are ordered accordingly.
