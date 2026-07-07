# Settings Passthroughs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.
> **Suitability:** mechanical extension of an existing pattern — ideal Opus-class work.

**Goal:** Expose ConvertX's remaining useful env knobs through the settings store + API: `maxConvertProcess` (→ `MAX_CONVERT_PROCESS`, 0 = unlimited), `ffmpegArgs` (→ `FFMPEG_ARGS`), `ffmpegOutputArgs` (→ `FFMPEG_OUTPUT_ARGS`), `language` (→ `LANGUAGE`, BCP-47 string), `hideHistory` (→ `HIDE_HISTORY`, boolean). All verified upstream env vars (ConvertX v0.17.0 `src/helpers/env.ts`).

**Pattern to follow exactly:** how `autoDeleteHours` flows today — `src/bun/settings.ts` (type + default + sanitize) → `src/bun/convertx.ts` `buildConvertxEnv` (env assignment) → `src/bun/index.ts` (pass from settings; any change to these keys restarts the child, same as `autoDeleteHours`) → `docs/API.md` settings table.

**Defaults:** `maxConvertProcess: 0`, `ffmpegArgs: ""`, `ffmpegOutputArgs: ""`, `language: "en"`, `hideHistory: false`. Sanitize: numbers ≥ 0 integer; strings ≤ 500 chars; booleans strict. Empty-string ffmpeg args → do NOT set the env var at all (upstream splits on whitespace; an empty var is safe but skip it for cleanliness).

---

- [ ] **Task 1 (TDD):** extend `src/bun/settings.test.ts` (new fields round-trip, sanitize rejects wrong types/negative/oversized) → extend `Settings`/`DEFAULT_SETTINGS`/`sanitizeSettings`.
- [ ] **Task 2 (TDD):** extend `src/bun/convertx.test.ts` (env carries the new vars; empty ffmpeg args omitted) → `ConvertxEnvOptions` gains the fields; `buildConvertxEnv` sets `MAX_CONVERT_PROCESS`, `LANGUAGE`, `HIDE_HISTORY` always, `FFMPEG_ARGS`/`FFMPEG_OUTPUT_ARGS` only when non-empty.
- [ ] **Task 3:** `index.ts`: pass the values in `buildConvertxEnv({...})`; in the `POST /settings` route, `needsRestart` becomes: any of the child-affecting keys changed (all five new ones + `autoDeleteHours`) — i.e. `needsRestart = Object.keys(patch).some((k) => k !== "updateMode")`.
- [ ] **Task 4:** `docs/API.md` settings section: new table of fields, defaults, and which trigger a restart. Full suite + smoke + commit `feat: settings passthroughs for concurrency, ffmpeg args, language, history`.
