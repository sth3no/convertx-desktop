import { spawn } from "node:child_process";
import { delimiter } from "node:path";

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
 * binaries on PATH. NODE_ENV is cleared so ConvertX generates its Tailwind
 * CSS at runtime — no build step is needed.
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
  delete env.NODE_ENV;
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
}

/** Spawn ConvertX (`bun run src/index.tsx`) as a child process. */
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

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      child.kill();
    },
  };
}
