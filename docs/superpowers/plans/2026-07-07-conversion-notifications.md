# Conversion-Complete Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox syntax.
> **Suitability:** Opus-class execution. The detection design below is settled — implement it, don't redesign it.

**Goal:** A Windows notification ("Conversion finished — N file(s) ready") when ConvertX completes a conversion **while the window is not focused**. Clicking cannot deep-link (Electrobun notifications are fire-and-forget on Windows — verified); the tray/window is the affordance.

**Settled design (from the 2026-07 research):**
- ConvertX's results page (`/results/...`) polls `GET /progress/<jobId>` every 1 s from `public/results.js`. The reliable, zero-patch completion signal is **DOM-side**: inject a watcher (same mechanism as the link guard in `src/bun/linkguard.ts` — idempotent, re-injected on `did-navigate`/`dom-ready`) that wraps `window.fetch`; when a `/progress/` response arrives where every file row is finished (the JSON lists files with status fields — inspect one live response via the dev app to confirm the exact shape before coding the predicate), and the previous poll was NOT all-finished, POST `controlBase + "/notify-conversion-done?token=...&files=N"` with `mode: "no-cors"`.
- Supervisor side: a new control route `POST /notify-conversion-done` calls `Utils.showNotification({ title: "ConvertX", body: `Conversion finished — ${n} file(s) ready` })` **only when the window is unfocused**. Track focus with `mainWindow.on("focus"/"blur")` events (verified to exist) updating a `windowFocused` boolean in `index.ts`.
- Debounce: at most one notification per jobId (the watcher sends once per transition to all-finished; keep a `notifiedJobs` Set in the injected script).

**Files:**
- Create: `src/bun/notify-watch.ts` (`buildConversionWatcherJs(controlPort, token)`) + test (string-assertions like `linkguard.test.ts`)
- Modify: `src/bun/index.ts` (inject alongside the interceptor; focus tracking; route)
- Modify: `docs/API.md` (document `/notify-conversion-done` as shell-internal)

---

- [ ] **Task 1:** Inspect a live `/progress/<jobId>` response: `bun run dev`, upload + convert a PNG (see `scripts/smoke.ts` for the exact HTTP flow), capture the JSON. Write the all-finished predicate against the real field names in a comment at the top of `notify-watch.ts`.
- [ ] **Task 2 (TDD):** `buildConversionWatcherJs` — same pattern as `buildLinkInterceptorJs`: embeds controlBase/token via `JSON.stringify`, `window.__cxNotifyWatch` idempotence guard, wraps `window.fetch`, clones responses for `/progress/` URLs (`res.clone().json()`), tracks per-job previous state + notified set, fires the POST on the not-finished→finished transition. Test: string contains guard/endpoint/no raw `${` holes.
- [ ] **Task 3:** Wire in `index.ts`: `windowFocused` boolean via focus/blur handlers (register once, next to the existing webview handlers); append the watcher JS to the injection (`inject()` runs both scripts); add the route:

```typescript
    {
      method: "POST",
      path: "/notify-conversion-done",
      handler: (req) => {
        const n = Math.max(1, Number(req.query.get("files")) || 1);
        if (!windowFocused) {
          Utils.showNotification({ title: "ConvertX", body: `Conversion finished — ${n} file(s) ready` });
        }
        return { body: { ok: true, notified: !windowFocused } };
      },
    },
```

- [ ] **Task 4:** Verify: full suite + smoke; `bun run dev` → minimize the window → run a conversion → notification appears; focused window → no notification. Commit `feat: notify on conversion completion when unfocused`.
