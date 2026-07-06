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
