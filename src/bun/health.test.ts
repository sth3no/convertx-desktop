import { expect, test } from "bun:test";
import { waitForHealth } from "./health";

test("waitForHealth resolves once /healthcheck returns {status:'ok'}", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: (req) =>
      new URL(req.url).pathname === "/healthcheck"
        ? Response.json({ status: "ok" })
        : new Response("nope", { status: 404 }),
  });
  try {
    await waitForHealth(`http://127.0.0.1:${server.port}/`, 5_000, 50);
  } finally {
    server.stop(true);
  }
});

test("waitForHealth rejects when nothing responds before the timeout", async () => {
  await expect(waitForHealth("http://127.0.0.1:1/", 600, 100)).rejects.toThrow(/Timed out/);
});

test("waitForHealth does not accept a port squatter (wrong body)", async () => {
  // A foreign server that answers 200 with the wrong payload must not pass.
  const squatter = Bun.serve({ port: 0, fetch: () => new Response("totally fine") });
  try {
    await expect(
      waitForHealth(`http://127.0.0.1:${squatter.port}/`, 600, 100),
    ).rejects.toThrow(/Timed out/);
  } finally {
    squatter.stop(true);
  }
});
