import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export interface Logger {
  log: (line: string) => void;
  logPath: string;
}

/**
 * Timestamped, size-rotated file logger. Rotates convertx.log ->
 * convertx.log.1 (one old generation) once it exceeds maxBytes. Logging is
 * diagnostics — it must never crash the app, so all IO errors are swallowed.
 */
export function createLogger(logsDir: string, maxBytes = 1024 * 1024): Logger {
  try {
    mkdirSync(logsDir, { recursive: true });
  } catch {
    // fall through — log() will no-op on write errors
  }
  const logPath = join(logsDir, "convertx.log");
  const rotated = `${logPath}.1`;
  return {
    logPath,
    log(line: string) {
      try {
        if (existsSync(logPath) && statSync(logPath).size >= maxBytes) {
          rmSync(rotated, { force: true });
          renameSync(logPath, rotated);
        }
        const text = line.endsWith("\n") ? line : `${line}\n`;
        appendFileSync(logPath, `[${new Date().toISOString()}] ${text}`);
      } catch {
        // never throw from logging
      }
    },
  };
}
