import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { findFreePort, PREFERRED_PORT, resolvePort } from "./port";

test("findFreePort returns a port that can be bound", async () => {
  const port = await findFreePort();
  expect(port).toBeGreaterThan(0);
  expect(port).toBeLessThan(65536);

  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });
});

test("findFreePort returns distinct ports for concurrent calls", async () => {
  const ports = await Promise.all([findFreePort(), findFreePort(), findFreePort()]);
  expect(new Set(ports).size).toBe(3);
});

test("resolvePort returns the preferred port when it is free", async () => {
  // Use a random free port as the "preferred" one so the test can't collide
  // with a real service on the machine.
  const preferred = await findFreePort();
  expect(await resolvePort(preferred)).toBe(preferred);
});

test("resolvePort falls back to another free port when preferred is taken", async () => {
  const preferred = await findFreePort();
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(preferred, "127.0.0.1", resolve));
  try {
    const port = await resolvePort(preferred);
    expect(port).not.toBe(preferred);
    expect(port).toBeGreaterThan(0);
  } finally {
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
  }
});

test("PREFERRED_PORT is a sane user-space port", () => {
  expect(PREFERRED_PORT).toBeGreaterThan(1024);
  expect(PREFERRED_PORT).toBeLessThan(65536);
});
