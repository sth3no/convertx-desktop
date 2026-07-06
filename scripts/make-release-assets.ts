import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import pkg from "../package.json";
import { sha256OfFile } from "./lib/checksums";

const PROJECT_ROOT = import.meta.dir.replace(/[\\/]scripts$/, "");
const DIST_DIR = join(PROJECT_ROOT, "dist");
const MANIFEST_FILE = join(PROJECT_ROOT, "vendor", "vendor-manifest.json");

interface VendorManifest {
  bun: string;
  convertx: { repo: string; ref: string; version: string };
  converters: { name: string; version: string; url: string; sha256: string }[];
}

const artifacts = [
  join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-Setup.exe`),
  join(DIST_DIR, `ConvertX-Desktop-${pkg.version}-win-x64-portable.zip`),
];
for (const file of artifacts) {
  if (!existsSync(file)) {
    console.error(`Missing artifact: ${file} — run the installer/portable scripts first.`);
    process.exit(1);
  }
}
if (!existsSync(MANIFEST_FILE)) {
  console.error(`Missing ${MANIFEST_FILE} — run 'bun run setup' first.`);
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8")) as VendorManifest;

let sums = "";
for (const file of artifacts) {
  sums += `${await sha256OfFile(file)}  ${basename(file)}\n`;
}
writeFileSync(join(DIST_DIR, "SHA256SUMS.txt"), sums);

const upstream = manifest.convertx.repo.replace(/\.git$/, "");
const notes = `## ConvertX Desktop ${pkg.version}

A standalone Windows 11 desktop app for converting files — no Docker, no account, works offline.

### Install

- **Installer (recommended):** download \`ConvertX-Desktop-${pkg.version}-Setup.exe\` and run it.
  Installs per-user (no admin rights), adds a Start-menu shortcut, uninstalls from Windows Settings.
- **Portable:** download the zip, extract it into an empty folder, run \`bin\\launcher.exe\`.

> **SmartScreen note:** these binaries are not yet code-signed. Windows shows
> "Windows protected your PC" on first run — click **More info → Run anyway**.
> Verify downloads against \`SHA256SUMS.txt\`.

### What's inside

| Component | Version |
|---|---|
| ConvertX (AGPL-3.0) | ${manifest.convertx.version} ([source](${upstream}/tree/${manifest.convertx.ref})) |
${manifest.converters.map((c) => `| ${c.name} | ${c.version} |`).join("\n")}

This release redistributes [ConvertX](${upstream}) **unmodified** under the GNU AGPL-3.0; the
bundled copy's exact source is the commit linked above. This repository (the desktop shell) is
likewise AGPL-3.0.

Converted files and history are kept for 7 days by default. User data lives in
\`%APPDATA%\\ConvertX-Electrobun\` and survives updates and uninstalls.
`;
writeFileSync(join(DIST_DIR, "RELEASE-NOTES.md"), notes);
console.log("Wrote SHA256SUMS.txt and RELEASE-NOTES.md");
