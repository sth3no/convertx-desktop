import type { ElectrobunConfig } from "electrobun";

const PROJECT_ROOT = import.meta.dir;

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
    bun: {
      entrypoint: "src/bun/index.ts",
      define: {
        "process.env.CONVERTX_PROJECT_ROOT": JSON.stringify(PROJECT_ROOT),
      },
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
