/**
 * External = a web URL on a different origin than the local ConvertX server,
 * or a mailto:. Everything else (relative paths, views:// splash, about:blank
 * from loadHTML error pages, javascript:) is internal — misclassifying those
 * as external would bounce the webview in a loop.
 */
export function isExternalUrl(url: string, appOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return parsed.origin !== appOrigin;
  }
  return parsed.protocol === "mailto:";
}

/**
 * Click interceptor injected into every ConvertX page (will-navigate cannot
 * cancel navigation on Windows — Phase 1 spec §2). Capture-phase listener:
 * external anchor clicks are prevented and forwarded to the supervisor's
 * control server, which opens them in the system browser. The POST is a CORS
 * "simple request", so it reaches the (different-origin) control server even
 * though the page can't read the response — hence mode: "no-cors".
 * Idempotent via window.__cxLinkGuard: safe to re-inject on every navigation.
 */
export function buildLinkInterceptorJs(
  controlPort: number,
  token: string,
  appOrigin: string,
): string {
  const controlBase = JSON.stringify(`http://127.0.0.1:${controlPort}`);
  const origin = JSON.stringify(appOrigin);
  const tok = JSON.stringify(token);
  return [
    "(() => {",
    "  if (window.__cxLinkGuard) return;",
    "  window.__cxLinkGuard = true;",
    `  const appOrigin = ${origin};`,
    `  const controlBase = ${controlBase};`,
    `  const token = ${tok};`,
    "  document.addEventListener('click', (ev) => {",
    "    const target = ev.target instanceof Element ? ev.target.closest('a[href]') : null;",
    "    if (!target) return;",
    "    const href = target.href;",
    "    let external = false;",
    "    try {",
    "      const u = new URL(href, location.href);",
    "      if (u.protocol === 'http:' || u.protocol === 'https:') {",
    "        external = u.origin !== appOrigin;",
    "      } else {",
    "        external = u.protocol === 'mailto:';",
    "      }",
    "    } catch { return; }",
    "    if (!external) return;",
    "    ev.preventDefault();",
    "    ev.stopPropagation();",
    "    fetch(controlBase + '/open-external?token=' + encodeURIComponent(token) +",
    "      '&url=' + encodeURIComponent(href), { method: 'POST', mode: 'no-cors' })",
    "      .catch(() => {});",
    "  }, true);",
    "})();",
  ].join("\n");
}
