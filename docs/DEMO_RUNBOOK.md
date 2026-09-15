# Aegis Demo Runbook — Chrome E2E on TP08

**LIVE CARD (real Chrome):** extension name is **AGs**. Load unpacked from **`dist/` only** (never the repo root). Preferred TP08: `http://127.0.0.1:8765/tp08-kitchen-sink-registration.html`. Popup → **Profile** → drop `eval/fixtures/Aegis-Demo-Profile-Mohammad-Rehan.pdf` → review fields → **Save** (or Import `dummy-profile-rehan.json`). **Fill** → **Fill Form** (Mohammad Rehan, not John Doe). **Privacy Scan** on Fill; face scan is under **Settings**. Reload unpacked after every rebuild. One-pager: [`LIVE_DEMO.md`](LIVE_DEMO.md).

**Audience:** judges, evaluators, and developers running the live demo.  
**Goal:** load the extension from `dist/`, open TP08, and complete **Scan page** or **Run Agent** without hitting known footguns.  
**Test page:** `eval/test-pages/tp08-kitchen-sink-registration.html`  
**Profile fixture:** `eval/fixtures/dummy-profile-rehan.json` + `eval/fixtures/Aegis-Demo-Profile-Mohammad-Rehan.pdf`

For VLM server details and measured latencies, see [`docs/SERVER_SETUP.md`](SERVER_SETUP.md).

---

## Judge demo without Ollama (hero path)

**Use this when Ollama is down, not installed, or you want zero cloud latency.** Privacy scan proves the full on-device redaction pipeline — no VLM call.

| Step | Action | Pass if |
|---|---|---|
| 0 | `bash scripts/build-dist.sh` | `dist/` exists (~79 MB with NER) |
| 1 | Load **unpacked** from **`dist/`** | Extension size 15–80 MB in `chrome://extensions` |
| 2 | Enable **Allow access to file URLs** | Checkbox ON on the Aegis card |
| 3 | Open TP08 (`file://…/eval/test-pages/tp08-kitchen-sink-registration.html`) | Page renders; sidebar face photo visible |
| 4 | Open popup → wait for **BlazeFace ready (WASM)** badge | Badge turns green (first open may take up to 60 s while WASM compiles) |
| 5 | Click **Privacy scan** (primary blue button) | Orange overlays on password/card fields; status success |
| 6 | Check popup | **Sanitized preview** shows blurred face + black password fields |
| 7 | Check **Last Privacy Receipt** | `faces > 0`, `piiSpans > 0`, password field count > 0 |

**What to say:** “All redaction runs locally in the browser. The sanitized preview is what would be sent to a VLM — raw faces and passwords never leave the device.”

**If Run Agent is clicked without Ollama:** popup shows a friendly amber message — local redaction still succeeded; preview + receipt remain visible. Fail-closed gates are unchanged when a VLM *is* configured.

**First Privacy scan latency:** allow **30–90 s** on a cold extension load (WASM compile + NER init). Subsequent scans are faster.

**Idle browsing:** the content script may outline password/PII fields as you browse, but it does **not** run BlazeFace on photos of other people. Face boxes appear only on **Privacy Scan**, **Run Agent**, or an explicit **Scan faces now** / **Scan faces on this page** action (Fill tab or Settings).

---

## Quick checklist (print this)

| Step | Action | Pass if |
|---|---|---|
| 0 | `bash scripts/build-dist.sh` | `dist/` exists; manifest paths verify OK |
| 1 | Load **unpacked** from **`dist/`** (not repo root) | Extension size ≈ **15–80 MB** in `chrome://extensions`, not hundreds of MB |
| 2 | Enable **Allow access to file URLs** on the extension card | Checkbox is on |
| 3 | `ollama serve` + `ollama pull qwen2.5vl:7b` + pre-warm | `ollama ps` shows model loaded; warm ping < 5 s |
| 4 | Open TP08 via `file://` (or local static server) | Page renders; yellow “How to use” box visible |
| 5 | Paste profile JSON → **Save Profile** | Popup status: “Profile saved locally.” |
| 6 | **Privacy Scan** (face toggle ON, or **Scan faces now**) | Overlays on face, passwords, card fields; receipt counts > 0 |
| 7 | **Fill Form** or **Run Agent** | Fill Form: local profile/vault match first, then one local-VLM pass for leftovers; Run Agent: full multi-step loop |
| 8 | On any extension **Reload** | **Refresh the TP08 tab**, then retry |

**Expected latencies (dev machine, pre-warmed Ollama):**

| Phase | Typical |
|---|---|
| First Run Agent (cold INIT + first NER compile) | 30–90 s — looks hung; wait |
| Ollama cold VLM (if not pre-warmed) | ~55 s measured |
| Ollama warm VLM | ~1.3–1.6 s |
| Full warm loop (redact + VLM + one type) | ~5–15 s |

---

## 1. Build and load the extension

### Build `dist/`

From the repo root:

```bash
bash scripts/build-dist.sh
```

The script assembles a minimal **Load unpacked** root at `dist/` and verifies every path in `manifest.json` resolves inside it.

**Size expectations:**

| Load root | Approx. size | Use? |
|---|---|---|
| Repo root | ~650 MB+ (`node_modules`, `.opencode`, `.git` billed to Chrome) | **Never** |
| `dist/` (baseline, no NER tree) | ~15 MB | Yes |
| `dist/` (with vendored NER under `src/vendor/models/`) | ~65–80 MB | Yes — current tree may include this |

Re-run `build-dist.sh` after any change under `src/vendor/`.

### Load unpacked in Chrome

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → select **`/path/to/SIH26/dist`** (the folder that contains `manifest.json`)
4. On the Aegis card, enable **Allow access to file URLs** (required for `file://` eval pages)
5. Confirm reported size is in the **15–80 MB** range, not hundreds of MB

> **Footgun:** loading the repo root makes Chrome scan `node_modules/` and breaks the Resource criterion (~629 MB reported historically).

---

## 2. Start and pre-warm Ollama

### Install and run

```bash
# One-time (~4.7 GB)
ollama pull qwen2.5vl:7b

# Keep running (or use Ollama desktop app)
ollama serve
# → Listening on 127.0.0.1:11434
```

### Pre-warm before judging

Cold first request can take **~55 s** on a 16 GB machine. Warm before the demo:

```bash
curl -s http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"qwen2.5vl:7b","messages":[{"role":"user","content":"Say READY"}],"max_tokens":5,"temperature":0.1}'
```

Or:

```bash
ollama run qwen2.5vl:7b "Say READY" --verbose
```

### Local gateway (real model — do not use mock)

The extension talks to `http://localhost:8000` when this process is up and **not** in `--mock` mode. Ollama stays the actual vision model.

```bash
cd server && node index.js
curl -sS http://localhost:8000/health
# Expect: "mock": false  and  "upstreamReachable": true
```

Do **not** run `npm run start:mock` for a demo. If `/health` says `"mock": true`, stop that process and start with `node index.js` only.

---

Check the model stays loaded:

```bash
ollama ps
```

### Extension popup defaults

Open the Aegis popup and confirm (defaults are pre-filled):

| Field | Value |
|---|---|
| VLM Endpoint | `http://localhost:8000/v1/chat/completions` (local gateway — not Ollama `:11434` directly from Chrome) |
| VLM Model | `qwen2.5vl:7b` |
| API key | Leave empty for local Ollama via gateway |

**Face detection:** Fill tab **Scan human faces** toggle (synced with Settings → Face Detection). When ON, Privacy Scan and Run Agent outline faces; when OFF, only password/PII fields. **Scan faces now** (Fill tab) or **Scan faces on this page** (Settings) forces one face pass even if the toggle was off.

Leave **Password Fields** and **Text PII** checked unless you are deliberately testing opt-out.

---

## 3. Open TP08 and grant file access

### Open the page

**Option A — file URL (simplest on one machine):**

```
file:///…/SIH26/eval/test-pages/tp08-kitchen-sink-registration.html
```

Drag the HTML file into Chrome, or use **File → Open**.

**Option B — local static server (avoids some file-URL quirks):**

```bash
cd eval/test-pages && python3 -m http.server 8765
# → http://localhost:8765/tp08-kitchen-sink-registration.html
```

### File URL access

If **Scan page** or **Run Agent** shows `[NO_CONTENT_SCRIPT]` on a `file://` tab:

1. `chrome://extensions` → Aegis → **Allow access to file URLs** → ON  
2. **Reload** the extension (↻ on the card)  
3. **Refresh the TP08 tab** (mandatory after extension reload)  
4. Retry

> **Footgun:** reloading the extension orphans the tab’s content script. Refreshing the tab (or closing and reopening TP08) is required every time you Reload the extension.

The page loads a face image from `eval/test-pages/assets/applicant-face.jpg` (relative to the HTML file). If the photo is broken, face redaction cannot be demonstrated — confirm the sidebar image renders before Run Agent.

---

## 4. Save the profile (and optional documents)

1. Expand **How to use this page for Aegis testing** on TP08 (yellow box)  
2. Copy the JSON from the readonly textarea **or** open `eval/fixtures/dummy-profile-ananya.json`  
3. Aegis popup → **My Profile Data** → paste JSON  
4. Click **Save Profile** → status **Profile saved locally.**

The profile intentionally **excludes** Aadhaar, PAN, Blood Group, and Emergency Contact — those fields are hallucination traps on TP08.

**Optional document upload:** Profile tab → drop a **PDF** (or DOCX/TXT). Text is extracted **on-device** (vendored pdf.js, zero network). Optionally **Structure with local AI** (localhost only). Nothing is stored until **Save**: fields go into the Profile list; document text stays in `aegisDocVault` as local knowledge. **Don't save** discards RAM only. **Fill Form** reads saved profile + vault via `FILL_MATCHING_FIELDS` before any VLM call.

---

## 5. Scan page and Run Agent

### Path A — Privacy scan (redaction demo, no VLM) — **recommended without Ollama**

1. Focus the TP08 tab  
2. Popup → **Privacy scan** (blue button)

**Success:**

- Orange/red overlay boxes on sensitive fields (passwords, card number, CVV, Aadhaar/PAN inputs, etc.)  
- Face region highlighted on `#applicant-photo` after sanitize completes  
- **Sanitized preview** in popup: blurred face, black password fields, masked PII text  
- **Privacy receipt:** `faces > 0`, `piiSpans > 0`, password/card fields counted  
- Status: `Privacy scan complete — N sensitive field(s) overlaid, M face(s) redacted.`

Privacy scan does **not** call the VLM. This is the judge hero path when the gateway/Ollama is offline.

With **Scan human faces** OFF, Privacy Scan still masks passwords and NER PII but skips BlazeFace; status says faces were not scanned. Use **Scan faces now** to force a one-time face pass.

### Path A2 — Scan page (legacy label)

Same as Path A — the button is labeled **Privacy Scan** in the popup UI.

### Path B0 — Fill Form (local first, then one VLM batch)

1. Focus the TP08 tab  
2. Popup → **Fill Form** (Fill tab, blue button)

**Pipeline:**

1. `FILL_MATCHING_FIELDS` — maps saved profile + document vault text to visible form labels (no VLM)  
2. If fields remain → **one** local-VLM agent loop (`CAPTURE_AND_SANITIZE` → execute actions; stops on `fill_many` or `done`)

**Success:** status reports N fields filled locally; trap fields stay empty. If the gateway at `:8000` is down, leftover VLM is skipped (status says remaining fields left blank). Requires gateway at `:8000` only for leftover empty *eligible* fields.

### Path B — Run Agent — form fill

1. Task box — paste:

   ```
   Fill the scholarship application using my saved profile. Leave blank any field that is not in the profile. Do not invent values.
   ```

2. Click **Run Agent**

**Pipeline in popup:**

1. Capture viewport  
2. Local redaction (BlazeFace + NER + password black-fill) — first run may take **30–90 s** while WASM/NER init  
3. VLM on sanitized context only  

**Success:**

- **Sanitized preview** shows blurred face and masked PII (not the raw sidebar card)  
- **Privacy receipt:** `faces > 0`, `piiSpans > 0`, password/card fields masked  
- Main form fields with profile keys fill (Full Name, Email, Phone, …)  
- **Traps stay empty:** Blood Group, Aadhaar, PAN, Emergency Contact, Project description, Portal PIN  

Run Agent may execute multiple VLM rounds (click + type). Re-run with the same task until required fields are filled or the agent returns `done`.

### Path C — Run Agent — summarize

1. Task box:

   ```
   Summarize this page in three short bullet points.
   ```

2. Click **Run Agent**

**Success:**

- Sanitized preview + receipt as above  
- Status ends with **Done:** and a short summary (VLM `done` action)  
- No profile values invented into trap fields  

---

## 6. Recovery — known errors

Popup errors use a **`[CODE]`** prefix. Match the code, then follow the fix.

### `[TIMEOUT]` / `[INIT_FAILED]` — on-device models

**Symptoms:** `On-device model init failed before any VLM call`; badge stuck on loading; messages mention `timed out`, `ort-wasm`, `Inference worker failed`, or WASM fetch.

**Fix:**

1. `chrome://extensions` → **Reload** Aegis (ensures latest `dist/` build, especially after `src/vendor/` changes)  
2. **Refresh TP08 tab**  
3. Wait up to **90 s** on first Run Agent (13 MB WASM compile + NER load)  
4. Close other heavy apps if memory is tight (Chrome + Ollama + WASM on 16 GB is thin)  
5. Re-run `bash scripts/build-dist.sh` if vendor files changed  

**Do not** disable Face/PII detection to “unblock” the demo unless privacy sign-off allows it — gates exist to prevent raw frames reaching the VLM.

### `[NO_CONTENT_SCRIPT]` — page script unreachable

**Symptoms:** `Could not establish connection` / `Receiving end does not exist`; Scan fails immediately after extension reload.

**Fix:**

1. **Refresh the active tab** (or close and reopen TP08)  
2. Confirm tab is `http://`, `https://`, or `file://` — not `chrome://`  
3. For `file://`: **Allow access to file URLs** ON  
4. Reload extension → refresh tab again  

Auto-inject retries once; it cannot bypass the file-URL permission checkbox.

### `[FACE_REDACTION_REQUIRED]` — face gate blocked VLM

**Symptoms:** Face redaction did not complete; VLM call blocked.

**Common causes:**

- BlazeFace found **zero faces** on the sidebar photo (known risk: small face in viewport — see P0-2)  
- WASM/ONNX init failed (`FACE_MODEL_UNAVAILABLE` in receipt)  
- User disabled **Face Detection** inconsistently mid-run  

**Fix:**

1. Confirm `#applicant-photo` image loaded  
2. Reload extension + refresh tab; retry Run Agent  
3. Check receipt `faces` count — need `> 0` or an explicit block, never silent send  
4. If faces stay 0 at full viewport, note as **P0-2** blocker (letterbox preprocess)  

### `[NER_REDACTION_REQUIRED]` — NER gate blocked VLM

**Symptoms:** Name/place/org redaction did not complete.

**Common causes:**

- NER model failed to load (missing vendored tree in `dist/src/vendor/models/` — rebuild `dist/`)  
- First `DETECT_NER` still compiling (allow **60 s**)  
- No network **and** no vendored NER (legacy builds) — fail-closed by design  

**Fix:**

1. Rebuild `dist/` so `src/vendor/models/` is present  
2. Reload extension; refresh tab; retry  
3. Confirm visible text on TP08 left card (name, org, location) for `piiSpans > 0`  

### Ollama HTTP 500 — “model runner has unexpectedly stopped”

**Symptoms:** `[BACKEND_UNAVAILABLE]` or `VLM unavailable: VLM API error: 500 … model runner has unexpectedly stopped`; popup may show `VLM_BAD_RESPONSE` on malformed replies.

**Fix:**

```bash
ollama ps          # see if runner died
pkill ollama       # or quit Ollama app
ollama serve
ollama run qwen2.5vl:7b "warmup"   # reload weights
```

Then pre-warm with `curl` (section 2) and retry Run Agent. Reduce concurrent memory hogs (extra Chrome profiles, other LLMs).

### `[VLM_BAD_RESPONSE]` / `[BAD_JSON]`

**Symptoms:** Server replied but not with a usable JSON action; or non-JSON from HF/jsdelivr asset fetch.

**Fix:**

- **VLM:** confirm `qwen2.5vl:7b` is a **vision** model; check `ollama logs`  
- **BAD_JSON on first run:** often Hugging Face / jsdelivr download for legacy ORT paths — rebuild `dist/` with vendored models; ensure network once, then offline  
- Retry after pre-warm  

### `[UNKNOWN]` / runtime disconnect

**Fix:** Refresh tab after extension reload. If persistent, open service worker **Inspect views: service worker** in `chrome://extensions` and read the console stack.

---

## 7. What success looks like

### Privacy (must-have)

| Signal | Expected |
|---|---|
| Sanitized preview | Face blurred; passwords black; structured IDs/emails masked |
| Receipt — faces | `> 0` on TP08 (or explicit `FACE_REDACTION_REQUIRED` block — never silent raw send) |
| Receipt — PII spans | `> 0` (names/orgs/locations on left card) |
| Receipt — fields | Password and card-related DOM fields counted |
| VLM payload | No raw screenshot; no page URL/title in outbound JSON (see `privacy-payload.test.js`) |

### Form fill (Run Agent path B)

| Area | Expected |
|---|---|
| Personal / address / education | Values from `dummy-profile-ananya.json` |
| Trap fields | Empty — Blood Group, Aadhaar, PAN, Emergency Contact, Project, Portal PIN |
| Submit | Agent should **not** auto-submit unless you ask |

### Summarize (Run Agent path C)

| Signal | Expected |
|---|---|
| Final status | `Done: …` with 3 bullet-ish summary |
| Side effects | No spurious form fills |

### Performance (judge-facing)

- Pre-warm Ollama **before** the room sees the demo  
- First Run Agent after fresh browser: warn audience about **30–90 s** INIT  
- Subsequent actions: **~1–5 s** warm if Ollama stays loaded  

---

## Appendix — error code reference

| Code | Meaning | Typical fix |
|---|---|---|
| `NO_CONTENT_SCRIPT` | Tab has no content script (post-reload) | Refresh tab; file-URL access |
| `INIT_FAILED` | BlazeFace/ORT worker failed | Reload extension; rebuild `dist/` |
| `TIMEOUT` | Worker/offscreen request timed out | Wait/retry; reduce memory pressure |
| `FACE_REDACTION_REQUIRED` | Face gate fail-closed | Fix photo/load; P0-2 if faces=0 |
| `NER_REDACTION_REQUIRED` | NER gate fail-closed | Rebuild `dist/` with models; wait 60s |
| `BACKEND_UNAVAILABLE` | VLM HTTP/transport error | Restart Ollama; pre-warm |
| `VLM_BAD_RESPONSE` | VLM JSON shape wrong | Vision model + healthy Ollama |
| `BAD_JSON` | Parse failure (assets or server) | Network once or vendored models |
| `NO_ACTIVE_TAB` | No focused tab | Focus TP08 |

Popup copy for each code lives in `src/popup/popup.js` (`formatAgentError`). Classification logic: `src/background/background.js` (`classifyError`, `describeVlmHttpError`).

---

## Related files

| File | Role |
|---|---|
| `scripts/build-dist.sh` | Produce judge load root |
| `eval/test-pages/tp08-kitchen-sink-registration.html` | Demo page + inline instructions |
| `eval/fixtures/dummy-profile-ananya.json` | Profile JSON |
| `eval/test-pages/assets/applicant-face.jpg` | BlazeFace target |
| `docs/SERVER_SETUP.md` | Ollama install, smoke tests, latencies |
