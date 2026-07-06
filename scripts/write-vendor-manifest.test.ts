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
