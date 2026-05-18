import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow } from "electrobun/bun";
import { buildConvertxEnv, converterPathEntries, startConvertX } from "./convertx";
import { waitForHealth } from "./health";
import { ensureDataJunction, getAppPaths } from "./paths";
import { findFreePort } from "./port";

const PROJECT_ROOT = process.env.CONVERTX_PROJECT_ROOT ?? process.cwd();
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTERS_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");

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
  if (!existsSync(join(CONVERTX_DIR, "package.json"))) {
    throw new Error(
      `ConvertX is not vendored at:\n  ${CONVERTX_DIR}\n\n` +
        `Run the setup script first:\n  bun run scripts/setup-convertx.ts`,
    );
  }

  const paths = getAppPaths();
  ensureDataJunction(join(CONVERTX_DIR, "data"), paths.dataDir);

  const jwtSecret = loadJwtSecret(paths.jwtSecretFile);
  const port = await findFreePort();
  const url = `http://127.0.0.1:${port}/`;

  let stderrTail = "";
  const env = buildConvertxEnv({
    port,
    jwtSecret,
    pathPrepend: converterPathEntries(CONVERTERS_DIR),
  });
  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: CONVERTX_DIR,
    env,
    onStdout: (chunk) => process.stdout.write(`[convertx] ${chunk}`),
    onStderr: (chunk) => {
      stderrTail = (stderrTail + chunk).slice(-4000);
      process.stderr.write(`[convertx] ${chunk}`);
    },
  });
  stopConvertX = proc.stop;

  try {
    await waitForHealth(url, 45_000);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    mainWindow.webview.loadHTML(
      errorPage(`${message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`),
    );
    return;
  }

  mainWindow.webview.loadURL(url);
  console.log(`ConvertX ready at ${url}`);
}

boot().catch((err) => {
  const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
  console.error(message);
  mainWindow.webview.loadHTML(errorPage(message));
});
