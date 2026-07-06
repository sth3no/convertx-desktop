import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clampToDisplays,
  DEFAULT_STATE,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from "./window-state";

const PRIMARY = { workArea: { x: 0, y: 0, width: 1920, height: 1032 } };
const LEFT_SECONDARY = { workArea: { x: -1920, y: 0, width: 1920, height: 1032 } };

test("save + load round-trips", () => {
  const file = join(mkdtempSync(join(tmpdir(), "cx-ws-")), "window-state.json");
  const state: WindowState = { x: 10, y: 20, width: 900, height: 700, maximized: true };
  saveWindowState(file, state);
  expect(loadWindowState(file)).toEqual(state);
});

test("load returns the default when the file is missing or invalid", () => {
  const dir = mkdtempSync(join(tmpdir(), "cx-wsbad-"));
  expect(loadWindowState(join(dir, "missing.json"))).toEqual(DEFAULT_STATE);
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  expect(loadWindowState(bad)).toEqual(DEFAULT_STATE);
  const wrongShape = join(dir, "shape.json");
  writeFileSync(wrongShape, JSON.stringify({ x: "left", width: 100 }));
  expect(loadWindowState(wrongShape)).toEqual(DEFAULT_STATE);
});

test("clamp keeps a frame that is on a display (including negative-x monitors)", () => {
  const onSecondary: WindowState = { x: -1800, y: 50, width: 800, height: 600, maximized: false };
  expect(clampToDisplays(onSecondary, [PRIMARY, LEFT_SECONDARY])).toEqual(onSecondary);
});

test("clamp falls back to the default frame when the title bar is off every display", () => {
  const lost: WindowState = { x: 5000, y: 5000, width: 800, height: 600, maximized: true };
  const clamped = clampToDisplays(lost, [PRIMARY]);
  expect(clamped).toEqual({ ...DEFAULT_STATE, maximized: true });
});

test("clamp falls back to the default when display info is empty or zeroed", () => {
  const state: WindowState = { x: 10, y: 10, width: 800, height: 600, maximized: false };
  expect(clampToDisplays(state, [])).toEqual({ ...DEFAULT_STATE, maximized: false });
  expect(
    clampToDisplays(state, [{ workArea: { x: 0, y: 0, width: 0, height: 0 } }]),
  ).toEqual({ ...DEFAULT_STATE, maximized: false });
});

test("clamp shrinks a frame larger than the biggest work area", () => {
  const huge: WindowState = { x: 0, y: 0, width: 4000, height: 3000, maximized: false };
  const clamped = clampToDisplays(huge, [PRIMARY]);
  expect(clamped.width).toBe(1920);
  expect(clamped.height).toBe(1032);
});
