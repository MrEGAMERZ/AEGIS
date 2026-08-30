# Lead Work Report

Lead owns the cross-cutting record. Specialist detail lives in `engineers/<role>/work_done.md`. Team-memory holds only status + measured essence.

## Recording protocol (standing)

A task is not finished until it is written down.

| Who | Where | What to write |
|---|---|---|
| Each specialist who did the work | `engineers/<role>/work_done.md` | Dated section: invariant/goal, files + line-level what changed, measured results, remaining risks. Use that file's table format. Cite real files — do not restate intent as done. |
| Lead | this file | Decision, owners, status, pointer to specialist reports, remaining risks, SIH impact. |
| Lead | `.opencode/memory/team-memory.md` | Update Active Tasks row (status + measured result). Keep lean. |

Dispatch prompts must include: **Report back in `engineers/<role>/work_done.md`**. Do not mark complete until eval has measured it and privacy has cleared it, or remaining risks are explicit.

Roles: `ml`, `backend`, `frontend`, `privacy`, `evaluation`, `codebase`, `database`, `git`, `Lead`.

---

## Task log

| # | Date | Task | Status | Owners | Pointer |
|---|---|---|---|---|---|
| 2.8 | 2026-08-28 | Live face redaction before any VLM call | **FIXED in code** (Chrome unpacked E2E still manual) | ml, backend, frontend, privacy, eval | specialist `work_done.md` files; harness 31/31 |
| 2.9 | 2026-08-28 | Live NER redaction for names, places, orgs | **FIXED in code** (Chrome unpacked E2E still manual) | ml, backend, frontend, privacy, eval | specialist `work_done.md`; harness 27/27; face 31/31 |
| 3.1–3.6 | 2026-08-28 | Demo pack: session API key, fail-closed audit, dynamic DOM, omit URL/title, popup preview, Chrome E2E | **Code+harness done; Chrome E2E not run** | backend, frontend, database, privacy, eval | `privacy-payload.test.js` 31/31; eval `work_done.md` manual steps |
| INIT | 2026-08-28 | Chrome-for-Testing INIT timeout before VLM | **FIXED in code** (manual Run Agent owed) | ml, backend, frontend, eval | specialist `work_done.md`; face 36/36, NER 27/27, privacy 32/32 |
| 2.10 | 2026-08-28 | Post-reload content-script disconnect on file:// | **FIXED in code** (manual Reload+Run Agent owed) | backend, frontend, privacy, eval | specialist `work_done.md`; inject harness 39/39; privacy 36/36 |
| WASM | 2026-08-28 | ORT WASM `.mjs` dynamic import in module worker | **FIXED in code** (manual Reload+Run Agent owed) | ml, backend, frontend, privacy, eval | specialist `work_done.md`; face 45/45, NER 28/28, privacy 38/38 |
| 4.1 | 2026-08-29 | `[UNKNOWN] Unexpected token 'S'` — JSON errors had no error class | **FIXED in code** | lead, backend, eval | backend `work_done.md`; sanitize-action 35/35 |
| 4.2 | 2026-08-29 | Problem 4 (The Hand): click missed on every HiDPI display | **FIXED in code**, harness-proven vs pre-fix file | lead, frontend, eval | frontend `work_done.md`; execute-action 38/38 |
| 4.3 | 2026-08-29 | Problem 3: free-form prompt ("Summarize this") unsupported | **FIXED; measured live** 54.7s cold / 1.3–1.6s warm | lead, backend | backend `work_done.md` |
| 4.4 | 2026-08-29 | 629 MB extension in `chrome://extensions` | **FIXED** — `dist/` 15 MB, 19/19 manifest paths | lead, codebase | codebase `work_done.md`; `scripts/build-dist.sh` |
| 4.5 | 2026-08-29 | NER pulls ~89 MB from HF+jsdelivr on a fail-closed gate | **OPEN RISK** (measured, not fixed) | lead, ml | this file, Risks |

---

## 2026-08-28 — Task 2.8: live face redaction before VLM

### Decision
Face redaction is a hard gate on the live path. `handleCaptureAndSanitize` must not `fetch(vlmEndpoint)` until local BlazeFace pixelation has completed (or the user opted out via `faceDetection === false`). Fail closed if the model is unavailable.

### Why
Architecture: Browser Screen → Local Perception → Detection → Local Redaction → Sanitized Context → VLM. FR-03/FR-05: faces masked on an offscreen canvas before any network request. A payload mismatch + fail-open empty arrays + missing `blaze.onnx` meant unredacted live frames could leave the device.

### Data flow
`captureVisibleTab` → offscreen `SANITIZE` (DETECT_FACES with `imageData` **and** `imageDataUrl`) → `facePassComplete` → `assertReadyForVlm()` → `fetch(vlmEndpoint)` with `sanitizedImage` only.

### Risks
- No live Chrome unpacked-extension E2E in this environment.
- User opt-out (`faceDetection === false`) skips the layer by design.
- BlazeFace can miss small faces (~<5% of frame).
- Finding D (full URL/title to VLM) unchanged. NER call-site bug is closed in task 2.9.

### SIH impact
Closes a critical privacy defect (raw faces on the VLM image). Redaction precision now has an ordering invariant that eval can measure in-harness.

### Implementation tasks (done)
See `engineers/ml/work_done.md`, `engineers/backend/work_done.md`, `engineers/frontend/work_done.md`, `engineers/privacy/work_done.md`, `engineers/evaluation/work_done.md`.

### Acceptance criteria
- Harness `eval/harness/face-redaction-before-vlm.test.js` **31/31**.
- Regression: `sanitize-action.test.js` 13/13, `normalize-profile.test.js` 13/13.
- Manual remaining: load unpacked extension → Run Agent on a tab with a visible face → receipt `faces > 0` or `FACE_REDACTION_REQUIRED` block.

---

## 2026-08-28 — Standing rule: record every completed task

User instruction: whenever a task completes, write it into the engineer folder files. Created `engineers/Lead/work_done.md` (this file) and `.cursor/rules/engineer-work-logs.mdc` so the orchestrator and every specialist session append to the matching `work_done.md` and update team-memory. Git/database/codebase follow-ups for 2.8 logged in those roles' files this same pass.

---

## 2026-08-28 — Task 2.9: live NER redaction for names, places, orgs

### Decision
NER for PER/ORG/LOC is a hard gate on the live path, same fail-closed philosophy as faces. `assertReadyForVlm` requires `nerPassComplete` when `piiDetection` is enabled. Entity strings are stripped from field labels before the VLM JSON.

### Why
FR-04/FR-05: DistilBERT on visible DOM text; regions masked before any network request. `aggregation_strategy: 'simple'` was passed to `pipeline()` construction; transformers.js v4.2.0 ignores it there, so BIO tags had no `entity_group` and every name/place/org was dropped. Offscreen then fail-opened to the VLM.

### Data flow
`extractVisibleText()` (DOM `innerText`, no OCR) → DETECT_NER (call-site aggregation) → canvas mask + `nerPassComplete` → `redactNerSpansInFields()` → `assertReadyForVlm()` → `fetch(vlmEndpoint)`.

### Risks
- No live Chrome + Hugging Face NER E2E here. Cold load ~11s; DETECT_NER timeout is 60s.
- `piiDetection === false` skips NER (user opt-out; default `true`).
- Names that exist only as pixels in a photo are not covered by NER (faces still are).
- Entity bbox is the parent element rect (over-blur, by design).
- Finding D (URL/title) unchanged. User profile in the system prompt is intentional form-fill data.

### SIH impact
Closes the critical defect that live names/orgs/places never reached the mask layer. Harness can now measure the ordering invariant.

### Implementation tasks (done)
See ml, backend, frontend, privacy, evaluation `work_done.md`.

### Acceptance criteria
- `eval/harness/ner-redaction-before-vlm.test.js` **27/27**.
- Face harness still **31/31**. `sanitize-action` 13/13, `normalize-profile` 13/13.
- Manual remaining: page with a visible name, org, and place → receipt `piiSpans > 0` or `NER_REDACTION_REQUIRED` if the model cannot load.

---

## 2026-08-28 — Demo pack (tasks 3.1–3.6)

### Decision
Ship judge-ready privacy + demo surfaces without a Raw Screen → VLM path: session-scoped VLM API key, fail-closed frames, dynamic DOM overlay, no URL/title in the VLM JSON, popup loading/preview/receipt.

### Owners
backend (auth, payload, gate), frontend (popup + MutationObserver), database (storage contract), privacy + eval (tests + Chrome probe).

### Status
**FIXED in code / harness.** Chrome unpacked E2E **not** completed on this machine (headless `--load-extension` hung; killed after 45s).

### Remaining risks
See evaluation `work_done.md` manual steps. Session API key is RAM-only (cleared on browser close) — not OS keychain. `lastReceipt` still stores the tab URL locally (not sent to VLM).

### SIH impact
Closes Finding D for the VLM payload, implements the F-11 session-key guardrail, and gives judges a visible sanitized preview + receipt.

### Acceptance
`privacy-payload.test.js` 31/31; face 31/31; NER 27/27; sanitize-action 13/13; normalize-profile 13/13.

---

## 2026-08-28 — INIT timeout before VLM (Chrome for Testing)

### Decision
Treat `[TIMEOUT] Worker request "INIT" timed out after 20000ms` as a **worker ready-path** bug, not a VLM/Ollama bug. Prefer a smaller WASM binary + fail-fast errors + progress UI over only raising the timeout. Face/NER fail-closed gates stay.

### Owners
ml (ORT bundle, lazy transformers, BlazeFace load), backend (offscreen INIT, onerror, classifyError), frontend (popup progress), evaluation (harness re-run).

### Status
**FIXED in code / harness.** Real Chrome-for-Testing Run Agent **not re-run in this session**.

### Remaining risks
- First-run 13MB WASM compile can still be slow; 90s is a bound, not a measured p99.
- NER still downloads from Hugging Face after INIT; DETECT_NER timeout remains 60s.
- Transformers.js inlined ORT may still fetch WASM from jsdelivr (not vendored asyncify files).
- `file://` + Allow access to file URLs is required for content-script scan; it does not cause INIT (offscreen is extension-origin).

### SIH impact
Unblocks Run Agent on Load-unpacked / Chrome for Testing so the live redaction → VLM loop can actually start.

### Acceptance
face **36/36**, NER **27/27**, privacy **32/32**. No commit (not requested).

---

## 2026-08-28 — Kitchen-sink test form for manual redaction + fill

### Decision
Add **TP08** as the preferred manual E2E page: one scholarship form with a left-side “signed-in” card (face + visible PII for redaction) and an empty main form whose labels match a synthetic profile (for fill), plus fields deliberately missing from the profile (hallucination traps). Do **not** put Aadhaar/PAN in the profile fixture.

### Owners
evaluation (fixture + ground truth); Lead (scope)

### Status
**Fixtures landed.** Live Chrome Run Agent on TP08 not measured in this session.

### Remaining risks
Same as prior Chrome E2E blockers (file URL access, model INIT). Face asset is a stock photo, not an Indian applicant likeness — fine for BlazeFace smoke, not for “realistic persona” screenshots in the pitch.

### SIH impact
Unblocks a single-page demo/test path for judges and developers without stitching tp01–tp07.

### Pointer
`engineers/evaluation/work_done.md` — “TP08 kitchen-sink…”; files under `eval/test-pages/tp08-*`, `eval/fixtures/dummy-profile-ananya.*`

---

## 2026-08-28 — Post-reload "Receiving end does not exist" (file://)

### Decision
Treat `[UNKNOWN] Could not establish connection. Receiving end does not exist.` as an **orphaned content script** after unpacked Reload — not an offscreen/INIT/VLM failure. Auto-inject via `chrome.scripting.executeScript`, retry once, map lastError to `NO_CONTENT_SCRIPT`, keep face/NER gates.

### Owners
backend (sendTabMessage + classifyError + onInstalled re-inject), frontend (popup copy + content-script guard), privacy (clearance), eval (harness).

### Status
**FIXED in code / harness.** Real Chrome-for-Testing Reload + Run Agent on `tp01-login-form.html` **not re-run in this session**.

### Remaining risks
- Inject cannot bypass Chrome's "Allow access to file URLs" checkbox.
- Restricted schemes (`chrome://`) still require a normal http(s) or file tab.
- Duplicate-listener race if onInstalled inject and retry both succeed in the same world is mitigated by `__AEGIS_CONTENT_SCRIPT__`.
- Badge **Models idle** until first successful CAPTURE reaches offscreen INIT (intentional; not DOM-ready).

### SIH impact
Unblocks Scan page / Run Agent on eval `file://` pages after extension Reload without a silent Chrome port error.

### Acceptance
content-script-inject **39/39**; privacy **36/36**; face **36/36**; NER **27/27**; sanitize-action **13/13**; normalize-profile **13/13**. No commit (not requested).

---

## 2026-08-28 — INIT_FAILED: dedicated Worker has no chrome.* API

### Decision
Do **not** fail-open BlazeFace. The worker crash was `chrome is not defined` at top-level `chrome.runtime.getURL`, not a missing WASM file. Resolve vendor paths with `import.meta.url`. Keep face/NER fail-closed, content-script inject, URL stripping, session API key.

### Owners
ml (worker paths), backend (onerror copy), evaluation (harness + Chrome-for-Testing INIT probe).

### Status
**FIXED in code and measured in Chrome for Testing 152** (`--load-extension`): `INIT_DONE` with `faceModelReady: true`. Full Run Agent → Ollama fill on tp08 still a manual click for the user.

### Remaining risks
- Cold 13MB WASM compile can still be slow; 90s timeout is a bound.
- NER still downloads from Hugging Face after INIT; first DETECT_NER can take ~11s+.
- Local Ollama must be running for fields to fill after redaction.

### SIH impact
Unblocks the demo loop: Run Agent → local redaction → VLM → type profile values.

### Acceptance
face **38/38**, NER **27/27**, privacy **36/36**, content-script-inject **39/39**. Chrome probe: INIT_DONE faceModelReady true. No commit (not requested).

---

## 2026-08-28 — ORT WASM `.mjs` fetch miss after import.meta.url fix

### Decision
Do **not** set `ort.env.wasm.wasmPaths` to a directory string. The vendored file is the WASM-only **bundle** (`ort.wasm.bundle.min.mjs`); a string prefix forces `import()` of `ort-wasm-simd-threaded.mjs` and skips the inlined factory. Use `{ wasm: chrome-less vendor URL }`. Classify leftover backend-miss text as `INIT_FAILED` / `FACE_REDACTION_REQUIRED`, never `[UNKNOWN]`. Keep face/NER fail-closed, no `chrome.runtime.getURL` in the worker, content-script inject, URL strip.

### Owners
ml (wasmPaths object), backend (classifyError + WAR filenames), frontend (existing popup copy), privacy (clearance), eval (harness).

### Status
**FIXED in code / harness.** Live Chrome unpacked Run Agent after this change **not re-run in this session**.

### Remaining risks
- Chrome MV3 still cannot use multi-threaded WASM (no SAB / not crossOriginIsolated).
- Cold 13MB compile; 90s INIT timeout is a bound.
- NER still downloads from Hugging Face after INIT.
- Manual Reload → refresh tab → Run Agent still owed.

### SIH impact
Unblocks on-device BlazeFace compile so Run Agent can redact then fill, instead of dying at WASM glue fetch.

### Acceptance
face **45/45**; NER **28/28**; privacy **38/38**; content-script-inject **40/40**; sanitize-action **13/13**; normalize-profile **13/13**. No commit (not requested).

---

## 2026-08-28 — Sticky overlays + face blur (tp08 user feedback)

### Decision
(1) **Overlays:** lock boxes to live elements via selector + rAF scroll/resize reposition; tokenized keyword match (no `postal_code`⊃`pin`). Wrong Password-on-Phone was drift, not mis-mapping. (2) **Face:** prefetch ORT `wasmBinary` before BlazeFace so INIT cannot fall into `.mjs` dynamic import; after sanitize, wire face overlay (prefer `#applicant-photo`). Fail-closed unchanged.

### Owners
frontend (sticky overlays), ml (wasmBinary), backend (post-sanitize overlay faces), privacy (clearance), eval (harness).

### Status
**FIXED in code / harness.** Live Chrome Reload → refresh → Scan/Run Agent **still owed** (user must re-test).

### Remaining risks
- Cold 13MB WASM compile; 90s INIT bound.
- BlazeFace recall for small faces.
- NER still HF download after INIT.
- MutationObserver rescan clears face overlays until next Run Agent.

### SIH impact
Demo overlays stay on the right fields; Run Agent can actually compile BlazeFace and pixelate Ananya’s photo before VLM.

### Acceptance
face **46/46**; NER **28/28**; privacy **38/38**; content-script-inject **43/43**; sanitize-action **13/13**. No commit (not requested).

---


## 2026-08-28 — Kill ORT blob: dynamic import (INIT_FAILED)

### Decision
Do **not** relax MV3 CSP to allow `blob:` scripts. Patch vendored `ort.min.js` so `to()` always uses the inlined WASM factory and `Kr()` cannot mint blob modules. Keep `numThreads=1`, `proxy=false`, `{ wasm }` paths, `wasmBinary` prefetch, fail-closed face/NER.

### Owners
ml (ort patch + worker lock), backend (classifyError blob: mapping), evaluation (harness + HTTP smoke), privacy (clearance).

### Status
**FIXED in code / harness / HTTP smoke** (`faceModelReady: true`). Unpacked Reload + Run Agent on tp08 still owed to the user (host Chrome `--load-extension` policy-blocked this session).

### Remaining risks
- User must Reload so patched `ort.min.js` is the file Chrome loads.
- Cold 13MB WASM compile; 90s INIT bound.
- NER still HF download after INIT; Ollama must be running for fill.

### SIH impact
Unblocks Run Agent: BlazeFace can compile → pixelate Ananya’s face → VLM → type profile values.

### Acceptance
face **50/50**; NER **28/28**; privacy **38/38**; inject **43/43**; sanitize-action **13/13**; HTTP smoke PASS. No commit (not requested).


---

## 2026-08-29 — MVP audit vs the 4 problems + `[UNKNOWN] Unexpected token 'S'`

### Decision
Audit the codebase against the fixed MVP scope (4 problems) and grading rubric, then close only the gaps that block a live demo. Priority order: Problem 4 (least proven) → Problem 3 → Problems 1+2 → Resource → Latency. Treat the user's new `[UNKNOWN] Unexpected token 'S'` as an **error-taxonomy** defect, not a parser defect, and fix it so no JSON failure can ever again reach the popup anonymously.

### What the `'S'` actually was
`Unexpected token 'S', "S…" is not valid JSON` is V8's `JSON.parse` SyntaxError. `classifyError` matched none of its keywords and hit the terminal `return "UNKNOWN"`, so the popup printed a bare SyntaxError with no stage and no remedy. Every `JSON.parse` in `src/` was already inside a try/catch, so the throw originated below `background.js` (offscreen/worker/vendored transformers) and was re-thrown verbatim by `throw new Error(sanitizeResponse.error)`. Rather than guess the exact site, the taxonomy was fixed so the class of failure is always named.

### Owners
backend (VLM transport, `parseAction`, `classifyError`, system prompt, overlay-clear, `imageSize`), frontend (`executeClick` dpr, `executeType`, popup copy), codebase (lean `dist/`), ml (face recall), evaluation (real-browser E2E).

### Status
**FIXED in code and harness. VLM path measured live against Ollama.** Real-browser Run Agent on tp08 still owed to the user.

### Measured, not claimed

| Thing | Real number | Source |
|---|---|---|
| VLM cold round trip | **54.7 s** | live `qwen2.5vl:7b`, real system prompt extracted from the shipped file |
| VLM warm round trip | **1.30 s / 1.60 s** | same, click and type tasks |
| Extension load root | **654 MB** (`node_modules` 518M, `.opencode` 61M, `src` 41M) | `du -sh` |
| Lean `dist/` | **15 MB**, 19/19 manifest paths resolve | `scripts/build-dist.sh` |
| Dead jsep WASM excluded | **27,797,172 B** | ORT bundle references only `ort-wasm-simd-threaded.wasm` |
| NER model pulled from HF at runtime | **66,944,702 B** | `curl` probe, HTTP 200 |
| ORT WASM pulled from jsdelivr at runtime | **21,649,119 B** | `curl` probe, HTTP 200 |
| Harness total | **246 passed, 0 failed** | 7 suites |

### Risks (ranked by demo impact)
1. **NER pulls ~89 MB from the internet on a fail-closed gate.** No venue network → NER fails → VLM call blocked → nothing works. Highest-severity open item.
2. **54.7 s cold VLM.** Pre-warm Ollama before judging or the first demo click looks hung.
3. **Face pixelation still not visually confirmed in a browser.** BlazeFace loads (`faceModelReady: true`) but recall on a full-viewport frame is suspect — the frame is squashed to 128×128, so a photo becomes ~12 px. Under ml investigation.
4. Ollama returned HTTP 500 "model runner has unexpectedly stopped" on a degenerate image; 16 GB machine with Chrome + WASM models resident is thin on headroom.
5. HiDPI click path is harness-proven but not yet browser-proven (headless reports dpr=1).

### SIH impact
Unblocks the demo loop end to end: a free-form prompt now works (Problem 3), a VLM click can now physically land (Problem 4), a bad model reply is actionable instead of `[UNKNOWN]`, and judges see a 15 MB extension instead of 629 MB (Resource, 20%).

### Pointers
`engineers/backend/work_done.md`, `engineers/frontend/work_done.md`, `engineers/codebase/work_done.md`, `engineers/ml/work_done.md`, `engineers/evaluation/work_done.md`.
