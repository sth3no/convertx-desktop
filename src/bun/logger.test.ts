import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./logger";

test("createLogger appends timestamped lines and reports its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-log-"));
  const logger = createLogger(dir);
  logger.log("hello");
  logger.log("world\n");
  const content = readFileSync(logger.logPath, "utf8");
  const lines = content.trimEnd().split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T[0-9:.]+Z\] hello$/);
  expect(lines[1]).toMatch(/world$/);
  expect(logger.logPath).toBe(join(dir, "convertx.log"));
});

test("createLogger rotates once the file exceeds maxBytes", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-logrot-"));
  const logger = createLogger(dir, 200);
  for (let i = 0; i < 20; i++) logger.log(`line ${i} ${"x".repeat(40)}`);
  expect(existsSync(join(dir, "convertx.log"))).toBe(true);
  expect(existsSync(join(dir, "convertx.log.1"))).toBe(true);
  // Rotation keeps exactly one old generation.
  expect(existsSync(join(dir, "convertx.log.2"))).toBe(false);
});

test("log never throws even when the directory is gone", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-loggone-"));
  const logger = createLogger(dir);
  rmSync(dir, { recursive: true, force: true });
  expect(() => logger.log("into the void")).not.toThrow();
});
