# MVP Gap Report — Extension vs Requirements

**Date:** 2026-08-31  
**Scope:** Read-only audit of `/Users/rehan/Developer/SIH/SIH26` against `docs/01_REQUIREMENTS.md` MVP checklist and the four demo problems referenced in team memory (Problems 1–4).  
**Method:** graphify orientation, direct reads of `src/`, `manifest.json`, `scripts/build-dist.sh`, `eval/harness/*`, and one live run of `node eval/harness/ner-offline-smoke.mjs`.

## Problem name mapping (not in requirements doc verbatim)

| Label | Inferred scope | Primary code |
|---|---|---|
| **Local Eye** (Problem 1) | Viewport capture + on-device BlazeFace | `handleCaptureAndSanitize()`, `detectFacesFromPayload()`, `inference.worker.js` |
| **Privacy Shield** (Problem 2) | Redact before VLM; fail-closed | `handleSanitize()`, `assertReadyForVlm()`, `redactNerSpansInFields()` |
| **Brain Connection** (Problem 3) | VLM prompt/response loop (Ollama/Gemini) | `requestVlmContent()`, `parseAction()`, `sanitizeAction()`, `popup.js` Run Agent |
| **The Hand** (Problem 4) | Execute click/type/scroll in page | `executeClick()`, `executeType()`, `executeScroll()`, `handleExecuteAction()` |

---

## Gap table

| Requirement | Current evidence (file / symbol) | Status | Suggested owner | Suggested task ID |
|---|---|---|---|---|
| **P1 — Screen capture on demand** (`FR-01`) | `chrome.tabs.captureVisibleTab()` in `src/background/background.js` `handleCaptureAndSanitize()` L340; triggered from popup `CAPTURE_AND_SANITIZE` (`src/popup/popup.js` L340) | **OK** | frontend | — |
| **P1 — DOM scan supplies DPR + viewport for physical-pixel alignment** | `DOM_SCAN` in `src/content/content.js` L467–480 returns `dpr`, `viewport`; used in `buildPageStructureForVlm()` (`background.js` L223–239) | **OK** | frontend | — |
| **P1 — BlazeFace ONNX runs locally in module worker** | `loadFaceModel()`, `detectFacesFromPayload()` in `src/inference/inference.worker.js` L104–341; model at `src/vendor/blaze.onnx` | **OK** | ml | 2.1 |
| **P1 — Face 128×128 preprocess (/255, HWC→CHW)** | Documented + implemented in `detectFacesFromPayload()` L284–300 (`targetW/H = 128`, `/255.0`, CHW layout) | **OK** | ml | 2.1 |
| **P1 — Face bbox scaled back to original capture pixels** | `detectFacesFromPayload()` L329–337; offscreen applies masks in physical space (`offscreen.js` L247–251) | **OK** | ml | 2.1 |
| **P1 — Small-face recall (faces &lt;5% viewport)** | Commented limitation in `inference.worker.js` L248–249 | **PARTIAL** | ml | 2.1 |
| **P1 — WebGPU acceleration path** (stretch in MVP doc) | `selectBackend()` hardcodes `wasm` only (`inference.worker.js` L98–100); no WebGPU EP | **MISSING** | ml | stretch |
| **P2 — DOM password / autocomplete sensitive fields** (`FR-02`) | `scanDOMForSensitiveFields()` in `src/content/content.js` L35–87; black fill in `handleSanitize()` L222–232 | **OK** | frontend | — |
| **P2 — `passwordDetection` toggle actually gates DOM masking** | Key stored in `chrome.storage.local` (`popup.js` L113, L149; `background.js` L988) but **never read** in capture/sanitize path — DOM scan always runs | **BROKEN** | frontend + backend | new |
| **P2 — Hybrid regex + DistilBERT NER** (`FR-04`) | Regex in `detectTextPII()` (`offscreen.js` L406–430); NER via `detectNER()` / `loadNERModel()` (`inference.worker.js` L154–400) | **PARTIAL** | ml | 2.2 |
| **P2 — NER weights vendored (no HF/jsdelivr at demo)** | `allowRemoteModels = false`, `localModelPath = MODELS_DIR` (`inference.worker.js` L168–170); `src/vendor/models/distilbert-ner/` shipped; `build-dist.sh` includes `VENDOR_DIRS` | **OK** (static) | ml + codebase | 4.5 |
| **P2 — NER works fully offline in real Chrome** | `node eval/harness/ner-offline-smoke.mjs` (2026-08-31): **0 non-loopback requests** but **FAIL** — worker ERROR `this.tokenizer is not a function` on `DETECT_NER` | **BROKEN** | ml | 4.5 / 2.2 |
| **P2 — Mask faces before any network call; fail-closed** | `handleSanitize()` throws on missing BlazeFace (`offscreen.js` L240–245); `assertReadyForVlm()` before `fetch` (`background.js` L377–380, L634–654); harness `face-redaction-before-vlm.test.js` **50/50** | **OK** | backend + privacy | 2.8 |
| **P2 — Mask NER entities before VLM; fail-closed** | `nerPassComplete` gate (`offscreen.js` L259–287); `NER_REDACTION_REQUIRED` in `assertReadyForVlm()`; harness `ner-redaction-before-vlm.test.js` **28/28** (static/VM, not live Chrome NER) | **PARTIAL** | backend + ml | 2.9 |
| **P2 — Gaussian blur for faces / PII** (`FR-05` taxonomy) | `applyPixelation()` block averaging (`offscreen.js` L319–365), not Gaussian blur | **PARTIAL** | frontend | new |
| **P2 — Strip URL/title from VLM payload** | `buildPageStructureForVlm()` omits url/title (`background.js` L223–239) | **OK** | backend + privacy | 3.4 |
| **P2 — NER entity bbox precision** | Worker maps entity to **parent element rect**, not char-level (`inference.worker.js` L347–349, L393) | **PARTIAL** | ml | 2.2 |
| **P3 — Structural context + sanitized image to VLM** (`FR-06`) | Payload built in `handleCaptureAndSanitize()` L477–495; includes `pageStructure`, base64 `sanitizedImage` | **OK** | backend | — |
| **P3 — OpenAI-compatible VLM endpoint (Ollama default)** | Default `http://localhost:11434/v1/chat/completions`, model `qwen2.5vl:7b` (`background.js` L394–395, L984–985); documented in `docs/SERVER_SETUP.md` | **OK** | backend | — |
| **P3 — Qwen3-VL-8B as specified in FR-07** | Not in Ollama registry; code defaults to `qwen2.5vl:7b` by design | **PARTIAL** | backend | — |
| **P3 — Gemini / hosted VLM via API key** | `buildVlmAuthHeaders()` + session `vlmApiKey` (`background.js` L211–220; `popup.js` L124–167) | **OK** | backend | 3.1 |
| **P3 — Free-form prompts (summarize / describe)** | System prompt `CHOOSING THE ACTION` block (`background.js` L449–453); harness `sanitize-action.test.js` Problem 3 case; team memory 4.3 cites live measure | **OK** | backend | 4.3 |
| **P3 — Parse prose/fenced JSON; bounded retry** | `parseAction()`, `jsonCandidatesFrom()`, single retry (`background.js` L504–525, L862–878); harness **35/35** | **OK** | backend | 4.1 |
| **P3 — Anti-hallucination on `type` actions** | `sanitizeAction()` profileKey guard (`background.js` L707–799); harness **35/35** on real `background.js` | **OK** | backend | 2.6 |
| **P3 — Multi-step agent loop (fill entire form)** | Popup runs **one** `CAPTURE_AND_SANITIZE` + **one** `EXECUTE_ACTION` per click (`popup.js` L324–383); no replan loop | **MISSING** | backend + frontend | new |
| **P4 — Click at VLM coordinates** | `executeClick()` + `clickPoints()` DPR scaling (`content.js` L168–210) | **OK** | frontend | 4.2 |
| **P4 — Retina / HiDPI click fix** | Divides by `devicePixelRatio` before `elementFromPoint`; harness `execute-action.test.js` **38/38** | **OK** | frontend + eval | 4.2 |
| **P4 — Type into selector (React/Vue compatible)** | `executeType()` native setter + `InputEvent` (`content.js` L212–253) | **OK** | frontend | — |
| **P4 — Scroll up/down** | `executeScroll()` (`content.js` L256–259); wired in `handleExecuteAction()` L965–966 | **OK** | frontend | — |
| **P4 — Navigate URL action** | `sanitizeAction` + `handleExecuteAction` `navigate` case (`background.js` L784–789, L968–970) | **OK** | backend | — |
| **MVP — End-to-end demo: fill fake loan form without transmitting PII** | Pipeline exists; blocked by single-turn loop + unproven live Chrome E2E (team memory 3.6 **PARTIAL**) | **PARTIAL** | eval + lead | 3.6 / 2.5 |
| **MVP — WASM fallback (universal browsers)** | ORT WASM-only bundle, `numThreads=1`, patched `ort.min.js` (`inference.worker.js` L40–84); harness face **50/50** | **OK** | ml | 2.7 / 3.8 |
| **Dist — Lean load-unpacked root at `dist/`** | `scripts/build-dist.sh` assembles `dist/`, verifies 19 manifest paths; current `du -sh dist/` → **79M** (65M NER model tree) | **PARTIAL** | codebase | 4.4 |
| **Dist — Must re-run after `src/` edits** | Script copies/hardlinks snapshot; stale `dist/` risk documented in `engineers/codebase/work_done.md` | **PARTIAL** | codebase | 4.4 |
| **Harness — Privacy / gate regression (static VM)** | 7 files, **246/246 passed** (2026-08-31): face 50, NER 28, execute 38, privacy 39, inject 43, sanitize 35, normalize 13 | **OK** | evaluation | — |
| **Harness — Full browser extension E2E** | No automated driver for popup → capture → VLM → execute on eval pages; `eval/README.md` Known Limitations section is **stale** (claims models not loaded) | **MISSING** | evaluation | 3.6 / 2.5 |
| **Harness — Rubric metrics (precision/recall/latency)** | `eval/harness/eval-harness.js` + 7 test pages exist; not wired to live extension inference in CI | **PARTIAL** | evaluation | 2.5 |
| **NFR — Dynamic re-detection on DOM mutations** (stretch) | `MutationObserver` in `content.js` L545–560 refreshes overlay only (no re-capture) | **PARTIAL** | frontend | 3.3 |

---

## Cross-cutting notes

### Dist packaging (4.4)

- **Exists and works statically:** `scripts/build-dist.sh` builds `dist/` with manifest at root, runtime under `src/`, vendored ORT + BlazeFace + full `distilbert-ner` tree.
- **Size:** **79 MB** on disk today (dominated by `dist/src/vendor/models/` ~65 MB). Team memory “15 MB” predates vendoring the NER ONNX.
- **Gap:** Judges must load **`dist/`**, not repo root; script must be re-run after changes. Live unpacked load not verified in this audit.

### NER remote download (4.5)

- **Code intent:** offline-first — `allowRemoteModels = false`, local model id `distilbert-ner`, shared vendored ORT WASM binary.
- **Runtime gap:** `eval/harness/ner-offline-smoke.mjs` against `dist/` with network blocked reported **zero external requests** but NER inference **failed** with `TypeError: this.tokenizer is not a function`. The worker defines `ensureCallableTokenizer()` (L146–152) but the smoke failure suggests the fix does not hold in the served worker path — **Privacy Shield fail-closed gate would block VLM** at a no-network venue until fixed.

### Face 128×128 preprocess

- **Implemented and documented** in `detectFacesFromPayload()` with verified model I/O contract in file header comments (L225–246).

### Retina DPR click fix (4.2)

- **Fixed in code; harness-proven:** `clickPoints()` / `executeClick()` in `content.js`; `execute-action.test.js` 38/38.

### Harness coverage

| Harness | Tests | What it proves |
|---|---|---|
| `face-redaction-before-vlm.test.js` | 50/50 | VLM `fetch` blocked until face gate passes (sandboxed background) |
| `ner-redaction-before-vlm.test.js` | 28/28 | NER gate + label redaction before VLM (static) |
| `execute-action.test.js` | 38/38 | Click/type/scroll message contract + DPR frames |
| `privacy-payload.test.js` | 39/39 | Payload shape, MutationObserver overlay-only rescan |
| `content-script-inject.test.js` | 43/43 | Post-reload inject + overlay behavior |
| `sanitize-action.test.js` | 35/35 | Real `background.js` action parser + guards |
| `normalize-profile.test.js` | 13/13 | Algorithm copy — **not** live import of background.js |
| `ner-offline-smoke.mjs` | FAIL | Real Chrome + blocked network — tokenizer error |
| `eval-harness.js` / benchmark runner | Manual | DOM-only metrics unless run inside extension context |

**Not measured in this audit:** precision/recall/F1 on test pages, peak memory, or end-to-end latency against rubric targets.

---

## MVP checklist (`docs/01_REQUIREMENTS.md` L170–178)

| MVP item | Status |
|---|---|
| Chrome MV3 extension captures screen + local BlazeFace | **OK** (code + harness; live face recall unmeasured here) |
| DOM password + autocomplete detection | **OK** (toggle wiring broken) |
| Hybrid regex + DistilBERT NER (Transformers.js WASM) | **PARTIAL** (offline Chrome NER broken per smoke) |
| Combined mask on offscreen canvas | **OK** (pixelation not spec blur) |
| Structural payload to VLM server | **OK** |
| E2E demo: fill fake loan form without transmitting PII | **PARTIAL** (single action per run; E2E unautomated) |
| WASM fallback working | **OK** |

---

## Recommended priority for builders

1. **Fix offline NER in real Chrome** (`this.tokenizer is not a function`) — blocks fail-closed Privacy Shield at offline venues. **ml** / task **4.5**.
2. **Wire `passwordDetection` (and/or remove dead `detectionEnabled`)** — UI lies about behavior. **frontend + backend**.
3. **Live Chrome E2E on TP08** — prove Run Agent → Ollama → fill/refuse. **eval** / task **3.6**.
4. **Multi-step agent loop** if full form-fill demo is required. **backend + frontend**.
5. **Re-run `build-dist.sh` and document 79 MB** load root for judges. **codebase** / **4.4**.
