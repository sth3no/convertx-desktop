# Tray Icon + Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.
> **Suitability:** well-specified single-feature work — suited to Opus-class execution. All API facts below were verified against Electrobun 1.18.1 sources + the Windows DLL symbol table during the 2026-07 research passes; do not re-derive them.

**Goal:** A system-tray icon with a menu: Open ConvertX (focus), Open output folder, Check for updates, Restart converter, Quit. No close-to-tray behavior (window close still quits — `runtime.exitOnLastWindowClosed` stays true).

**Verified API facts (Electrobun 1.18.1, Windows):**
- `import { Tray } from "electrobun/bun"` — class `Tray` (dist/api/bun/core/Tray.ts); constructor takes `{ image?: string, title?: string, template?: boolean, width?, height? }`; methods `setMenu(menuItems)`, `on("tray-clicked", handler)`. All tray FFI symbols (createTray/setTrayMenu/setTrayTitle/setTrayImage) are present in `dist-win-x64/libNativeWrapper.dll`.
- Menu items follow the ApplicationMenu shape: `{ label: string, action: string }`, dividers `{ type: "divider" }`; the menu fires the `tray-item-clicked` event with `event.data.action` (check `node_modules/electrobun/dist/api/bun/core/Tray.ts` and `events/trayEvents.ts` for the exact event name/payload before wiring — this is the ONE thing to confirm empirically, via a dev run with a console.log handler).
- `Utils.openPath(path)` opens a folder in Explorer (verified working).
- The icon file: use `assets/icon.png` — Electrobun copies nothing automatically; add the PNG to `electrobun.config.ts` `build.copy` (e.g. `"assets/icon.png": "views/tray-icon.png"`) and reference it via the `views` path in the bundle (`join(PATHS.VIEWS_FOLDER, "tray-icon.png")`). Verify the copied file exists in `build/dev-win-x64/ConvertX-dev/Resources/app/views/` after `bun run build`.

**Files:**
- Create: `src/bun/tray.ts` + `src/bun/tray.test.ts` (menu-model only; Tray construction is not unit-testable — FFI)
- Modify: `src/bun/index.ts` (wire), `electrobun.config.ts` (copy icon)

---

### Task 1: Menu model (pure, testable)

- [ ] `src/bun/tray.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { buildTrayMenu, type TrayActions } from "./tray";

test("menu lists the five actions and dispatch routes to the right handler", () => {
  const calls: string[] = [];
  const actions: TrayActions = {
    focus: () => calls.push("focus"),
    openOutputFolder: () => calls.push("output"),
    checkForUpdates: () => calls.push("update"),
    restartConverter: () => calls.push("restart"),
    quit: () => calls.push("quit"),
  };
  const menu = buildTrayMenu();
  const labels = menu.filter((m) => "label" in m).map((m) => (m as { label: string }).label);
  expect(labels).toEqual([
    "Open ConvertX",
    "Open output folder",
    "Check for updates",
    "Restart converter",
    "Quit ConvertX",
  ]);
  for (const action of ["focus", "open-output", "check-updates", "restart", "quit"]) {
    dispatchTrayAction(action, actions);
  }
  expect(calls).toEqual(["focus", "output", "update", "restart", "quit"]);
});
```

(import `dispatchTrayAction` too.)

- [ ] `src/bun/tray.ts`:

```typescript
export interface TrayActions {
  focus: () => void;
  openOutputFolder: () => void;
  checkForUpdates: () => void;
  restartConverter: () => void;
  quit: () => void;
}

export type TrayMenuItem = { label: string; action: string } | { type: "divider" };

/** Menu model, separated from the FFI Tray object so it stays testable. */
export function buildTrayMenu(): TrayMenuItem[] {
  return [
    { label: "Open ConvertX", action: "focus" },
    { type: "divider" },
    { label: "Open output folder", action: "open-output" },
    { label: "Check for updates", action: "check-updates" },
    { label: "Restart converter", action: "restart" },
    { type: "divider" },
    { label: "Quit ConvertX", action: "quit" },
  ];
}

export function dispatchTrayAction(action: string, actions: TrayActions): void {
  switch (action) {
    case "focus": return actions.focus();
    case "open-output": return actions.openOutputFolder();
    case "check-updates": return actions.checkForUpdates();
    case "restart": return actions.restartConverter();
    case "quit": return actions.quit();
  }
}
```

(Adjust the test's expected labels to include dividers-filtered list as shown.) Run test → green → commit `feat: tray menu model`.

### Task 2: Wire the Tray in index.ts

- [ ] `electrobun.config.ts` `build.copy` gains `"assets/icon.png": "views/tray-icon.png"`.
- [ ] In `src/bun/index.ts` (after the engines, before routes — it uses the same handlers):

```typescript
  try {
    const tray = new Tray({ image: join(PATHS.VIEWS_FOLDER, "tray-icon.png") });
    tray.setMenu(buildTrayMenu() as never); // cast if Electrobun's item type differs
    tray.on("tray-item-clicked", (event: unknown) => {
      const action = (event as { data?: { action?: string } })?.data?.action ?? "";
      dispatchTrayAction(action, {
        focus: () => {
          if (mainWindow.isMinimized()) mainWindow.unminimize();
          mainWindow.activate();
        },
        openOutputFolder: () => {
          const dataDir = join(paths.convertxDir, "data");
          mkdirSync(dataDir, { recursive: true });
          Utils.openPath(dataDir);
        },
        checkForUpdates: () => void updater.check().then(() => {
          if (settings.updateMode === "auto" && updater.status().state === "update-available") {
            void updater.download();
          }
        }),
        restartConverter: () => restartConvertx("tray menu"),
        quit: () => {
          cleanup();
          process.exit(0);
        },
      });
    });
  } catch (err) {
    logger.log(`tray unavailable: ${err instanceof Error ? err.message : err}`);
  }
```

Confirm the exact event name (`tray-item-clicked` vs `tray-clicked`) and item shape from `node_modules/electrobun/dist/api/bun/core/Tray.ts` FIRST and adapt.
- [ ] Verify: `bun x tsc --noEmit`, `bun run test`, then `bun run dev` — tray icon appears, each menu item works (click through all five). `bun run package && bun run scripts/verify-packaged.ts` still passes.
- [ ] Commit `feat: system tray with app menu`. Update README (Architecture paragraph mentions the tray) in the same commit.
