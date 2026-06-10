import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, PATHS } from "electrobun/bun";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";
import { buildConvertxEnv, converterPathEntries, startConvertX } from "./convertx";
import { waitForHealth } from "./health";
import { getAppPaths } from "./paths";
import { findFreePort } from "./port";

/** Read the persisted JWT secret, or generate and persist one on first run. */
function loadJwtSecret(file: string): string {
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing) return existing;
  }
  const secret = randomUUID();
  writeFileSync(file, secret, "utf8");
  return secret;
}

function errorPage(message: string): string {
  const escaped = message.replace(
    /[&<>]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!,
  );
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ConvertX</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e8e8e8;padding:2rem;line-height:1.5}
h1{font-size:1.3rem}pre{background:#000;color:#ddd;padding:1rem;border-radius:6px;
overflow:auto;white-space:pre-wrap;word-break:break-word}</style></head>
<body><h1>ConvertX failed to start</h1><pre>${escaped}</pre></body></html>`;
}

const mainWindow = new BrowserWindow({
  title: "ConvertX",
  url: "views://mainview/index.html",
  frame: { width: 1100, height: 800, x: 150, y: 100 },
});

let stopConvertX: (() => void) | undefined;
const cleanup = () => stopConvertX?.();
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

async function boot(): Promise<void> {
  // Resolve vendor/ — the first candidate containing convertx/package.json
  // wins; if none does, pickVendorDir throws and boot().catch below shows it
  // on the error page. Candidates that resolve to nonexistent or unrelated
  // dirs (e.g. the dev candidate inside a packaged install) are skipped.
  const vendorDir = pickVendorDir([
    // Packaged bundle: vendor/ baked next to the app by scripts/bundle-vendor.ts.
    join(PATHS.RESOURCES_FOLDER, "app", "vendor"),
    // Dev (`bun run dev`): electrobun wipes build/dev-win-x64 on every build
    // and runs the launcher with cwd = .../ConvertX-dev/bin, so reach the
    // project root from Resources -> ConvertX-dev -> dev-win-x64 -> build ->
    // project root (four ".." segments).
    join(PATHS.RESOURCES_FOLDER, "..", "..", "..", "..", "vendor"),
    // Supervisor run directly from the project root (e.g. `bun src/bun/index.ts`).
    join(process.cwd(), "vendor"),
  ]);
  const convertersDir = join(vendorDir, "converters", "win");

  const paths = getAppPaths();

  // First run: copy ConvertX from the (read-only-safe) bundle into a writable
  // location. ConvertX then runs with paths.convertxDir as its cwd, so its
  // ./data and ./public both resolve inside writable app-data.
  ensureConvertxCopy(join(vendorDir, "convertx"), paths.convertxDir);

  const jwtSecret = loadJwtSecret(paths.jwtSecretFile);
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;

  let stderrTail = "";
  const env = buildConvertxEnv({
    port,
    jwtSecret,
    pathPrepend: converterPathEntries(convertersDir),
  });
  // Rejects when the ConvertX child dies or fails to spawn (never on stop()).
  // Raced against waitForHealth so a crash at boot surfaces immediately
  // instead of after the full health timeout.
  let rejectChildFailure: (err: Error) => void = () => {};
  const childFailure = new Promise<never>((_, reject) => {
    rejectChildFailure = reject;
  });

  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: paths.convertxDir,
    env,
    onStdout: (chunk) => process.stdout.write(`[convertx] ${chunk}`),
    onStderr: (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
      process.stderr.write(`[convertx] ${chunk}`);
    },
    onError: (err) =>
      rejectChildFailure(new Error(`ConvertX failed to spawn: ${err.message}`)),
    onExit: (code) =>
      rejectChildFailure(new Error(`ConvertX exited with code ${code ?? "unknown"}`)),
  });
  stopConvertX = proc.stop;

  try {
    await Promise.race([waitForHealth(url, 45_000), childFailure]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mainWindow.webview.loadHTML(
      errorPage(`${message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`),
    );
    return;
  }

  mainWindow.webview.loadURL(url);
  console.log(`ConvertX ready at ${url}`);

  // If ConvertX dies after the app is up (not via stop()), replace the dead
  // webview with diagnostics instead of leaving it unresponsive.
  childFailure.catch((err: Error) => {
    mainWindow.webview.loadHTML(
      errorPage(
        `ConvertX stopped unexpectedly.\n${err.message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`,
      ),
    );
  });
}

boot().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(message);
  mainWindow.webview.loadHTML(errorPage(message));
});
