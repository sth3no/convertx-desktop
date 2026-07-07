import { afterEach, expect, test } from "bun:test";
import { CONTROL_APP_ID, startControlServer, type ControlServer } from "./control";

let server: ControlServer | undefined;
afterEach(() => {
  server?.stop();
  server = undefined;
});

function calls() {
  const seen: string[] = [];
  return {
    seen,
    handlers: {
      onFocus: () => seen.push("focus"),
      onRestart: () => seen.push("restart"),
      onOpenExternal: (url: string) => seen.push(`open:${url}`),
    },
  };
}

test("ping identifies the app and pid; endpoints dispatch to handlers", async () => {
  const { seen, handlers } = calls();
  server = startControlServer({ handlers });
  const base = `http://127.0.0.1:${server.port}`;

  const ping = await fetch(`${base}/ping?token=${server.token}`);
  expect(ping.status).toBe(200);
  expect(await ping.json()).toEqual({ app: CONTROL_APP_ID, pid: process.pid });

  expect((await fetch(`${base}/focus?token=${server.token}`, { method: "POST" })).status).toBe(200);
  expect((await fetch(`${base}/restart?token=${server.token}`, { method: "POST" })).status).toBe(200);
  const url = encodeURIComponent("https://example.com/page");
  expect(
    (await fetch(`${base}/open-external?token=${server.token}&url=${url}`, { method: "POST" }))
      .status,
  ).toBe(200);
  expect(seen).toEqual(["focus", "restart", "open:https://example.com/page"]);
});

test("requests without the correct token are rejected and never dispatched", async () => {
  const { seen, handlers } = calls();
  server = startControlServer({ handlers });
  const base = `http://127.0.0.1:${server.port}`;
  expect((await fetch(`${base}/ping`)).status).toBe(403);
  expect((await fetch(`${base}/focus?token=wrong`, { method: "POST" })).status).toBe(403);
  expect(seen).toEqual([]);
});

test("open-external rejects non-web URLs; GET on POST endpoints is a 404", async () => {
  const { seen, handlers } = calls();
  server = startControlServer({ handlers });
  const base = `http://127.0.0.1:${server.port}`;
  const bad = encodeURIComponent("file:///C:/Windows/system32");
  expect(
    (await fetch(`${base}/open-external?token=${server.token}&url=${bad}`, { method: "POST" }))
      .status,
  ).toBe(400);
  expect((await fetch(`${base}/focus?token=${server.token}`)).status).toBe(404);
  expect(seen).toEqual([]);
});

test("routes dispatch, JSON bodies parse, errors map to JSON, CORS headers set", async () => {
  const { handlers } = calls();
  server = startControlServer({
    handlers,
    getCorsOrigin: () => "http://127.0.0.1:17843",
    routes: [
      { method: "GET", path: "/echo", handler: (req) => ({ body: { q: req.query.get("x") } }) },
      {
        method: "POST",
        path: "/double",
        handler: async (req) => {
          const body = (await req.json()) as { n?: number };
          if (typeof body.n !== "number") return { status: 400, body: { error: "n required" } };
          return { body: { doubled: body.n * 2 } };
        },
      },
      {
        method: "GET",
        path: "/boom",
        handler: () => {
          throw new Error("kaboom");
        },
      },
    ],
  });
  const base = `http://127.0.0.1:${server.port}`;
  const t = `token=${server.token}`;

  const echo = await fetch(`${base}/echo?${t}&x=hi`);
  expect(echo.status).toBe(200);
  expect(echo.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:17843");
  expect(await echo.json()).toEqual({ q: "hi" });

  const doubled = await fetch(`${base}/double?${t}`, {
    method: "POST",
    body: JSON.stringify({ n: 21 }),
  });
  expect(await doubled.json()).toEqual({ doubled: 42 });
  expect((await fetch(`${base}/double?${t}`, { method: "POST", body: "junk" })).status).toBe(400);

  const boom = await fetch(`${base}/boom?${t}`);
  expect(boom.status).toBe(500);
  expect(((await boom.json()) as { error: string }).error).toContain("kaboom");

  const preflight = await fetch(`${base}/echo`, { method: "OPTIONS" });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get("access-control-allow-methods")).toContain("POST");
});
