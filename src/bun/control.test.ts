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
  server = startControlServer(handlers);
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
  server = startControlServer(handlers);
  const base = `http://127.0.0.1:${server.port}`;
  expect((await fetch(`${base}/ping`)).status).toBe(403);
  expect((await fetch(`${base}/focus?token=wrong`, { method: "POST" })).status).toBe(403);
  expect(seen).toEqual([]);
});

test("open-external rejects non-web URLs; GET on POST endpoints is a 404", async () => {
  const { seen, handlers } = calls();
  server = startControlServer(handlers);
  const base = `http://127.0.0.1:${server.port}`;
  const bad = encodeURIComponent("file:///C:/Windows/system32");
  expect(
    (await fetch(`${base}/open-external?token=${server.token}&url=${bad}`, { method: "POST" }))
      .status,
  ).toBe(400);
  expect((await fetch(`${base}/focus?token=${server.token}`)).status).toBe(404);
  expect(seen).toEqual([]);
});
