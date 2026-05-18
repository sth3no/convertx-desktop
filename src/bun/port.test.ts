import { expect, test } from "bun:test";
import { createServer } from "node:net";
import { findFreePort } from "./port";

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
