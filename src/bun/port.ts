import { createServer } from "node:net";

/** Resolve to a currently-free loopback TCP port. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const { port } = address;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to acquire a port")));
      }
    });
  });
}

/**
 * Default ConvertX port. A stable port keeps the webview origin
 * (http://127.0.0.1:<port>) — and with it localStorage etc. — identical
 * across launches. Uncommon on purpose; when taken, resolvePort falls back
 * to a random free port (origin state is lost only in that rare case).
 */
export const PREFERRED_PORT = 17843;

/** True if `port` can be bound on loopback right now. */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.on("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** The preferred port if free, otherwise any free loopback port. */
export async function resolvePort(preferred = PREFERRED_PORT): Promise<number> {
  if (await isPortFree(preferred)) return preferred;
  return findFreePort();
}
