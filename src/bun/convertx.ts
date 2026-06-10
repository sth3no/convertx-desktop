import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * A converters directory plus each of its immediate subdirectories (e.g. the
 * ImageMagick portable folder) — the entries to prepend to the ConvertX
 * child's PATH. Returns [] if the directory does not exist.
 */
export function converterPathEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const subdirs = readdirSync(dir)
    .map((entry) => join(dir, entry))
    .filter((path) => statSync(path).isDirectory());
  return [dir, ...subdirs];
}

export interface ConvertxEnvOptions {
  port: number;
  jwtSecret: string;
  /** Directories prepended to the child PATH (the bundled converters). */
  pathPrepend: string[];
  baseEnv?: Record<string, string | undefined>;
}

/**
 * Build the environment for the ConvertX child process. ConvertX runs in
 * its built-in unauthenticated mode (no login screen), with HTTP cookies
 * allowed (the server is plain http on loopback) and the bundled converter
 * binaries on PATH. NODE_ENV is set to production so ConvertX serves its
 * pre-built Tailwind CSS.
 */
export function buildConvertxEnv(opts: ConvertxEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(opts.baseEnv ?? process.env)) {
    if (typeof value === "string") env[key] = value;
  }

  // Windows env keys are case-insensitive but JS object keys are not — collapse
  // any PATH/Path/path variant into a single PATH.
  let currentPath = "";
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === "PATH") {
      currentPath = env[key]!;
      delete env[key];
    }
  }
  env.PATH = [...opts.pathPrepend, currentPath].filter(Boolean).join(delimiter);

  env.PORT = String(opts.port);
  env.JWT_SECRET = opts.jwtSecret;
  env.ALLOW_UNAUTHENTICATED = "true";
  env.UNAUTHENTICATED_USER_SHARING = "true";
  env.HTTP_ALLOWED = "true";
  env.NODE_ENV = "production";
  return env;
}

export interface StartOptions {
  /** Path to the bun executable to run ConvertX with (use process.execPath). */
  bunPath: string;
  /** Absolute path to the vendored ConvertX checkout. */
  convertxDir: string;
  env: Record<string, string>;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /**
   * Fires if the child cannot be spawned (e.g. the convertx copy vanished ->
   * ENOENT). Bun delivers spawn failures as an async 'error' event; without
   * this handler they escape the caller's try/catch and crash the supervisor.
   */
  onError?: (err: Error) => void;
  /**
   * Fires when ConvertX exits on its own (crash or clean exit). Never fires
   * for an exit caused by stop(), so shutdown does not look like a crash.
   */
  onExit?: (code: number | null) => void;
}

/**
 * Spawn ConvertX (`bun run src/index.tsx`) as a child process.
 *
 * stop() kills the whole process tree: on Windows a plain child.kill() only
 * terminates the direct bun process, and converter grandchildren (e.g. ffmpeg
 * mid-conversion) that escaped Bun's kill-on-close job object would survive
 * as orphans — taskkill /T walks the pid tree and reaps them too.
 */
export function startConvertX(opts: StartOptions): { stop: () => void } {
  const child = spawn(opts.bunPath, ["run", "src/index.tsx"], {
    cwd: opts.convertxDir,
    env: opts.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  if (opts.onStdout) child.stdout?.on("data", opts.onStdout);
  if (opts.onStderr) child.stderr?.on("data", opts.onStderr);
  if (opts.onError) child.on("error", opts.onError);

  let stopped = false;
  child.on("exit", (code) => {
    if (!stopped) opts.onExit?.(code);
  });
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (child.exitCode !== null) return; // already exited, nothing to kill
      if (process.platform === "win32" && child.pid !== undefined) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
      } else {
        child.kill();
      }
    },
  };
}
