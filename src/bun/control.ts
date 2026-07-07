import { randomUUID } from "node:crypto";

export const CONTROL_APP_ID = "convertx-desktop";

export interface ControlHandlers {
  onFocus: () => void;
  onRestart: () => void;
  onOpenExternal: (url: string) => void;
}

export interface RouteRequest {
  query: URLSearchParams;
  /** Parses the JSON body; returns {} for an empty or invalid body. */
  json: () => Promise<unknown>;
}

export interface RouteResult {
  status?: number;
  body: unknown;
}

export interface Route {
  method: "GET" | "POST";
  path: string;
  handler: (req: RouteRequest) => RouteResult | Promise<RouteResult>;
}

export interface ControlServerOptions {
  handlers: ControlHandlers;
  /** Engine endpoints (update/packs/settings/info/...). */
  routes?: Route[];
  /** The webview app origin, once known — enables readable CORS responses. */
  getCorsOrigin?: () => string;
}

export interface ControlServer {
  port: number;
  token: string;
  stop: () => void;
}

/**
 * Loopback control server — the app's local JSON API. Token-authed (query
 * param, per-run random), CORS-enabled for the ConvertX webview origin so a
 * frontend running there can read responses. Built-in endpoints (/ping,
 * /focus, /restart, /open-external) keep their Phase 1 shapes; engines add
 * routes. The full frontend contract lives in docs/API.md.
 */
export function startControlServer(options: ControlServerOptions): ControlServer {
  const { handlers, routes = [], getCorsOrigin } = options;
  const token = randomUUID();

  const corsHeaders = (): Record<string, string> => {
    const origin = getCorsOrigin?.() ?? "";
    return origin ? { "access-control-allow-origin": origin, vary: "Origin" } : {};
  };
  const json = (body: unknown, status = 200): Response =>
    Response.json(body, { status, headers: corsHeaders() });

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (req.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: {
            ...corsHeaders(),
            "access-control-allow-methods": "GET, POST, OPTIONS",
            "access-control-allow-headers": "content-type",
          },
        });
      }
      if (url.searchParams.get("token") !== token) {
        return json({ error: "forbidden" }, 403);
      }

      // Built-in endpoints (shapes relied on by instance.ts and the injected
      // link interceptor — do not change).
      if (url.pathname === "/ping" && req.method === "GET") {
        return json({ app: CONTROL_APP_ID, pid: process.pid });
      }
      if (url.pathname === "/focus" && req.method === "POST") {
        handlers.onFocus();
        return json({ ok: true });
      }
      if (url.pathname === "/restart" && req.method === "POST") {
        handlers.onRestart();
        return json({ ok: true });
      }
      if (url.pathname === "/open-external" && req.method === "POST") {
        const target = url.searchParams.get("url") ?? "";
        if (!/^(https?:\/\/|mailto:)/i.test(target)) {
          return json({ error: "bad url" }, 400);
        }
        handlers.onOpenExternal(target);
        return json({ ok: true });
      }

      const route = routes.find((r) => r.path === url.pathname && r.method === req.method);
      if (!route) return json({ error: "not found" }, 404);
      try {
        const result = await route.handler({
          query: url.searchParams,
          json: async () => {
            try {
              return await req.json();
            } catch {
              return {};
            }
          },
        });
        return json(result.body, result.status ?? 200);
      } catch (err) {
        return json({ error: err instanceof Error ? err.message : String(err) }, 500);
      }
    },
  });
  const port = server.port;
  if (port === undefined) {
    // Only possible for unix-socket servers per Bun's types; treat as failure
    // so the caller degrades gracefully.
    server.stop(true);
    throw new Error("control server bound without a TCP port");
  }
  return { port, token, stop: () => server.stop(true) };
}
