# Aegis Backend

Local VLM gateway for the Aegis extension. Runs on the operator's laptop — no
cloud needed for development. It implements the VLM contract from
`docs/02_ARCHITECTURE.md` (section 4) as an OpenAI-compatible HTTP API.

## What it does

- Exposes `POST /v1/chat/completions` on `http://localhost:8000` — the exact
  endpoint the extension's service worker already calls.
- Forwards requests to a local VLM runtime (Ollama, LM Studio, llama.cpp
  server, vLLM — anything OpenAI-compatible).
- **Normalizes the VLM's reply**: extracts the first valid action object from
  whatever the model produced (raw JSON, markdown fences, prose-wrapped) and
  rewrites `choices[0].message.content` to a single clean action JSON. The
  extension's `JSON.parse` then always succeeds.
- Validates actions against the contract (`click`, `type`, `scroll`,
  `navigate`, `done`) and rejects malformed ones.
- Adds CORS (so the extension popup can call it too) and a
  `X-Aegis-Latency-Ms` header for E2E latency measurement (Phase 5 metrics).
- `--mock` mode answers with deterministic actions without any model —
  useful for testing the extension pipeline end-to-end.

## Quick start

```powershell
# Test the extension pipeline without a VLM installed
npm run start:mock

# Real mode (requires Ollama running with a vision model pulled)
npm start
```

## One-shot demo start (for the friend's laptop / clean machine)

```powershell
# checks Node + Ollama, pulls qwen3-vl:8b if missing, starts HOST=0.0.0.0,
# prints the LAN IP, /health URLs and the firewall rule to allow inbound 8000
powershell -ExecutionPolicy Bypass -File start-demo.ps1

# model-free fallback for a rehearsal / no-network demo
powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Mock

# double-click friendly wrapper:  start-demo.bat   |   start-demo.bat mock
```

Flags: `-Mock`, `-Port <int>` (default 8000), `-Model <name>` (default `qwen3-vl:8b`).

Configuration via env vars (all optional):

| Var                  | Default                     | Purpose                          |
| -------------------- | --------------------------- | -------------------------------- |
| `PORT`               | `8000`                      | Listen port                      |
| `UPSTREAM_BASE_URL`  | `http://localhost:11434/v1` | VLM runtime (Ollama default)     |
| `UPSTREAM_MODEL`     | `qwen2.5vl:7b`              | Model id if the client omits one |
| `UPSTREAM_API_KEY`   | (empty)                     | Bearer token, if upstream needs  |
| `REQUEST_TIMEOUT_MS` | `120000`                    | Upstream call timeout            |

## Endpoints

| Route                     | Method | Description                              |
| ------------------------- | ------ | ---------------------------------------- |
| `/health`                 | GET    | Status + upstream reachability           |
| `/v1/models`              | GET    | Proxied model list                       |
| `/v1/chat/completions`    | POST   | Main endpoint (OpenAI-compatible)        |

## Verify

```powershell
npm run test   # action-extraction unit tests
npm run mock   # simulates the extension calling the server (server must be running)
```

## Real VLM setup (laptop)

Ollama is the easiest local runtime:

```powershell
ollama pull qwen2.5vl:7b   # vision model used by this repo's extension
ollama serve              # usually already running as a service
npm start                 # in server/
```

Check `/health` — `upstreamReachable: true` means the extension can run the
full capture → sanitize → VLM → action loop (Phase 4).

## Security note

The backend only ever receives the **sanitized** image + page structure — the
extension never sends raw screenshots, passwords, or PII. This gateway adds no
persistence and logs no image data.
