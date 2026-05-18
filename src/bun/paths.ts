import { existsSync, mkdirSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  appDataDir: string;
  dataDir: string;
  jwtSecretFile: string;
}

/**
 * Resolve the OS app-data directory for the desktop app and ensure the data
 * directory exists. `appDataBase` defaults to %APPDATA% on Windows.
 */
export function getAppPaths(
  appDataBase: string = process.env.APPDATA ?? homedir(),
): AppPaths {
  const appDataDir = join(appDataBase, "ConvertX-Electrobun");
  const dataDir = join(appDataDir, "data");
  mkdirSync(dataDir, { recursive: true });
  return { appDataDir, dataDir, jwtSecretFile: join(appDataDir, "jwt-secret") };
}

/**
 * Make `linkPath` a Windows directory junction onto `dataDir`, so ConvertX's
 * cwd-relative `./data` lands in the OS app-data dir. Idempotent: if `linkPath`
 * already exists it is left as-is.
 */
export function ensureDataJunction(linkPath: string, dataDir: string): void {
  if (existsSync(linkPath)) return;
  symlinkSync(dataDir, linkPath, "junction");
}
