import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { VENDOR_MANIFEST_NAME } from "../src/shared/vendor-spec";
import {
  CONVERTER_MANIFEST_PATH,
  loadConverterManifest,
  type ConverterManifest,
} from "./lib/converter-manifest";
import { CONVERTX_REF, CONVERTX_REPO } from "./lib/pins";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");

export interface VendorManifest {
  schema: 1;
  bun: string;
  convertx: { repo: string; ref: string; version: string };
  converters: { name: string; version: string; url: string; sha256: string }[];
}

/**
 * Pure assembly — deliberately no timestamps or machine-specific fields, so
 * identical pins produce byte-identical manifests (release reproducibility,
 * master plan Phase 0 "done when").
 */
export function buildVendorManifest(input: {
  bunVersion: string;
  convertxVersion: string;
  converters: ConverterManifest;
}): VendorManifest {
  return {
    schema: 1,
    bun: input.bunVersion,
    convertx: { repo: CONVERTX_REPO, ref: CONVERTX_REF, version: input.convertxVersion },
    converters: input.converters.tools.map(({ name, version, url, sha256 }) => ({
      name,
      version,
      url,
      sha256,
    })),
  };
}

if (import.meta.main) {
  const bunVersion = readFileSync(join(PROJECT_ROOT, ".bun-version"), "utf8").trim();
  const convertxVersion = (
    JSON.parse(readFileSync(join(PROJECT_ROOT, "vendor", "convertx", "package.json"), "utf8")) as {
      version: string;
    }
  ).version;
  const converters = await loadConverterManifest(CONVERTER_MANIFEST_PATH);
  const manifest = buildVendorManifest({ bunVersion, convertxVersion, converters });
  const dest = join(PROJECT_ROOT, "vendor", VENDOR_MANIFEST_NAME);
  writeFileSync(dest, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Wrote ${dest}`);
}
