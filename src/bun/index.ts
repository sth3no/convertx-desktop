import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, PATHS, Screen, Utils } from "electrobun/bun";
import { VENDOR_MANIFEST_NAME } from "../shared/vendor-spec";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";
import { startControlServer, type ControlServer } from "./control";
import {
  buildConvertxEnv,
  converterPathEntries,
  startConvertX,
  writeLoopbackShim,
} from "./convertx";
import { waitForHealth } from "./health";
import {
  isLockAlive,
  lockFilePath,
  readLock,
  reapStaleConvertx,
  removeLock,
  requestFocus,
  updateLockChildPid,
  writeLock,
} from "./instance";
import { buildLinkInterceptorJs, isExternalUrl } from "./linkguard";
import { createLogger } from "./logger";
import { getAppPaths } from "./paths";
import { resolvePort } from "./port";
import {
  clampToDisplays,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from "./window-state";

const SPLASH_URL = "views://mainview/index.html";
/** Minimum spacing between silent auto-restarts (crash-loop guard). */
const AUTO_RESTART_COOLDOWN_MS = 10 * 60_000;

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

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function errorPage(message: string, opts: { logPath: string; restartUrl?: string }): string {
  const restartButton = opts.restartUrl
    ? `<button onclick="this.disabled=true;this.textContent='Restarting…';` +
      `fetch(${JSON.stringify(opts.restartUrl)},{method:'POST',mode:'no-cors'}).catch(()=>{})">` +
      `Restart ConvertX</button>`
    : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ConvertX</title>
<style>body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e8e8e8;padding:2rem;line-height:1.5}
h1{font-size:1.3rem}pre{background:#000;color:#ddd;padding:1rem;border-radius:6px;
overflow:auto;white-space:pre-wrap;word-break:break-word}
button{margin:1rem 0;padding:.5rem 1.2rem;font-size:1rem;border-radius:6px;border:1px solid #555;
background:#2a5aa0;color:#fff;cursor:pointer}button:disabled{background:#444;cursor:default}
.meta{color:#9a9a9a;font-size:.9rem}</style></head>
<body><h1>ConvertX failed to start</h1>${restartButton}
<pre>${escapeHtml(message)}</pre>
<p class="meta">Log file: ${escapeHtml(opts.logPath)}</p></body></html>`;
}

async function main(): Promise<void> {
  const paths = getAppPaths();
  const logger = createLogger(paths.logsDir);

  // --- Single-instance gate. Runs before any app-data mutation, so two
  // --- racing launches can never fight over the convertx copy.
  const lockFile = lockFilePath(paths.appDataDir);
  const existing = readLock(lockFile);
  if (existing && (await isLockAlive(existing))) {
    await requestFocus(existing);
    console.log("Another ConvertX instance is running — focused it and exiting.");
    process.exit(0);
  }
  if (existing) {
    logger.log(`stale instance lock found (pid ${existing.pid})`);
    reapStaleConvertx(existing, logger.log);
  }

  // --- Window, restored from persisted state and clamped to real displays.
  const savedState = clampToDisplays(
    loadWindowState(paths.windowStateFile),
    Screen.getAllDisplays(),
  );
  const mainWindow = new BrowserWindow({
    title: "ConvertX",
    url: SPLASH_URL,
    frame: {
      x: savedState.x,
      y: savedState.y,
      width: savedState.width,
      height: savedState.height,
    },
  });
  if (savedState.maximized) mainWindow.maximize();

  // Persist window state from debounced resize/move (the close event carries
  // no frame, and getFrame() on a closing window is unreliable — so close
  // only flushes the last captured state).
  let pendingState: WindowState = { ...savedState };
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const capture = () => {
    try {
      if (mainWindow.isMaximized()) {
        pendingState = { ...pendingState, maximized: true };
      } else {
        const f = mainWindow.getFrame();
        pendingState = { x: f.x, y: f.y, width: f.width, height: f.height, maximized: false };
      }
      saveWindowState(paths.windowStateFile, pendingState);
    } catch {
      // never let state persistence break the app
    }
  };
  const scheduleCapture = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(capture, 500);
  };
  mainWindow.on("resize", scheduleCapture);
  mainWindow.on("move", scheduleCapture);
  mainWindow.on("close", () => {
    clearTimeout(saveTimer);
    saveWindowState(paths.windowStateFile, pendingState);
  });

  // --- Control server (focus / restart / open-external). Failure degrades:
  // --- lock gets controlPort 0, a later launch treats us as stale.
  let requestRestart: () => void = () => {};
  let control: ControlServer;
  try {
    control = startControlServer({
      onFocus: () => {
        if (mainWindow.isMinimized()) mainWindow.unminimize();
        mainWindow.activate();
      },
      onRestart: () => requestRestart(),
      onOpenExternal: (url) => {
        logger.log(`open external: ${url}`);
        Utils.openExternal(url);
      },
    });
  } catch (err) {
    logger.log(`control server failed to start: ${err instanceof Error ? err.message : err}`);
    control = { port: 0, token: "", stop: () => {} };
  }
  writeLock(lockFile, { pid: process.pid, controlPort: control.port, token: control.token });
  const restartUrl =
    control.port > 0
      ? `http://127.0.0.1:${control.port}/restart?token=${control.token}`
      : undefined;

  const setSplashStatus = (text: string) => {
    mainWindow.webview.executeJavascript(
      `window.__setSplashStatus && window.__setSplashStatus(${JSON.stringify(text)})`,
    );
  };

  const showError = (message: string) => {
    mainWindow.webview.loadHTML(errorPage(message, { logPath: logger.logPath, restartUrl }));
  };

  // --- Webview handlers, registered ONCE (BrowserView has no off(); a
  // --- restart must not stack duplicate handlers). startServer() updates
  // --- the mutable appOrigin/interceptorJs they read.
  let appOrigin = "";
  let interceptorJs = "";
  const inject = () => {
    if (interceptorJs) mainWindow.webview.executeJavascript(interceptorJs);
  };
  mainWindow.webview.on("did-navigate", inject);
  mainWindow.webview.on("dom-ready", inject);
  mainWindow.webview.on("will-navigate", (event: unknown) => {
    // Fallback only: will-navigate cannot cancel on Windows. If an external
    // URL slipped past the DOM interceptor, bounce back and open it outside.
    const detail = (event as { data?: { detail?: unknown } })?.data?.detail;
    if (!appOrigin || typeof detail !== "string") return;
    if (isExternalUrl(detail, appOrigin)) {
      logger.log(`external navigation bounced: ${detail}`);
      Utils.openExternal(detail);
      mainWindow.webview.loadURL(`${appOrigin}/`);
    }
  });

  // --- ConvertX lifecycle.
  let stopConvertX: (() => void) | undefined;
  let lastAutoRestartAt = 0;
  let starting = false;

  const cleanup = () => {
    stopConvertX?.();
    control.stop();
    removeLock(lockFile);
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });

  async function startServer(): Promise<void> {
    if (starting) return;
    starting = true;
    try {
      setSplashStatus("Starting the converter…");
      const vendorDir = pickVendorDir([
        // Packaged bundle: vendor/ baked next to the app by scripts/bundle-vendor.ts.
        join(PATHS.RESOURCES_FOLDER, "app", "vendor"),
        // Dev (`bun run dev`): electrobun runs the launcher with cwd = the
        // bundle's bin dir; reach the project root from Resources.
        join(PATHS.RESOURCES_FOLDER, "..", "..", "..", "..", "vendor"),
        // Supervisor run directly from the project root.
        join(process.cwd(), "vendor"),
      ]);
      const convertersDir = join(vendorDir, "converters", "win");

      const copyResult = ensureConvertxCopy(
        join(vendorDir, "convertx"),
        paths.convertxDir,
        join(vendorDir, VENDOR_MANIFEST_NAME),
        (stage) =>
          setSplashStatus(
            stage === "refresh"
              ? "Updating ConvertX… (your files are kept)"
              : "Preparing ConvertX (first run)…",
          ),
      );
      if (copyResult !== "unchanged") logger.log(`convertx copy: ${copyResult}`);

      const jwtSecret = loadJwtSecret(paths.jwtSecretFile);
      const port = await resolvePort();
      appOrigin = `http://127.0.0.1:${port}`;
      const url = `${appOrigin}/`;
      const shimFile = writeLoopbackShim(paths.appDataDir);

      let stderrTail = "";
      const env = buildConvertxEnv({
        port,
        jwtSecret,
        pathPrepend: converterPathEntries(convertersDir),
        autoDeleteHours: process.env.CONVERTX_DESKTOP_AUTO_DELETE_HOURS,
      });

      let rejectChildFailure: (err: Error) => void = () => {};
      const childFailure = new Promise<never>((_, reject) => {
        rejectChildFailure = reject;
      });

      setSplashStatus("Starting the converter…");
      const proc = startConvertX({
        bunPath: process.execPath,
        convertxDir: paths.convertxDir,
        env,
        preloadFile: shimFile,
        onStdout: (chunk) => {
          logger.log(`[convertx] ${chunk.trimEnd()}`);
          process.stdout.write(`[convertx] ${chunk}`);
        },
        onStderr: (chunk) => {
          stderrTail = (stderrTail + chunk).slice(-4000);
          logger.log(`[convertx:err] ${chunk.trimEnd()}`);
          process.stderr.write(`[convertx] ${chunk}`);
        },
        onError: (err) =>
          rejectChildFailure(new Error(`ConvertX failed to spawn: ${err.message}`)),
        onExit: (code) =>
          rejectChildFailure(new Error(`ConvertX exited with code ${code ?? "unknown"}`)),
      });
      stopConvertX = proc.stop;
      if (proc.pid !== undefined) updateLockChildPid(lockFile, proc.pid);

      try {
        await Promise.race([waitForHealth(url), childFailure]);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.log(`boot failed: ${message}`);
        showError(`${message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`);
        return;
      }

      interceptorJs = buildLinkInterceptorJs(control.port, control.token, appOrigin);
      mainWindow.webview.loadURL(url);
      logger.log(`ConvertX ready at ${url}`);
      console.log(`ConvertX ready at ${url}`);

      // Crash recovery: one silent auto-restart per cooldown window, then a
      // visible error page with the Restart button (user decision, spec §3.8).
      childFailure.catch((err: Error) => {
        stopConvertX = undefined;
        const now = Date.now();
        if (now - lastAutoRestartAt > AUTO_RESTART_COOLDOWN_MS) {
          lastAutoRestartAt = now;
          logger.log(`ConvertX died (${err.message}) — auto-restarting once`);
          mainWindow.webview.loadURL(SPLASH_URL);
          void startServer();
        } else {
          logger.log(`ConvertX died again within cooldown (${err.message}) — showing error page`);
          showError(
            `ConvertX stopped unexpectedly.\n${err.message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`,
          );
        }
      });
    } finally {
      starting = false;
    }
  }

  requestRestart = () => {
    logger.log("restart requested (error-page button)");
    stopConvertX?.();
    stopConvertX = undefined;
    mainWindow.webview.loadURL(SPLASH_URL);
    void startServer().catch((err) => {
      logger.log(`restart failed: ${err instanceof Error ? err.message : err}`);
      showError(err instanceof Error ? (err.stack ?? err.message) : String(err));
    });
  };

  await startServer().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    logger.log(`fatal boot error: ${message}`);
    console.error(message);
    showError(message);
  });
}

void main();
