import { statSync } from "node:fs";
import { resolve } from "node:path";

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * File paths from a launch argv: everything after the script path that isn't
 * a flag and resolves (against the ORIGINAL launch cwd) to an existing file.
 * Shell associations pass absolute paths; relative ones cover manual CLI use.
 */
export function extractFileArgs(argv: string[], cwd: string): string[] {
  return argv
    .slice(2)
    .filter((arg) => !arg.startsWith("-"))
    .map((arg) => resolve(cwd, arg))
    .filter(isFile);
}

/**
 * Queue of files handed to the app ("Open with", drag-onto-exe, second
 * launches). The shell only queues — the frontend claims the paths and
 * performs the upload through the ConvertX page session (docs/API.md).
 */
export function createPendingFiles() {
  const queue: string[] = [];
  return {
    /** Add existing files (deduped); returns how many were queued. */
    add(paths: string[]): number {
      let added = 0;
      for (const raw of paths) {
        if (typeof raw !== "string" || raw.length === 0) continue;
        const path = resolve(raw);
        if (isFile(path) && !queue.includes(path)) {
          queue.push(path);
          added++;
        }
      }
      return added;
    },
    peek: (): string[] => [...queue],
    /** Return and clear the queue. */
    claim(): string[] {
      const files = [...queue];
      queue.length = 0;
      return files;
    },
  };
}
