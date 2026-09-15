# Backend deploy — operator path (judges / live demo)

**Audience:** whoever starts the VLM host for a demo (this laptop, a teammate laptop, a LAN box).  
**This doc is the operator deploy path.** Measured Ollama numbers and smoke curls live in [`SERVER_SETUP.md`](SERVER_SETUP.md). Judge click-path lives in [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md). Do not skip those; this file does not replace them.

**Working model on this repo:** `qwen2.5vl:7b` via Ollama on `:11434`, reached by the extension **only** through the Node gateway on `:8000`.

---

## Why the gateway exists (403)

Chrome extension pages and the service worker send `Origin: chrome-extension://<id>`. **Ollama rejects that origin with HTTP 403.** Direct popup/SW fetches to `http://localhost:11434/v1/chat/completions` fail even when `ollama serve` is healthy.

Lead log 2026-09-04 (GW-2): curl to `:8000` → 200; curl from the extension origin to `:11434` → 403. `OLLAMA_ORIGINS=*` on Ollama.app was **not** a reliable fix.

**Always point the extension at:**

```
http://localhost:8000/v1/chat/completions
```

Leave **API key empty** for local Ollama (the gateway forwards with no Bearer token unless `UPSTREAM_API_KEY` is set).

`src/popup/popup.js` already defaults the field to `:8000` and maps 403 to that URL. `src/background/background.js` installs `DEFAULT_GATEWAY_VLM` (`:8000`), rewrites stored `:11434` URLs, and retries 403 onto the gateway.

[`SERVER_SETUP.md`](SERVER_SETUP.md) still documents Ollama’s **upstream** URL (`http://localhost:11434/v1/chat/completions`) — that is correct for `curl` / `ollama` smoke tests from a terminal (no `chrome-extension://` origin). [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) still has a popup-defaults table listing `:11434`; treat that row as stale relative to current code — **operators use `:8000`**. The same runbook already starts the gateway with `cd server && node index.js`.

Do **not** run `npm run start:mock` for a judged demo (`/health` must show `"mock": false`).

---

## Architecture (one laptop)

```
Chrome extension  --POST-->  Node gateway :8000  --POST-->  Ollama :11434
   (sanitized image +             CORS *                    qwen2.5vl:7b
    page structure)               action JSON normalize
```

Gateway source: `server/index.js`. It implements OpenAI-compatible `POST /v1/chat/completions`, extracts a single valid action object (`click` / `type` / `scroll` / `navigate` / `done`), and rejects degenerate images (&lt;28 px on an axis) with `400` so qwen2.5vl cannot kill the Ollama runner.

---

## Prerequisites

| Piece | Check |
|---|---|
| Node.js | 18+ (`server/package.json` `engines`) |
| Ollama | `ollama serve` listening (typically `127.0.0.1:11434`) |
| Vision model | `ollama pull qwen2.5vl:7b` (~4.7 GB, measured in `SERVER_SETUP.md`) |

---

## Env vars (`server/index.js`)

All optional. Defaults are the demo-safe values.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8000` | Gateway listen port |
| `HOST` | `127.0.0.1` | Bind address. Set `0.0.0.0` so another device on the LAN can reach the gateway |
| `UPSTREAM_BASE_URL` | `http://localhost:11434/v1` | Ollama (or any OpenAI-compatible runtime) |
| `UPSTREAM_MODEL` | `qwen2.5vl:7b` | Used when the client omits `model` |
| `UPSTREAM_API_KEY` | empty | Bearer token for upstream only; leave empty for local Ollama |
| `REQUEST_TIMEOUT_MS` | `120000` | Upstream timeout |
| `MOCK` | unset | `MOCK=1` **or** argv `--mock` → deterministic fake actions, no Ollama |

`server/README.md` lists the same vars except `HOST` and `MOCK` (those exist in `index.js`). Prefer `index.js` as source of truth.

---

## Start sequence (macOS / Linux — this repo)

Terminal 1 — Ollama (if the desktop app is not already serving):

```bash
ollama serve
```

Terminal 2 — gateway (real model, not mock):

```bash
cd server
node index.js
# or: npm start
```

Expect a log line: host `127.0.0.1`, port `8000`, `mock: false`, upstream `http://localhost:11434/v1`, model `qwen2.5vl:7b`.

### LAN demo (second machine’s Chrome)

```bash
cd server
HOST=0.0.0.0 PORT=8000 node index.js
```

On the **browser** machine, set VLM Endpoint to `http://<host-LAN-IP>:8000/v1/chat/completions` (not `:11434`). API key still empty.

**Firewall:** the gateway port must be allowed inbound on the **host**. Windows helper prints:

```text
New-NetFirewallRule -DisplayName 'AEGIS' -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
```

On macOS, allow Node/Python incoming for that port if the client times out. Ollama can stay bound to localhost; only `:8000` needs to be reachable from the other device.

### Windows one-shot helper

`server/start-demo.ps1` / `start-demo.bat` set `HOST=0.0.0.0` and print the LAN IP. **Default `-Model` in that script is `qwen3-vl:8b`**, which is **not** the verified tag in this repo (`SERVER_SETUP.md`: qwen3-vl not in the Ollama registry as of 2026-08-28). For this tree pass:

```powershell
powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Model qwen2.5vl:7b
```

Or ignore the helper and run `node index.js` with the defaults above.

---

## Health check

```bash
curl -sS http://localhost:8000/health
```

Expect JSON like:

```json
{
  "status": "ok",
  "mock": false,
  "upstream": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5vl:7b" },
  "upstreamReachable": true
}
```

| Field | Demo requirement |
|---|---|
| `mock` | **`false`** |
| `upstreamReachable` | **`true`** (gateway could list Ollama `/v1/models`) |

Also available: `GET /v1/models` (proxied), `POST /v1/chat/completions` (main path). Successful completions add `X-Aegis-Latency-Ms`.

If `/health` is down, the extension cannot Run Agent / Fill via VLM. Privacy scan still works with no server (`DEMO_RUNBOOK.md` hero path).

---

## Pre-warm the model (before judges watch)

Cold first VLM request can be tens of seconds (`DEMO_RUNBOOK.md`: ~55 s on a 16 GB machine; `SERVER_SETUP.md` also records shorter cold text). Warm before the room sees the demo.

Via **Ollama** (no extension origin — this is allowed):

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5vl:7b","messages":[{"role":"user","content":"Say READY"}],"max_tokens":5,"temperature":0.1}'
```

Or:

```bash
ollama run qwen2.5vl:7b "Say READY"
ollama ps    # confirm the model stays loaded
```

Keep the gateway process up for the whole demo. If Ollama’s runner dies (`model runner has unexpectedly stopped`), restart Ollama, pre-warm again, then retry — see `DEMO_RUNBOOK.md` §6.

---

## Extension popup (operator checklist)

| Field | Value |
|---|---|
| VLM Endpoint | `http://localhost:8000/v1/chat/completions` |
| VLM Model | `qwen2.5vl:7b` |
| API key | **empty** |

For a LAN client, replace `localhost` with the host IP. Never point the extension at `:11434`.

Load the extension from **`dist/`** (`docs/EXTENSION_SIZE.md`, `DEMO_RUNBOOK.md`).

---

## Security notes (honest)

- The gateway is a **local demo process**, not a hardened public API. `Access-Control-Allow-Origin: *` is intentional so the extension can call it.
- Binding `HOST=0.0.0.0` exposes the OpenAI-compatible proxy on the LAN. Anyone who can reach `:8000` can spend GPU on your machine. Use only on a trusted network; close the port after the demo.
- The extension is supposed to send **sanitized** screenshots only. The gateway does not persist image bodies. It is not a second privacy enforcement point — the browser is (`docs/PRIVACY_DOC_UPLOAD.md`).
- `--mock` / `MOCK=1` is for pipeline rehearsal **without** a model. Judges should see `"mock": false`.

---

## Related

| Doc | Role |
|---|---|
| [`SERVER_SETUP.md`](SERVER_SETUP.md) | Ollama install, `qwen2.5vl:7b`, measured cold/warm latencies, terminal smoke tests against `:11434` |
| [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) | Chrome E2E on TP08, gateway start snippet, recovery codes |
| `server/README.md` | Package scripts + endpoint table |
| `server/index.js` | `PORT` / `HOST` / `UPSTREAM_*` / `MOCK` |
