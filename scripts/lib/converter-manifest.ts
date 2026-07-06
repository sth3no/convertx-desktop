import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Committed pin file: exact converter versions, URLs, and archive hashes. */
export const CONVERTER_MANIFEST_PATH = join(
  import.meta.dir.replace(/[\\/]scripts[\\/]lib$/, ""),
  "scripts",
  "converter-manifest.json",
);

export interface PinnedTool {
  name: string;
  /** Human-readable version (release tag or upstream version string). */
  version: string;
  /** Exact download URL the sha256 was recorded from. */
  url: string;
  /** Hex sha256 of the file at `url`. */
  sha256: string;
  /** "exe": the download is the binary. "zip": extract and find exeName. */
  kind: "exe" | "zip";
  exeName: string;
  /** If set, install the whole folder containing exeName as OUT_DIR/<dir>. */
  destSubdir?: string;
}

export interface ConverterManifest {
  tools: PinnedTool[];
}

export function validateConverterManifest(value: unknown): ConverterManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !Array.isArray((value as { tools?: unknown }).tools)
  ) {
    throw new Error("converter manifest: expected an object with a tools[] array");
  }
  const rawTools = (value as { tools: unknown[] }).tools;
  if (rawTools.length === 0) throw new Error("converter manifest: tools[] is empty");

  const tools = rawTools.map((raw, i): PinnedTool => {
    const t = raw as Record<string, unknown>;
    const at = `converter manifest tools[${i}]`;
    for (const field of ["name", "version", "url", "sha256", "kind", "exeName"] as const) {
      if (typeof t[field] !== "string" || t[field] === "") {
        throw new Error(`${at}: missing or empty "${field}"`);
      }
    }
    if (!/^[0-9a-f]{64}$/.test(t.sha256 as string)) {
      throw new Error(`${at}: sha256 must be a 64-char lowercase hex digest`);
    }
    if (t.kind !== "exe" && t.kind !== "zip") {
      throw new Error(`${at}: kind must be "exe" or "zip"`);
    }
    if (!(t.url as string).startsWith("https://")) {
      throw new Error(`${at}: url must be https`);
    }
    if (t.destSubdir !== undefined && (typeof t.destSubdir !== "string" || t.destSubdir === "")) {
      throw new Error(`${at}: destSubdir must be a non-empty string when present`);
    }
    return {
      name: t.name as string,
      version: t.version as string,
      url: t.url as string,
      sha256: t.sha256 as string,
      kind: t.kind,
      exeName: t.exeName as string,
      ...(t.destSubdir !== undefined ? { destSubdir: t.destSubdir as string } : {}),
    };
  });
  return { tools };
}

export async function loadConverterManifest(path: string): Promise<ConverterManifest> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(
      `No converter manifest at ${path}.\n` +
        `Run 'bun run scripts/fetch-converters.ts --record' once to resolve, hash, and pin the converters.`,
    );
  }
  return validateConverterManifest(await file.json());
}

export function saveConverterManifest(path: string, manifest: ConverterManifest): void {
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}
