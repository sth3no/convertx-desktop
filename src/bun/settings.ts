import { readFileSync, writeFileSync } from "node:fs";

export interface Settings {
  /** AUTO_DELETE_EVERY_N_HOURS for the ConvertX child; 0 disables cleanup. */
  autoDeleteHours: number;
  /** "auto": auto-download + install-on-quit. "notify": frontend drives it. */
  updateMode: "auto" | "notify";
}

export const DEFAULT_SETTINGS: Settings = { autoDeleteHours: 168, updateMode: "auto" };

/** Keep only valid fields from an unknown partial (API input, file content). */
export function sanitizeSettings(value: unknown): Partial<Settings> {
  const out: Partial<Settings> = {};
  if (typeof value !== "object" || value === null) return out;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.autoDeleteHours === "number" &&
    raw.autoDeleteHours >= 0 &&
    Number.isFinite(raw.autoDeleteHours)
  ) {
    out.autoDeleteHours = raw.autoDeleteHours;
  }
  if (raw.updateMode === "auto" || raw.updateMode === "notify") {
    out.updateMode = raw.updateMode;
  }
  return out;
}

export function loadSettingsFile(file: string): { settings: Settings; fromFile: boolean } {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return { settings: { ...DEFAULT_SETTINGS, ...sanitizeSettings(parsed) }, fromFile: true };
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, fromFile: false };
  }
}

export function saveSettings(file: string, settings: Settings): void {
  writeFileSync(file, `${JSON.stringify(settings, null, 2)}\n`);
}
