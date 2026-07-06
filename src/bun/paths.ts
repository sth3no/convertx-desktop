import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AppPaths {
  /** Root of all writable app state. */
  appDataDir: string;
  /** Writable copy of ConvertX; ConvertX runs with this as its cwd. */
  convertxDir: string;
  /** Persisted JWT secret file. */
  jwtSecretFile: string;
  /** Rotating log files (see src/bun/logger.ts). */
  logsDir: string;
  /** Persisted window bounds + maximized flag. */
  windowStateFile: string;
}

/**
 * Resolve the OS app-data directory for the desktop app and ensure it exists.
 * `appDataBase` defaults to %APPDATA% on Windows.
 */
export function getAppPaths(
  appDataBase: string = process.env.APPDATA ?? homedir(),
): AppPaths {
  const appDataDir = join(appDataBase, "ConvertX-Electrobun");
  mkdirSync(appDataDir, { recursive: true });
  return {
    appDataDir,
    convertxDir: join(appDataDir, "convertx"),
    jwtSecretFile: join(appDataDir, "jwt-secret"),
    logsDir: join(appDataDir, "logs"),
    windowStateFile: join(appDataDir, "window-state.json"),
  };
}
