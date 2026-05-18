import { expect, test } from "bun:test";
import { waitForHealth } from "./health";

test("waitForHealth resolves once the server responds", async () => {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  try {
    await waitForHealth(`http://127.0.0.1:${server.port}/`, 5_000, 50);
  } finally {
    server.stop(true);
  }
});

test("waitForHealth rejects when nothing responds before the timeout", async () => {
  // Nothing is listening on port 1 — fetch fails fast and the poll loop expires.
  await expect(waitForHealth("http://127.0.0.1:1/", 600, 100)).rejects.toThrow(
    /Timed out/,
  );
});
