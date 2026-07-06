import { expect, test } from "bun:test";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAppPaths } from "./paths";

test("getAppPaths derives paths and creates the app-data directory", () => {
  const base = mkdtempSync(join(tmpdir(), "cx-paths-"));
  const paths = getAppPaths(base);
  expect(paths.appDataDir).toBe(join(base, "ConvertX-Electrobun"));
  expect(paths.convertxDir).toBe(join(base, "ConvertX-Electrobun", "convertx"));
  expect(paths.jwtSecretFile).toBe(join(base, "ConvertX-Electrobun", "jwt-secret"));
  expect(paths.logsDir).toBe(join(base, "ConvertX-Electrobun", "logs"));
  expect(paths.windowStateFile).toBe(join(base, "ConvertX-Electrobun", "window-state.json"));
  expect(existsSync(paths.appDataDir)).toBe(true);
});
