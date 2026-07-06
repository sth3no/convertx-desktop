/**
 * Poll ConvertX's GET /healthcheck until it returns HTTP 200 with
 * {"status":"ok"}, or reject after `timeoutMs`. Requiring the real endpoint
 * (instead of any HTTP response) means a foreign process squatting the port
 * can never pass as a healthy ConvertX.
 */
export async function waitForHealth(
  baseUrl: string,
  timeoutMs = 45_000,
  intervalMs = 250,
): Promise<void> {
  const healthUrl = new URL("healthcheck", baseUrl).toString();
  const deadline = Date.now() + timeoutMs;
  let lastError = "no response";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(healthUrl, { redirect: "manual" });
      if (res.status === 200) {
        const body = (await res.json().catch(() => undefined)) as { status?: string } | undefined;
        if (body?.status === "ok") return;
        lastError = "unexpected /healthcheck body";
      } else {
        lastError = `status ${res.status}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`Timed out waiting for ${healthUrl} after ${timeoutMs}ms (${lastError})`);
}
