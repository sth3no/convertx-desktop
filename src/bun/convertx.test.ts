import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { buildConvertxEnv, startConvertX } from "./convertx";

/** process.env narrowed to string values, as startConvertX's env requires. */
function testEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

/**
 * Make a throwaway convertxDir whose src/index.tsx has the given body —
 * startConvertX always runs "bun run src/index.tsx" relative to convertxDir,
 * so this is the seam for simulating ConvertX child behavior.
 */
function makeFakeConvertxDir(indexTsxBody: string): string {
  const dir = mkdtempSync(join(tmpdir(), "convertx-test-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src", "index.tsx"), indexTsxBody, "utf8");
  return dir;
}

test("buildConvertxEnv sets the no-login desktop env and prepends converters", () => {
  const env = buildConvertxEnv({
    port: 4321,
    jwtSecret: "secret-abc",
    pathPrepend: ["C:\\conv", "C:\\conv\\imagemagick"],
    baseEnv: { Path: "C:\\Windows", NODE_ENV: "production" },
  });
  expect(env.PORT).toBe("4321");
  expect(env.JWT_SECRET).toBe("secret-abc");
  expect(env.ALLOW_UNAUTHENTICATED).toBe("true");
  expect(env.UNAUTHENTICATED_USER_SHARING).toBe("true");
  expect(env.HTTP_ALLOWED).toBe("true");
  expect(env.NODE_ENV).toBe("production");
  expect(env.Path).toBeUndefined();
  expect(env.PATH).toBe(
    `C:\\conv${delimiter}C:\\conv\\imagemagick${delimiter}C:\\Windows`,
  );
});

test("buildConvertxEnv works when the base env has no PATH at all", () => {
  const env = buildConvertxEnv({
    port: 1,
    jwtSecret: "s",
    pathPrepend: ["X:\\conv"],
    baseEnv: {},
  });
  expect(env.PATH).toBe("X:\\conv");
});

test("startConvertX fires onError when the bun executable cannot be spawned", async () => {
  const dir = makeFakeConvertxDir("// never runs\n");
  try {
    const err = await new Promise<Error>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("onError did not fire within 10s")),
        10_000,
      );
      startConvertX({
        bunPath: "C:\\nonexistent\\bun.exe",
        convertxDir: dir,
        env: testEnv(),
        onError: (e) => {
          clearTimeout(timer);
          resolve(e);
        },
      });
    });
    expect(err).toBeInstanceOf(Error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 15_000);

test("startConvertX fires onExit with the child's exit code", async () => {
  const dir = makeFakeConvertxDir("process.exit(7);\n");
  try {
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("onExit did not fire within 15s")),
        15_000,
      );
      startConvertX({
        bunPath: process.execPath,
        convertxDir: dir,
        env: testEnv(),
        onExit: (c) => {
          clearTimeout(timer);
          resolve(c);
        },
      });
    });
    expect(code).toBe(7);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("startConvertX does not fire onExit when stop() caused the exit", async () => {
  const dir = makeFakeConvertxDir("await Bun.sleep(60_000);\n");
  try {
    let exitFired = false;
    const proc = startConvertX({
      bunPath: process.execPath,
      convertxDir: dir,
      env: testEnv(),
      onExit: () => {
        exitFired = true;
      },
    });
    // Let the child actually start before killing it.
    await Bun.sleep(1_000);
    proc.stop();
    // Give the exit event a beat to (incorrectly) fire.
    await Bun.sleep(1_500);
    expect(exitFired).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 20_000);

test("stop() kills converter grandchildren, not just the direct child", async () => {
  // The fake ConvertX spawns a long-lived grandchild (stand-in for ffmpeg
  // mid-conversion) and prints its pid so the test can probe it after stop().
  // The grandchild is detached so it escapes Bun's kill-on-close job object —
  // the case where a plain child.kill() leaves an orphan behind.
  const dir = makeFakeConvertxDir(
    [
      "import { spawn } from \"node:child_process\";",
      "const grandchild = spawn(process.execPath, [\"-e\", \"setTimeout(() => {}, 60000)\"], { detached: true, stdio: \"ignore\" });",
      "console.log(`GRANDCHILD_PID:${grandchild.pid}`);",
      "await Bun.sleep(60_000);",
      "",
    ].join("\n"),
  );
  let grandchildPid: number | undefined;
  let proc: { stop: () => void } | undefined;
  try {
    grandchildPid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("grandchild pid not seen on stdout within 15s")),
        15_000,
      );
      let buffered = "";
      proc = startConvertX({
        bunPath: process.execPath,
        convertxDir: dir,
        env: testEnv(),
        onStdout: (chunk) => {
          buffered += chunk;
          const match = buffered.match(/GRANDCHILD_PID:(\d+)/);
          if (match) {
            clearTimeout(timer);
            resolve(Number(match[1]));
          }
        },
      });
    });
    proc!.stop();
    await Bun.sleep(1_000);
    // process.kill(pid, 0) probes for existence: it throws once the
    // grandchild is gone, and succeeds if it survived as an orphan.
    let orphanAlive = true;
    try {
      process.kill(grandchildPid, 0);
    } catch {
      orphanAlive = false;
    }
    if (orphanAlive) {
      // Don't leak a 60s orphan when the assertion below fails; it also holds
      // the temp dir as its cwd, which would block the rmSync cleanup.
      try {
        process.kill(grandchildPid);
      } catch {}
      await Bun.sleep(500);
    }
    expect(orphanAlive).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 30_000);
