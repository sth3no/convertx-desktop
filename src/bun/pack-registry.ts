export interface PackDef {
  name: string;
  title: string;
  description: string;
  version: string;
  /** Exact download URL the sha256 was recorded from. */
  url: string;
  sha256: string;
  sizeBytes: number;
  /** Archive extractable by system bsdtar (zip/7z). */
  kind: "zip";
  /** File that must exist after extraction; its dir joins the child PATH. */
  exeName: string;
  /** What the pack unlocks, for frontend display. */
  unlocks: string;
}

/**
 * Optional converter packs — pinned URL + sha256, the same supply-chain
 * discipline as scripts/converter-manifest.json. Adding heavier packs later
 * (LibreOffice, Calibre — no official portable archives today) is a pure
 * data change here plus a hash recording; see docs/API.md "Adding packs".
 * Pins recorded 2026-07-07.
 */
export const PACK_REGISTRY: PackDef[] = [
  {
    name: "vips",
    title: "libvips (fast image processing)",
    description:
      "High-speed image conversion for large images, with loaders for many extra formats (the 'all' build).",
    version: "8.18.4",
    url: "https://github.com/libvips/build-win64-mxe/releases/download/v8.18.4/vips-dev-x64-all-8.18.4.zip",
    sha256: "95a56455ac525c9cb64865804322bbacad07021ded8ec49327fa3e392b91935b",
    sizeBytes: 19684611,
    kind: "zip",
    exeName: "vips.exe",
    unlocks: "~45 additional input formats via the vips backend",
  },
  {
    name: "libjxl",
    title: "JPEG XL tools",
    description: "Encode and decode JPEG XL (.jxl) images.",
    version: "0.12.0",
    url: "https://github.com/libjxl/libjxl/releases/download/v0.12.0/jxl-x64-windows-static.zip",
    sha256: "3025d7e308390796d20492322e606bc92decaee7b6bc99d3f7547870ae5db7de",
    sizeBytes: 40492043,
    kind: "zip",
    exeName: "cjxl.exe",
    unlocks: "JPEG XL encode/decode (cjxl, djxl)",
  },
];
