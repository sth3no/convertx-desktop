# ConvertX Desktop — Local Control API

The supervisor runs a loopback HTTP server (the "control server") that doubles
as a JSON API for building custom frontends. Everything the desktop shell can
do — update the app, install converter packs, change settings, read logs — is
reachable here. This document is the complete contract.

## Discovery

Every page loaded in the app window (the ConvertX UI at `http://127.0.0.1:<port>`)
gets a frozen global injected by the supervisor:

```js
window.__convertxDesktop = {
  controlBase: "http://127.0.0.1:54321", // control server base URL (port is random per run)
  token: "0b7c9d2e-…",                   // per-run API token
  version: "1.0.0",                      // app version
};
```

A frontend script running on the ConvertX page uses it directly:

```js
const { controlBase, token } = window.__convertxDesktop;
const api = (path, init) => {
  const sep = path.includes("?") ? "&" : "?";
  return fetch(`${controlBase}${path}${sep}token=${token}`, init).then(async (res) => {
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  });
};

// examples
const info = await api("/info");
await api("/packs/install?name=vips", { method: "POST" });
const packs = await api("/packs"); // poll while a pack installs
```

Outside the webview (scripts, tests), read `%APPDATA%\ConvertX-Electrobun\instance.json`
— it contains `controlPort` and `token` for the running instance.

## Conventions

- **Auth:** every request needs `?token=<token>`; a wrong/missing token → `403 {"error":"forbidden"}`.
- **CORS:** responses carry `Access-Control-Allow-Origin: <app origin>`, so the
  ConvertX page can read them. All requests are CORS "simple requests" (token in
  the query string, no custom headers needed).
- **Responses:** always JSON. Failures use proper status codes with `{"error": "..."}`.
- **Long operations** (update download, pack install) run in the background:
  the POST returns immediately and the frontend **polls the status endpoint**.

## Endpoints

### App

| Endpoint | Description |
|---|---|
| `GET /ping` | `{app: "convertx-desktop", pid}` — liveness + identity |
| `GET /info` | `{app, version, appOrigin, convertx: {status: "starting"\|"running"\|"error", port}, logPath}` |
| `POST /focus` | Raise/unminimize the window |
| `POST /restart` | Restart the embedded ConvertX server |
| `POST /open-external?url=<encoded>` | Open an `http(s)://`/`mailto:` URL in the system browser (`400` otherwise) |
| `POST /open-data-folder` | Reveal ConvertX's `data\` folder (uploads/outputs) in Explorer |
| `GET /logs/tail?lines=N` | `{lines: string[]}` — last N log lines (default 100, max 500) |

### Updates

| Endpoint | Description |
|---|---|
| `GET /update/status` | Current updater state (see the state machine below) |
| `POST /update/check` | Force a check now; returns the resulting state |
| `POST /update/download` | Download + verify the available update; returns the resulting state |
| `POST /update/apply` | Install the verified update, relaunch the app. `409 {"error"}` unless state is `ready` |

Updater state machine (`state` field):

```
idle → checking → up-to-date {checkedAt}
                → update-available {version, publishedAt, notesUrl, sizeBytes, checkedAt}
                    → downloading {version, received, total}   ← poll /update/status here
                    → verifying {version}
                    → ready {version, installerPath}
                    → installing {version}                      (app quits + reinstalls + relaunches)
any step can land in: error {message, at}                       (check again to retry)
```

Behavior by `updateMode` setting: `"auto"` (default) checks on launch + daily,
auto-downloads, and installs on quit when `ready`; `"notify"` stops at
`update-available` and the frontend drives `/update/download` + `/update/apply`.
`/update/apply` quits the app — warn the user first.

### Converter packs

| Endpoint | Description |
|---|---|
| `GET /packs` | Array of packs: registry fields (`name, title, description, version, sizeBytes, unlocks, …`) + `status` |
| `POST /packs/install?name=<name>` | `202 {"started": name}`; poll `GET /packs` for progress |
| `POST /packs/remove?name=<name>` | `202 {"started": name}`; poll `GET /packs` |

Pack `status`: `available` → `downloading {received, total}` → `verifying` →
`extracting` → `restarting` → `installed {version}`, or `error {message}`.
Installing/removing a pack **restarts the embedded ConvertX server** (a few
seconds; the splash shows) — confirm with the user if a conversion is running.
Downloads are pinned by sha256; a mismatch is discarded and reported as `error`.

### Settings

| Endpoint | Description |
|---|---|
| `GET /settings` | `{autoDeleteHours: number, updateMode: "auto"\|"notify"}` |
| `POST /settings` (JSON body) | Partial update; unknown/invalid fields are ignored; all-invalid → `400`. Returns `{settings, restarted}` |

`autoDeleteHours` (0 disables cleanup) applies to the ConvertX child, so
changing it restarts the embedded server (`restarted: true` in the response).

## Adding packs (maintainers)

`src/bun/pack-registry.ts` is pure data: pin an archive URL + sha256 + size +
the exe that must exist inside. Record hashes the same way the converter
manifest does (download once, `sha256sum`, verify the exe path with
`C:\Windows\System32\tar.exe -tf`). Heavyweights without official portable
archives (LibreOffice, Calibre, GraphicsMagick, Ghostscript) are future
entries here — the engine already handles any bsdtar-extractable archive.
