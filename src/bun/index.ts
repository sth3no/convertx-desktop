import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, PATHS, Screen, Utils } from "electrobun/bun";
import pkg from "../../package.json";
import { VENDOR_MANIFEST_NAME } from "../shared/vendor-spec";
import { ensureConvertxCopy, pickVendorDir } from "./bundle";
import { startControlServer, type ControlServer, type Route } from "./control";
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
import { PACK_REGISTRY } from "./pack-registry";
import { createPackManager } from "./packs";
import { getAppPaths } from "./paths";
import { resolvePort } from "./port";
import {
  DEFAULT_SETTINGS,
  loadSettingsFile,
  sanitizeSettings,
  saveSettings,
  type Settings,
} from "./settings";
import { createUpdater } from "./updater";
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

  // --- Settings (retention precedence: settings file > env override > default).
  const loadedSettings = loadSettingsFile(paths.settingsFile);
  let settings: Settings = loadedSettings.settings;
  let settingsDirty = false;
  const envHours = Number(process.env.CONVERTX_DESKTOP_AUTO_DELETE_HOURS);
  const effectiveAutoDeleteHours = () =>
    loadedSettings.fromFile || settingsDirty
      ? settings.autoDeleteHours
      : Number.isFinite(envHours) && envHours >= 0
        ? envHours
        : DEFAULT_SETTINGS.autoDeleteHours;

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

  const setSplashStatus = (text: string) => {
    mainWindow.webview.executeJavascript(
      `window.__setSplashStatus && window.__setSplashStatus(${JSON.stringify(text)})`,
    );
  };

  // restartUrl is known only after the control server starts; showError reads
  // it at call time.
  let restartUrl: string | undefined;
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
  let convertxState: "starting" | "running" | "error" = "starting";
  let requestRestart: () => void = () => {};

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

  const restartConvertx = (reason: string) => {
    logger.log(`convertx restart: ${reason}`);
    stopConvertX?.();
    stopConvertX = undefined;
    mainWindow.webview.loadURL(SPLASH_URL);
    void startServer().catch((err) => {
      logger.log(`restart failed: ${err instanceof Error ? err.message : err}`);
      showError(err instanceof Error ? (err.stack ?? err.message) : String(err));
    });
  };
  requestRestart = () => restartConvertx("error-page button");

  // --- Engines.
  const packs = createPackManager({
    packsDir: paths.packsDir,
    registry: PACK_REGISTRY,
    log: logger.log,
    restartConvertx,
  });

  const updater = createUpdater({
    currentVersion: pkg.version,
    repo: "sth3no/convertx-desktop",
    updatesDir: paths.updatesDir,
    installedLauncher: join(
      process.env.LOCALAPPDATA ?? "",
      "Programs",
      "ConvertX Desktop",
      "bin",
      "launcher.exe",
    ),
    log: logger.log,
    quitApp: () => {
      cleanup();
      process.exit(0);
    },
  });

  // --- API routes (contract: docs/API.md — keep the shapes in sync).
  const routes: Route[] = [
    {
      method: "GET",
      path: "/info",
      handler: () => ({
        body: {
          app: "convertx-desktop",
          version: pkg.version,
          appOrigin,
          convertx: {
            status: convertxState,
            port: appOrigin ? Number(new URL(appOrigin).port) : 0,
          },
          logPath: logger.logPath,
        },
      }),
    },
    { method: "GET", path: "/update/status", handler: () => ({ body: updater.status() }) },
    { method: "POST", path: "/update/check", handler: async () => ({ body: await updater.check() }) },
    {
      method: "POST",
      path: "/update/download",
      handler: async () => ({ body: await updater.download() }),
    },
    {
      method: "POST",
      path: "/update/apply",
      handler: async () => {
        const result = await updater.apply();
        return result.ok ? { body: { ok: true } } : { status: 409, body: { error: result.error } };
      },
    },
    { method: "GET", path: "/packs", handler: () => ({ body: packs.list() }) },
    {
      method: "POST",
      path: "/packs/install",
      handler: (req) => {
        const name = req.query.get("name") ?? "";
        void packs.install(name); // async; the frontend polls GET /packs
        return { status: 202, body: { started: name } };
      },
    },
    {
      method: "POST",
      path: "/packs/remove",
      handler: (req) => {
        const name = req.query.get("name") ?? "";
        void packs.remove(name);
        return { status: 202, body: { started: name } };
      },
    },
    { method: "GET", path: "/settings", handler: () => ({ body: settings }) },
    {
      method: "POST",
      path: "/settings",
      handler: async (req) => {
        const patch = sanitizeSettings(await req.json());
        if (Object.keys(patch).length === 0) {
          return { status: 400, body: { error: "no valid settings in body" } };
        }
        settings = { ...settings, ...patch };
        settingsDirty = true;
        saveSettings(paths.settingsFile, settings);
        const needsRestart = patch.autoDeleteHours !== undefined;
        if (needsRestart) restartConvertx("settings changed");
        return { body: { settings, restarted: needsRestart } };
      },
    },
    {
      method: "POST",
      path: "/open-data-folder",
      handler: () => {
        const dataDir = join(paths.convertxDir, "data");
        mkdirSync(dataDir, { recursive: true });
        Utils.openPath(dataDir);
        return { body: { ok: true } };
      },
    },
    {
      method: "GET",
      path: "/logs/tail",
      handler: (req) => {
        const lines = Math.min(Number(req.query.get("lines")) || 100, 500);
        let text = "";
        try {
          text = readFileSync(logger.logPath, "utf8");
        } catch {
          // no log yet
        }
        const all = text.trimEnd().split("\n");
        return { body: { lines: all.slice(-lines) } };
      },
    },
  ];

  // --- Control server (focus / restart / open-external + the API routes).
  // --- Failure degrades: lock gets controlPort 0, later launches treat us
  // --- as stale.
  let control: ControlServer;
  try {
    control = startControlServer({
      handlers: {
        onFocus: () => {
          if (mainWindow.isMinimized()) mainWindow.unminimize();
          mainWindow.activate();
        },
        onRestart: () => requestRestart(),
        onOpenExternal: (url) => {
          logger.log(`open external: ${url}`);
          Utils.openExternal(url);
        },
      },
      routes,
      getCorsOrigin: () => appOrigin,
    });
  } catch (err) {
    logger.log(`control server failed to start: ${err instanceof Error ? err.message : err}`);
    control = { port: 0, token: "", stop: () => {} };
  }
  writeLock(lockFile, { pid: process.pid, controlPort: control.port, token: control.token });
  restartUrl =
    control.port > 0
      ? `http://127.0.0.1:${control.port}/restart?token=${control.token}`
      : undefined;

  // Install a downloaded-and-verified update when the user quits (auto mode).
  mainWindow.on("close", () => {
    if (settings.updateMode === "auto" && updater.hasReadyUpdate()) {
      logger.log("installing downloaded update on quit");
      updater.applyOnQuit();
    }
  });

  async function startServer(): Promise<void> {
    if (starting) return;
    starting = true;
    try {
      convertxState = "starting";
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
        pathPrepend: [...converterPathEntries(convertersDir), ...packs.installedPathEntries()],
        autoDeleteHours: String(effectiveAutoDeleteHours()),
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
        convertxState = "error";
        logger.log(`boot failed: ${message}`);
        showError(`${message}\n\n--- ConvertX stderr ---\n${stderrTail || "(none)"}`);
        return;
      }

      interceptorJs = buildLinkInterceptorJs(control.port, control.token, appOrigin, pkg.version);
      mainWindow.webview.loadURL(url);
      convertxState = "running";
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
          convertxState = "error";
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

  await startServer().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    convertxState = "error";
    logger.log(`fatal boot error: ${message}`);
    console.error(message);
    showError(message);
  });

  // Update checks start only after the first boot attempt, so a broken
  // ConvertX never races an update download.
  updater.start(() => settings.updateMode);
}

void main();
