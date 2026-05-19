import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "ConvertX",
    identifier: "dev.convertx.electrobun",
    version: "0.1.0",
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    // Keep the bundle as plain files (no app.asar) so vendor/ — copied in by
    // scripts/bundle-vendor.ts after the build — and the converter binaries
    // stay directly readable and executable.
    useAsar: false,
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    views: {
      mainview: {
        entrypoint: "src/mainview/index.ts",
      },
    },
    copy: {
      "src/mainview/index.html": "views/mainview/index.html",
      "src/mainview/index.css": "views/mainview/index.css",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
} satisfies ElectrobunConfig;
