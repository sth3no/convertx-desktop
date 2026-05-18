/**
 * Poll `url` until it returns any HTTP response, or reject after `timeoutMs`.
 * A redirect (e.g. 302) counts as healthy — it means the server is serving.
 */
export async function waitForHealth(
  url: string,
  timeoutMs = 45_000,
  intervalMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${url} after ${timeoutMs}ms (${lastError})`);
}
