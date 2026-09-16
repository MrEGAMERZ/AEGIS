# AEGIS — teammate reference

**Read this first.** One file for anyone joining the repo for the SIH hackathon.

Smart India Hackathon 2026 · problem **SIH26171** · ISRO · Chrome extension **v0.1.0** · branch **`DEV`**

AEGIS is a **privacy-first browser agent**. It looks at the page **on the laptop**, covers faces / passwords / ID numbers, and only then (if you ask) lets a local vision model help fill the form. Raw screenshots do not go to the cloud.

The name is Greek: a shield — protector, defender.

---

## What we are building (one paragraph)

Most agentic browsers photograph the whole tab and send it to a remote model. That picture can include an applicant’s face, a password field, an Aadhaar box. We refuse that trade.

Three local detectors run **inside Chrome**:

1. **DOM** — password fields, card autocomplete, labels like PIN / Aadhaar / PAN (no model).
2. **Faces** — BlazeFace ONNX (~400 KB) in a Web Worker.
3. **Text PII** — regex (Aadhaar, PAN, phone, email, …) then DistilBERT NER for names / places / orgs.

Masks are drawn on a canvas. **Privacy Scan stops there** — nothing leaves the device. **Fill Form** and **Run Agent** may send the *cleaned* image plus a layout sketch to a process you start on `localhost`. If face or NER redaction was required and did not finish, the request is blocked (**fail-closed**).

---

## How judges score us

| Criterion | Weight | What they actually look at |
|---|---|---|
| Visual accuracy | 25% | Local stack understands the screen |
| PII recall / precision | 20% | Faces, passwords, text IDs |
| Redaction precision | 20% | Mask the secret, not the Submit button |
| Client resources | 20% | `dist/` size, memory, WASM path |
| End-to-end latency | 15% | Capture → redact → maybe VLM → act |

Impressive extras do not score. Measured, honest, demoable work does.

---

## Product surface (the popup)

Toolbar icon → 360px panel, **three tabs**.

| Tab | What it does |
|---|---|
| **Fill** | Privacy Scan, Fill Form, Run Agent. After a scan: receipt + sanitized preview. Stop cancels a stuck scan. |
| **Profile** | Multiple named profiles (Personal / Work / Family, plus **+ New**). Speak or drop a PDF into the **selected** one. Demo pack: `eval/fixtures/`. |
| **Settings** | Face / password / PII toggles. Links to full voice page and dashboard. VLM URL default **`http://localhost:8000/v1/chat/completions`**. |

| You click | Stays on device | Leaves the browser |
|---|---|---|
| Privacy Scan | Capture, detect, redact, overlay, receipt | **Nothing** |
| Fill Form | Match profile + vault text to labels; fill every match | **Nothing** (leftovers stay empty with a small warning) |
| Run Agent | Same redaction, then action loop | Sanitized image + page structure + task |
| Drop a PDF | Extract text here; strip Aadhaar/PAN/etc. | Only if “structure with local AI” is ticked — and only to `localhost` |

Everyday browsing does **not** cover the page. Password and face hides apply only to the sanitized frame a local agent may see (Privacy Scan / Run Agent preview). Faces still run only on those explicit actions.

---

## How the machine is split

Chrome MV3 does not let a service worker use canvas / WebGL / ONNX easily, so work is split on purpose.

```
page  ── DOM scan / clicks ──►  content script
                                     │
toolbar / task  ───────────────────►  service worker  (orchestrator, no DOM)
                                     │
                           screenshot + field list
                                     ▼
                              offscreen document
                         (hidden page + canvas)
                                     │
                                     ├── Web Worker: BlazeFace + DistilBERT
                                     └── canvas: blur faces, black passwords
                                     │
                           sanitized PNG + layout sketch
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
               stop here                         localhost:8000
            (Privacy Scan /                      (Run Agent)
             Fill Form)
                                                      │
                                                 Ollama :11434
                                                 qwen2.5vl:7b
```

**Never point the popup at `:11434`.** Chrome sends `Origin: chrome-extension://…` and Ollama answers **403**. The Node gateway on **`:8000`** (`server/index.js`) is the fix: CORS, JSON cleanup, reject tiny images that crash the model runner.

WASM must work on a judge laptop. WebGPU is a bonus if `navigator.gpu` exists. Do not depend on it for the demo.

---

## Folder map (who owns what)

```
src/background/     Service worker. Capture, fail-closed gates, VLM client, vault.
src/content/        Lives in the tab. DOM scan, overlays, types into fields.
src/offscreen/      Hidden page. Canvas masks + PDF/DOCX extract.
src/inference/      Web Worker. BlazeFace + DistilBERT.
src/popup/          The panel above.
src/shared/         Profile parse, never-store strip, file helpers.
src/vendor/         ORT, models, pdf.js — do not “clean this up.”
src/voice/          Optional mic page (Web Speech).
src/dashboard/      Optional extra UI page.
server/             Node gateway :8000 → Ollama.
scripts/build-dist.sh   Builds the folder Chrome should load.
eval/test-pages/    TP01–TP08. Demo form = TP08 kitchen-sink.
eval/harness/       Node tests. Run them after you change code.
eval/fixtures/      Demo PDF / JSON profiles.
docs/               Specs, runbooks, this file.
manifest.json       Source of truth for permissions. Chrome runs the copy inside dist/.
```

**Who may talk to whom**

- Popup and content script talk only to the **service worker**.
- Service worker talks to **offscreen** and (optionally) **:8000**.
- Offscreen talks to the **inference worker**.
- Content script cannot see models. The worker cannot click the page.
- The gateway must never receive a **raw** screenshot.

If you add a “just send the image” shortcut, you are breaking the project.

---

## The three user flows (code-accurate)

### 1. Privacy Scan (no server)

Popup → `SCAN_AND_OVERLAY` / capture → offscreen `SANITIZE` → BlazeFace + NER + regex → canvas masks → overlay on the tab + receipt + preview. Network: none.

### 2. Fill Form (on device only)

Map saved profile keys and vault text onto visible labels (`FILL_MATCHING_FIELDS`). Matching fields are filled even when others stay empty. Then a small status: leftover fields → **Not enough data available to fill the rest.** No saved data → **Save a profile first.** and stop. No model. Trap fields (Aadhaar, PAN, blood group, …) stay empty if they are not in the saved profile.

### 3. Run Agent

Same redaction as scan, then a loop: sanitized image + page structure + task → gateway → one JSON action (`click` / `type` / `scroll` / `navigate` / `done`) → content script executes it. Repeat until done or limit.

Fail-closed: missing face/NER redaction → `[FACE_REDACTION_REQUIRED]` / `[NER_REDACTION_REQUIRED]`. No VLM call.

### Document upload

Bytes stay in the browser. Offscreen extracts **text** (pdf.js / DOCX zip+XML). Never-store IDs are stripped **before** vault write and **before** optional local AI. Remote models are refused. Vault cap: **5 docs / 256 KB**. User must click **Save**; Don’t save stores nothing.

---

## Storage (this device only)

We never use `chrome.storage.sync`.

| Key | Meaning |
|---|---|
| `userProfile` / `aegisProfiles` | Field map for fill (never-store IDs omitted) |
| `aegisDocVault` | Pre-stripped document **text**, not the PDF |
| `faceDetection` / `passwordDetection` / `piiDetection` | Toggles |
| `vlmEndpoint` / `vlmModel` | Local gateway URL + model id |
| `lastReceipt` (session) | Last scan counts + latency, not raw PII |
| `lastSanitizedImage` (session) | Redacted viewport PNG for the Fill-tab judge preview; wiped on browser close |
| `aegisTheme` | Light / Dark / Auto |

Profile and vault are **plaintext on disk**. Say that honestly if asked.

---

## Run it tomorrow

You need Chrome 109+. Ollama is optional for Privacy Scan.

```bash
# 1. Build the unpacked extension (NOT the repo root)
bash scripts/build-dist.sh

# 2. chrome://extensions → Developer mode → Load unpacked → select dist/
#    Enable “Allow access to file URLs” if you open TP08 as file://

# 3. After any src/ change: rebuild, Reload the card, refresh the tab
```

`dist/` is ~**81 MB**. If Chrome reports hundreds of MB / 1 GB, you loaded the **repo root** by mistake.

**Scan without a server**

1. Open `eval/test-pages/tp08-kitchen-sink-registration.html`
2. Wait until the badge says models are ready (first load can take 30–90s — WASM, not hung)
3. Fill tab → **Privacy Scan**
4. Expect: orange boxes, blurred face, black password fields, non-zero receipt

**Fill / Run Agent (needs local AI)**

```bash
ollama pull qwen2.5vl:7b     # ~4.7 GB, once
ollama serve
cd server && node index.js   # real gateway, not --mock
curl -sS http://localhost:8000/health
# want: mock: false, upstreamReachable: true
```

Popup defaults are already `:8000` and `qwen2.5vl:7b`. Import a fixture from `eval/fixtures/`, Save, Fill Form.

**Tests after you touch code**

```bash
for f in eval/harness/*.test.js; do node "$f"; done
```

Node harness passing is **not** a substitute for clicking the popup.

---

## Common failures (we already paid for these)

| Symptom | Actual cause |
|---|---|
| Extension is huge | Loaded repo, not `dist/` |
| `[NO_CONTENT_SCRIPT]` on `file://` | File URL access off, or you reloaded the extension and forgot to refresh the tab |
| HTTP 403 | Popup pointed at `:11434`. Use `:8000` |
| First scan sits a minute | Cold WASM + NER. Wait. Next one is faster |
| `[FACE_REDACTION_REQUIRED]` | Face gate blocked the VLM. Check the sidebar photo rendered |
| `[NER_REDACTION_REQUIRED]` | NER did not load. Rebuild so `src/vendor/models/` is in `dist/` |
| Ollama 500, “model runner stopped” | Degenerate / tiny image. Restart Ollama. Gateway rejects images under 28 px |
| `/health` says `"mock": true` | You started `npm run start:mock`. Judges must not see that |

---

## Rules while you code

Priority: **Working → Measurable → Explainable → Privacy-safe → Lightweight → Demoable.**

- Do not claim latency / recall until you measured it.
- Do not mark complete until it runs on a clean Chrome load of `dist/`.
- Do not send raw screenshots, vault PDFs, or never-store IDs off-device.
- Do not rewrite `src/vendor/`.
- After `src/` changes: `bash scripts/build-dist.sh`, Reload extension, refresh the page.
- If spec, code, and a measured result disagree: **stop and say so**. Do not paper over it.

---

## What is still open (demo gate)

Canonical board: [`TASK_MASTER.md`](TASK_MASTER.md). Short version:

| ID | Still owed |
|---|---|
| **A1–A6** | Live Chrome proof on TP08 (scan, redaction-before-VLM, HiDPI clicks, Fill/Agent with Ollama, PDF → Save → fill, drag-drop) |
| **B1–B2** | Measured SIH numbers on the demo machine; two unseen pages |
| **C1** | Privacy re-audit sign-off in a real browser |
| **D** | WebGPU path, full TP matrix, self-learning profile — **after** demo unless we re-prioritize |

Code + Node harness are largely in. **Live Chrome on a judge-like machine is the remaining proof.**

---

## Where to go next

| Need | Open |
|---|---|
| Story + 5-minute install | [`README.md`](../README.md) |
| Click-by-click judge path | [`DEMO_RUNBOOK.md`](DEMO_RUNBOOK.md) · [`LIVE_DEMO.md`](LIVE_DEMO.md) |
| Full architecture | [`02_ARCHITECTURE.md`](02_ARCHITECTURE.md) |
| Profile / vault / Fill map | [`PROFILE_FILL_ARCHITECTURE.md`](PROFILE_FILL_ARCHITECTURE.md) |
| Document trust boundary | [`PRIVACY_DOC_UPLOAD.md`](PRIVACY_DOC_UPLOAD.md) |
| Gateway / 403 story | [`BACKEND_DEPLOY.md`](BACKEND_DEPLOY.md) |
| Spoken pitch | [`INDUSTRY_PITCH_SCRIPT.md`](INDUSTRY_PITCH_SCRIPT.md) |
| Doc index | [`00_INDEX.md`](00_INDEX.md) |
| Open work | [`TASK_MASTER.md`](TASK_MASTER.md) |

If ONNX / WASM still feel made-up: [`06_TECH_EXPLAINER.md`](06_TECH_EXPLAINER.md).
