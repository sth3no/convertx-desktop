import { readFileSync, writeFileSync } from "node:fs";

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

/** Subset of Electrobun's Display we depend on (Screen.getAllDisplays()). */
export interface DisplayLike {
  workArea: { x: number; y: number; width: number; height: number };
}

export const DEFAULT_STATE: WindowState = {
  x: 150,
  y: 100,
  width: 1100,
  height: 800,
  maximized: false,
};

export function loadWindowState(file: string): WindowState {
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    if (
      typeof raw.x === "number" &&
      typeof raw.y === "number" &&
      typeof raw.width === "number" &&
      typeof raw.height === "number" &&
      typeof raw.maximized === "boolean" &&
      raw.width > 0 &&
      raw.height > 0
    ) {
      return {
        x: raw.x,
        y: raw.y,
        width: raw.width,
        height: raw.height,
        maximized: raw.maximized,
      };
    }
  } catch {
    // missing/corrupt file -> default
  }
  return { ...DEFAULT_STATE };
}

export function saveWindowState(file: string, state: WindowState): void {
  try {
    writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
  } catch {
    // persistence is best-effort
  }
}

/**
 * Keep a saved frame only if its title-bar strip (top 30px) still overlaps a
 * display's work area by a grabbable amount (>=50x15 px) — otherwise the
 * window could restore off-screen with no way to drag it back. Also shrink
 * frames larger than the biggest work area. Zeroed/empty display info means
 * "no information" (Electrobun returns that when native lookup fails) — fall
 * back to the default frame rather than clamping to 0x0.
 */
export function clampToDisplays(state: WindowState, displays: DisplayLike[]): WindowState {
  const usable = displays.filter((d) => d.workArea.width > 0 && d.workArea.height > 0);
  if (usable.length === 0) return { ...DEFAULT_STATE, maximized: state.maximized };

  const strip = { x: state.x, y: state.y, width: state.width, height: 30 };
  const grabbable = usable.some((d) => {
    const a = d.workArea;
    const overlapW = Math.min(strip.x + strip.width, a.x + a.width) - Math.max(strip.x, a.x);
    const overlapH = Math.min(strip.y + strip.height, a.y + a.height) - Math.max(strip.y, a.y);
    return overlapW >= 50 && overlapH >= 15;
  });
  if (!grabbable) return { ...DEFAULT_STATE, maximized: state.maximized };

  const maxW = Math.max(...usable.map((d) => d.workArea.width));
  const maxH = Math.max(...usable.map((d) => d.workArea.height));
  return {
    ...state,
    width: Math.min(state.width, maxW),
    height: Math.min(state.height, maxH),
  };
}
