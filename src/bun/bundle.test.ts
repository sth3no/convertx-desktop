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

test("pickVendorDir prefers the packaged dir when it has ConvertX", () => {
  const packaged = makeVendor("pkg");
  const dev = makeVendor("dev");
  expect(pickVendorDir(packaged, dev)).toBe(packaged);
});

test("pickVendorDir falls back to the dev dir", () => {
  const dev = makeVendor("dev2");
  const packaged = join(tmpdir(), "cx-nonexistent-packaged");
  expect(pickVendorDir(packaged, dev)).toBe(dev);
});

test("pickVendorDir throws when ConvertX is in neither", () => {
  expect(() => pickVendorDir("X:\\nope\\a", "X:\\nope\\b")).toThrow(/ConvertX not found/);
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
