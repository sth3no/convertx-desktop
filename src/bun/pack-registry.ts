export interface PackDef {
  name: string;
  title: string;
  description: string;
  version: string;
  /** Exact download URL the sha256 was recorded from. */
  url: string;
  sha256: string;
  sizeBytes: number;
  /**
   * "zip": any archive the system bsdtar reads (zip/7z).
   * "msi-admin": a Windows Installer package extracted via
   * `msiexec /a <msi> TARGETDIR=<dir> /qn` (no elevation, no install —
   * empirically verified for LibreOffice, 2026-07-07).
   */
  kind: "zip" | "msi-admin";
  /** File that must exist after extraction; its dir joins the child PATH. */
  exeName: string;
  /**
   * Relative paths deleted after extraction — e.g. LibreOffice's online
   * updater, which otherwise REWRITES the extracted tree in place (verified),
   * and the stub MSI msiexec leaves in TARGETDIR.
   */
  scrubEntries?: string[];
  /**
   * Relative copies applied after extraction (cpSync recursive — dirs merge).
   * E.g. LibreOffice needs System64's VC++ runtime DLLs next to soffice.
   */
  copyAfter?: { from: string; to: string }[];
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
    name: "libreoffice",
    title: "LibreOffice (office documents)",
    description:
      "Convert Word/Excel/PowerPoint, OpenDocument, and dozens of other office formats.",
    version: "25.8.7",
    // Permanent archive (never redirects, keeps every version); the 4-part
    // dir is the release's final RC. Companion .msi.sha256 published upstream.
    url: "https://downloadarchive.documentfoundation.org/libreoffice/old/25.8.7.1/win/x86_64/LibreOffice_25.8.7.1_Win_x86-64.msi",
    sha256: "0a1b054ba1d565d3de3c16b2f5245c0cd336f7d86c21723cc1b85df7c4a911aa",
    sizeBytes: 366235648,
    kind: "msi-admin",
    exeName: "soffice.com",
    // The TDF online updater would REWRITE the extracted tree in place
    // (breaking hash-pinned state and silently blocking headless conversions
    // while staging — empirically verified 2026-07-07). Scrub it.
    scrubEntries: ["update-settings.ini", "program/updater.exe"],
    // VC++ runtime DLLs land in System64\, not next to soffice — copy them in
    // so machines without the redist still run it.
    copyAfter: [{ from: "System64", to: "program" }],
    unlocks: "~41 office input formats (docx, xlsx, pptx, odt, …) via LibreOffice",
  },
  {
    name: "inkscape",
    title: "Inkscape (vector graphics)",
    description: "Convert EMF/WMF and other vector formats; SVG editing pipeline.",
    version: "1.4.4",
    // inkscape.org media URL — the random suffix is upstream's; the full URL
    // is pinned and stable per release, but NOT predictable for future
    // versions (re-record on bump).
    url: "https://media.inkscape.org/dl/resources/file/inkscape-1.4.4_2026-05-05_dcaf3e7-x64_mHK170m.7z",
    sha256: "c4dbd64a92628abe7d7316c43f9325396e4d48417866027ee3d993d4f5b54c6a",
    sizeBytes: 110359970,
    kind: "zip",
    exeName: "inkscape.com",
    unlocks: "EMF/WMF and 15+ other vector formats via Inkscape",
  },
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
