import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

/** The cwd the process was launched with (needed to resolve relative argv). */
export const ORIGINAL_CWD = process.cwd();

// Electrobun resolves its Resources paths from process.cwd() at import time,
// so the supervisor only works when cwd is the bundle's bin dir. Shell
// launches (file associations invoke bin\bun.exe directly because
// launcher.exe drops argv — see the file-handoff spec) arrive with arbitrary
// cwds; normalize BEFORE anything imports electrobun (this module must stay
// the first import of index.ts). No-op outside a packaged/built bundle layout.
const execDir = dirname(process.execPath);
if (existsSync(join(execDir, "..", "Resources")) && process.cwd() !== execDir) {
  try {
    process.chdir(execDir);
  } catch {
    // fall through — the cwd-based vendor candidates may still work
  }
}
