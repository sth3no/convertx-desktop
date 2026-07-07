import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, loadSettingsFile, saveSettings, sanitizeSettings } from "./settings";

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), "cx-settings-")), "settings.json");
}

test("missing file -> defaults, fromFile false; save/load round-trips", () => {
  const file = tempFile();
  const first = loadSettingsFile(file);
  expect(first.fromFile).toBe(false);
  expect(first.settings).toEqual(DEFAULT_SETTINGS);

  saveSettings(file, { autoDeleteHours: 72, updateMode: "notify" });
  const second = loadSettingsFile(file);
  expect(second.fromFile).toBe(true);
  expect(second.settings).toEqual({ autoDeleteHours: 72, updateMode: "notify" });
});

test("corrupt or invalid files fall back to defaults per field", () => {
  const file = tempFile();
  writeFileSync(file, "{nope");
  expect(loadSettingsFile(file)).toEqual({ settings: DEFAULT_SETTINGS, fromFile: false });

  writeFileSync(file, JSON.stringify({ autoDeleteHours: -5, updateMode: "yolo" }));
  const loaded = loadSettingsFile(file);
  expect(loaded.fromFile).toBe(true);
  expect(loaded.settings).toEqual(DEFAULT_SETTINGS);
});

test("sanitizeSettings accepts partial updates and rejects bad values", () => {
  expect(sanitizeSettings({ autoDeleteHours: 0 })).toEqual({ autoDeleteHours: 0 });
  expect(sanitizeSettings({ updateMode: "notify" })).toEqual({ updateMode: "notify" });
  expect(sanitizeSettings({ autoDeleteHours: "week", updateMode: 3, junk: true })).toEqual({});
});
