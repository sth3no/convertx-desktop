import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";

/** Make a fake vendor dir containing convertx/package.json. */
function makeVendor(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `cx-${label}-`));
  mkdirSync(join(dir, "convertx"), { recursive: true });
  writeFileSync(join(dir, "convertx", "package.json"), "{}");
  return dir;
}

test("pickVendorDir picks the first candidate containing ConvertX", () => {
  const first = makeVendor("first");
  const second = makeVendor("second");
  expect(pickVendorDir([first, second])).toBe(first);
});

test("pickVendorDir skips earlier candidates missing ConvertX", () => {
  const missing = join(tmpdir(), "cx-nonexistent-packaged");
  const second = makeVendor("mid");
  const third = makeVendor("last");
  expect(pickVendorDir([missing, second, third])).toBe(second);
});

test("pickVendorDir throws an error listing every candidate", () => {
  const candidates = ["X:\\nope\\a", "X:\\nope\\b", "X:\\nope\\c"] as const;
  let message = "";
  try {
    pickVendorDir(candidates);
  } catch (err) {
    message = err instanceof Error ? err.message : String(err);
  }
  expect(message).toMatch(/ConvertX not found/);
  for (const candidate of candidates) {
    expect(message).toContain(candidate);
  }
  // The hint must name the commands that actually restore a vendor dir.
  expect(message).toContain("bun run setup");
  expect(message).toContain("bun run package");
});

test("ensureConvertxCopy copies on first run and is idempotent", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-copy-"));
  const src = join(base, "src-convertx");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  writeFileSync(join(src, "marker.txt"), "v1");
  const dest = join(base, "dest-convertx");

  ensureConvertxCopy(src, dest);
  expect(existsSync(join(dest, "package.json"))).toBe(true);
  expect(existsSync(join(dest, "marker.txt"))).toBe(true);

  // Second call must not throw and must not overwrite (dest already exists).
  writeFileSync(join(dest, "marker.txt"), "edited");
  ensureConvertxCopy(src, dest);
  expect(readFileSync(join(dest, "marker.txt"), "utf8")).toBe("edited");
});

test("ensureConvertxCopy excludes top-level data and .git but keeps nested data", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-filter-"));
  const src = join(base, "src-convertx");
  mkdirSync(join(src, "data"), { recursive: true });
  writeFileSync(join(src, "data", "db.sqlite"), "live developer state");
  mkdirSync(join(src, ".git"), { recursive: true });
  writeFileSync(join(src, ".git", "HEAD"), "ref: refs/heads/main");
  // Only the TOP-LEVEL "data" entry is runtime state; nested ones are source.
  mkdirSync(join(src, "src", "data"), { recursive: true });
  writeFileSync(join(src, "src", "data", "keep.txt"), "source file");
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  const dest = join(base, "dest-convertx");

  ensureConvertxCopy(src, dest);
  expect(existsSync(join(dest, "package.json"))).toBe(true);
  expect(existsSync(join(dest, "data"))).toBe(false);
  expect(existsSync(join(dest, ".git"))).toBe(false);
  expect(existsSync(join(dest, "src", "data", "keep.txt"))).toBe(true);
});

test("ensureConvertxCopy discards a stale .partial dir and leaves none behind", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-stale-"));
  const src = join(base, "src-convertx");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  const dest = join(base, "dest-convertx");
  // Remnant of a previous copy that crashed before the rename.
  const partial = `${dest}.partial`;
  mkdirSync(partial, { recursive: true });
  writeFileSync(join(partial, "stale.txt"), "from an interrupted copy");

  ensureConvertxCopy(src, dest);
  expect(existsSync(join(dest, "package.json"))).toBe(true);
  expect(existsSync(join(dest, "stale.txt"))).toBe(false);
  expect(existsSync(partial)).toBe(false);
});

test("ensureConvertxCopy replaces a dest lacking package.json (pre-atomic partial)", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-broken-"));
  const src = join(base, "src-convertx");
  mkdirSync(src, { recursive: true });
  writeFileSync(join(src, "package.json"), '{"name":"convertx"}');
  // A dest from the pre-atomic era: the copy crashed before package.json
  // landed, so the dir exists but must not count as a completed copy.
  const dest = join(base, "dest-convertx");
  mkdirSync(dest, { recursive: true });
  writeFileSync(join(dest, "leftover.txt"), "half-copied junk");

  ensureConvertxCopy(src, dest);
  expect(existsSync(join(dest, "package.json"))).toBe(true);
  expect(existsSync(join(dest, "leftover.txt"))).toBe(false);
});
