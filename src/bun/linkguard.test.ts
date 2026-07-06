import { expect, test } from "bun:test";
import { buildLinkInterceptorJs, isExternalUrl } from "./linkguard";

const ORIGIN = "http://127.0.0.1:17843";

test("isExternalUrl classifies app, external, and scheme URLs", () => {
  expect(isExternalUrl("http://127.0.0.1:17843/results/3", ORIGIN)).toBe(false);
  expect(isExternalUrl("http://127.0.0.1:9999/", ORIGIN)).toBe(true);
  expect(isExternalUrl("https://github.com/C4illin/ConvertX", ORIGIN)).toBe(true);
  expect(isExternalUrl("mailto:someone@example.com", ORIGIN)).toBe(true);
  // Non-web schemes the shell itself produces are internal — never bounce
  // the webview for them (views:// splash, about:blank from loadHTML).
  expect(isExternalUrl("views://mainview/index.html", ORIGIN)).toBe(false);
  expect(isExternalUrl("about:blank", ORIGIN)).toBe(false);
  expect(isExternalUrl("javascript:void(0)", ORIGIN)).toBe(false);
  // Relative/invalid -> internal (never bounce).
  expect(isExternalUrl("/download/3", ORIGIN)).toBe(false);
  expect(isExternalUrl("not a url", ORIGIN)).toBe(false);
});

test("buildLinkInterceptorJs embeds origin, control endpoint, and idempotence guard", () => {
  const js = buildLinkInterceptorJs(54321, "tok-123", ORIGIN);
  expect(js).toContain('"http://127.0.0.1:54321"');
  expect(js).toContain("tok-123");
  expect(js).toContain(JSON.stringify(ORIGIN));
  expect(js).toContain("__cxLinkGuard");
  expect(js).toContain("open-external");
  // Values are JSON-embedded, not concatenated — no raw template holes left.
  expect(js).not.toContain("${");
});
