import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractArchive, findFile } from "./archive";

function makeZip(): { zip: string; base: string } {
  const base = mkdtempSync(join(tmpdir(), "cx-arch-"));
  const content = join(base, "content", "nested");
  mkdirSync(content, { recursive: true });
  writeFileSync(join(content, "tool.exe"), "fake exe");
  const zip = join(base, "archive.zip");
  // System bsdtar creates zips too (-a infers format from the extension).
  const result = spawnSync(
    join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe"),
    ["-a", "-cf", zip, "-C", join(base, "content"), "."],
  );
  expect(result.status).toBe(0);
  return { zip, base };
}

test("extractArchive unpacks and findFile locates files case-insensitively", () => {
  const { zip, base } = makeZip();
  const dest = join(base, "out");
  mkdirSync(dest, { recursive: true });
  extractArchive(zip, dest);
  const hit = findFile(dest, "TOOL.EXE");
  expect(hit).toBeDefined();
  expect(hit!.toLowerCase().endsWith("tool.exe")).toBe(true);
});

test("extractArchive throws on a non-archive", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-archbad-"));
  const bogus = join(base, "not.zip");
  writeFileSync(bogus, "hello");
  expect(() => extractArchive(bogus, base)).toThrow(/extract/);
});
