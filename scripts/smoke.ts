import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildConvertxEnv, startConvertX } from "../src/bun/convertx";
import { waitForHealth } from "../src/bun/health";
import { ensureDataJunction, getAppPaths } from "../src/bun/paths";
import { findFreePort } from "../src/bun/port";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const CONVERTX_DIR = join(PROJECT_ROOT, "vendor", "convertx");
const CONVERTERS_DIR = join(PROJECT_ROOT, "vendor", "converters", "win");

// A minimal valid 1x1 PNG.
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=";

function converterPathEntries(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const subdirs = readdirSync(dir)
    .map((e) => join(dir, e))
    .filter((p) => statSync(p).isDirectory());
  return [dir, ...subdirs];
}

/** Parse a cookie value out of a set-cookie header list. */
function cookieValue(setCookies: string[], name: string): string {
  for (const sc of setCookies) {
    const match = sc.match(new RegExp(`^${name}=([^;]*)`));
    if (match) return match[1]!;
  }
  throw new Error(`Cookie '${name}' was not set by ConvertX`);
}

async function main(): Promise<void> {
  if (!existsSync(join(CONVERTX_DIR, "package.json"))) {
    throw new Error("ConvertX not vendored — run scripts/setup-convertx.ts first.");
  }

  const paths = getAppPaths();
  ensureDataJunction(join(CONVERTX_DIR, "data"), paths.dataDir);
  const port = await findFreePort();
  const base = `http://127.0.0.1:${port}`;

  const env = buildConvertxEnv({
    port,
    jwtSecret: randomUUID(),
    pathPrepend: converterPathEntries(CONVERTERS_DIR),
  });
  const proc = startConvertX({
    bunPath: process.execPath,
    convertxDir: CONVERTX_DIR,
    env,
    onStderr: (c) => process.stderr.write(`[convertx] ${c}`),
  });

  try {
    await waitForHealth(`${base}/`, 45_000);

    // 1. GET / -> ConvertX mints the auth + jobId cookies (no login screen).
    const root = await fetch(`${base}/`, { redirect: "manual" });
    if (root.status !== 200) {
      throw new Error(`GET / returned ${root.status}, expected 200 (no-login mode)`);
    }
    const setCookies = root.headers.getSetCookie();
    const auth = cookieValue(setCookies, "auth");
    const jobId = cookieValue(setCookies, "jobId");
    const cookie = `auth=${auth}; jobId=${jobId}`;
    console.log(`Session established (jobId=${jobId}).`);

    // 2. POST /upload — send a 1x1 PNG.
    const png = Buffer.from(PNG_1X1_BASE64, "base64");
    const uploadForm = new FormData();
    uploadForm.append("file", new File([png], "test.png", { type: "image/png" }));
    const upload = await fetch(`${base}/upload`, {
      method: "POST",
      headers: { cookie },
      body: uploadForm,
    });
    if (!upload.ok) throw new Error(`POST /upload returned ${upload.status}`);
    console.log("Uploaded test.png.");

    // 3. POST /convert — PNG -> JPG via ImageMagick (runs in the background).
    const convertForm = new FormData();
    convertForm.append("convert_to", "jpg,imagemagick");
    convertForm.append("file_names", JSON.stringify(["test.png"]));
    const convert = await fetch(`${base}/convert`, {
      method: "POST",
      headers: { cookie },
      body: convertForm,
      redirect: "manual",
    });
    if (convert.status !== 302) {
      throw new Error(`POST /convert returned ${convert.status}, expected 302`);
    }
    console.log("Conversion requested.");

    // 4. Poll the output directory (UNAUTHENTICATED_USER_SHARING -> user id 0).
    //    Match any non-empty file — ConvertX may name it test.jpg or test.jpeg.
    const outDir = join(paths.dataDir, "output", "0", jobId);
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (existsSync(outDir)) {
        const produced = readdirSync(outDir).filter((name) => {
          const s = statSync(join(outDir, name));
          return s.isFile() && s.size > 0;
        });
        if (produced.length > 0) {
          console.log(`\nSMOKE TEST PASSED — produced ${join(outDir, produced[0]!)}`);
          return;
        }
      }
      await Bun.sleep(300);
    }
    throw new Error(`Timed out waiting for output in: ${outDir}`);
  } finally {
    proc.stop();
  }
}

main().catch((err) => {
  console.error(`\nSMOKE TEST FAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
