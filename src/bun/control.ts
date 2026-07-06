import { randomUUID } from "node:crypto";

export const CONTROL_APP_ID = "convertx-desktop";

export interface ControlHandlers {
  onFocus: () => void;
  onRestart: () => void;
  onOpenExternal: (url: string) => void;
}

export interface ControlServer {
  port: number;
  token: string;
  stop: () => void;
}

/**
 * Loopback control server — the supervisor's command channel. Consumers:
 * a second app instance (/ping to verify the lock owner is really us —
 * immune to PID reuse — and /focus to raise the window), the error page's
 * Restart button (/restart), and the injected link interceptor
 * (/open-external). Every endpoint requires the per-run token.
 */
export function startControlServer(handlers: ControlHandlers): ControlServer {
  const token = randomUUID();
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.searchParams.get("token") !== token) {
        return new Response("forbidden", { status: 403 });
      }
      if (url.pathname === "/ping" && req.method === "GET") {
        return Response.json({ app: CONTROL_APP_ID, pid: process.pid });
      }
      if (url.pathname === "/focus" && req.method === "POST") {
        handlers.onFocus();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/restart" && req.method === "POST") {
        handlers.onRestart();
        return Response.json({ ok: true });
      }
      if (url.pathname === "/open-external" && req.method === "POST") {
        const target = url.searchParams.get("url") ?? "";
        if (!/^(https?:\/\/|mailto:)/i.test(target)) {
          return new Response("bad url", { status: 400 });
        }
        handlers.onOpenExternal(target);
        return Response.json({ ok: true });
      }
      return new Response("not found", { status: 404 });
    },
  });
  return { port: server.port, token, stop: () => server.stop(true) };
}
