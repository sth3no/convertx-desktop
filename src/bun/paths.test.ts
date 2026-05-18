import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppPaths, ensureDataJunction } from "./paths";

test("getAppPaths derives paths and creates the data directory", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-paths-"));
  const paths = getAppPaths(base);
  expect(paths.appDataDir).toBe(join(base, "ConvertX-Electrobun"));
  expect(paths.dataDir).toBe(join(base, "ConvertX-Electrobun", "data"));
  expect(paths.jwtSecretFile).toBe(join(base, "ConvertX-Electrobun", "jwt-secret"));
  expect(existsSync(paths.dataDir)).toBe(true);
});

test("ensureDataJunction links a missing path onto the data directory", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-junc-"));
  const paths = getAppPaths(base);
  const link = join(base, "convertx-data");
  ensureDataJunction(link, paths.dataDir);
  expect(existsSync(link)).toBe(true);
  expect(realpathSync(link)).toBe(realpathSync(paths.dataDir));
});

test("ensureDataJunction leaves an already-existing path untouched", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-junc2-"));
  const paths = getAppPaths(base);
  // paths.appDataDir already exists (getAppPaths created it) — must not throw.
  ensureDataJunction(paths.appDataDir, paths.dataDir);
  expect(existsSync(paths.appDataDir)).toBe(true);
});
