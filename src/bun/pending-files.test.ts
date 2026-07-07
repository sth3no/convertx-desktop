import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createPendingFiles, extractFileArgs } from "./pending-files";

function makeFiles(): { dir: string; a: string; b: string } {
  const dir = mkdtempSync(join(tmpdir(), "cx-pending-"));
  const a = join(dir, "a.png");
  const b = join(dir, "b.docx");
  writeFileSync(a, "x");
  writeFileSync(b, "y");
  return { dir, a, b };
}

test("extractFileArgs keeps only existing files, resolves relative paths, drops flags", () => {
  const { dir, a, b } = makeFiles();
  const argv = [
    "C:\\app\\bin\\bun.exe",
    "C:\\app\\Resources\\main.js",
    a,
    basename(b), // relative to cwd
    "--flag",
    "C:\\does\\not\\exist.png",
    dir, // a directory, not a file
  ];
  expect(extractFileArgs(argv, dir)).toEqual([a, b]);
  expect(extractFileArgs(["bun.exe", "main.js"], dir)).toEqual([]);
});

test("queue: add filters and dedupes; peek preserves; claim drains", () => {
  const { a, b } = makeFiles();
  const queue = createPendingFiles();
  expect(queue.add([a, b, a, "C:\\nope.txt"])).toBe(2);
  expect(queue.peek()).toEqual([a, b]);
  expect(queue.peek()).toEqual([a, b]); // peek does not drain
  expect(queue.claim()).toEqual([a, b]);
  expect(queue.peek()).toEqual([]);
  expect(queue.add([a])).toBe(1); // re-addable after claim
});
