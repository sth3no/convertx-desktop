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
