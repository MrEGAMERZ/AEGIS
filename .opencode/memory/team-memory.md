# Team Memory — Aegis (SIH26171)

Shared persistent state for the Aegis engineer team. **Loaded into every session automatically.**
Updated by the Lead when delegating/completing work, and by each engineer when a task finishes.
Keep this file lean — an appendix only, never a transcript.

## Current Status

- Phase 1: COMPLETE (scaffold, inference worker wiring, DPR coordinate mapping, VLM server, DOM password masking)
- Phase 2: IN PROGRESS (2-day MVP deadline)
- Last phase report: backend-engineer (Task 2.6 — hallucination fix, see below)

## Active Tasks

| # | Task | Owner | Status | Measured result |
|---|---|---|---|---|
| 2.1 | BlazeFace ONNX full pipeline | ml-engineer | **VERIFIED** | **3.9ms** WASM warm (measured, N=20). `/255`+CHW preproc confirmed; single output `selectedBoxes[1,N,16]`, NMS in graph. Parser fixed (was reading phantom 2nd output). |
| 2.2 | DistilBERT NER full pipeline | ml-engineer | Working; latency unmeasured | Filters PER/ORG/LOC>0.8, bbox→parent rect. Fixed null-rect guard (no crash, no `bbox:null`). Latency blocked: needs real browser first-run model cache. |
| 2.3 | Smart Form-Fill Profile (RAG) | backend-engineer | Working, missing-data gap **closed via 2.6** | prompt injects real `key: value` pairs via `normalizeProfile()` (verified 16/16 node checks + independently re-verified 13/13 by eval-engineer); action safety hardened, now including the 2.6 anti-hallucination `profileKey` guard on `"type"` actions (deterministic, see 2.6) |
| 2.4 | Progressive Setup UI | frontend-engineer | Working (2.3 unblocked) | `userProfile` saved as JSON object; parse order JSON → `Key: value` → `{"notes": ...}`; endpoint default now `:11434` |
| 2.5 | E2E Evaluation & tabular report | eval-engineer | **PARTIAL-WITH-CONDITIONS** (re-verified 2026-08-28) | Original char-index bug: **fixed, independently verified** (13/13 unit tests + live Ollama `qwen2.5vl:7b` test — old prompt reproduces the crash, new prompt doesn't). NOT a clean pass: (1) the fix is currently staged but **still uncommitted** on `main` — **awaiting explicit user go-ahead to commit** (git-engineer has a proposed commit plan; Lead does not commit without being asked); (2) new hallucination gap found (2.6); (3) no real browser+extension E2E (sandbox has no Chrome); (4) full privacy pass on profile flow still owed. |
| 2.6 | VLM hallucinates on missing profile data instead of refusing | backend-engineer | **FIXED — deterministic, measured** | Reproduced eval-engineer's finding live first (2/3 cases hallucinated, confirmed unchanged). Fix: `sanitizeAction()` now rejects any `"type"` action whose `profileKey`+`value` can't be independently verified against the real, current `userProfile` (+ field-label correlation to catch a real value attached to the wrong field) — fails closed, code-level guarantee, not prompt-only. Supporting prompt change: explicit `AVAILABLE PROFILE KEYS` allowlist + required `profileKey` self-report. **Measured after, live model, 2 full runs (20 missing-data trials total):** raw model hallucination unchanged (9/20, 40-50% — expected, not claimed fixed), but **unsafe execution 0/20 (0%)**, down from 2/2 (100%) before the fix — every unverifiable value deterministically rejected. Code-level regression suite `eval/harness/sanitize-action.test.js` (13/13, tests the real `background.js` via sandboxed VM) + extended `eval/test_rag_form_fill.py` (`HARDENED-A/B/C`, eval-engineer's original 3 cases untouched). Details: `engineers/backend/work_done.md`. **Lead independently re-ran `eval/harness/sanitize-action.test.js` — confirmed 13/13 pass against the real file, not a summary.** |
| 2.7 | Inference worker INIT in real Chrome (Load-unpacked / Chrome for Testing) | ml + backend + frontend + eval | **FIXED in code** (manual Run Agent owed after WASM `.mjs` follow-up) | `chrome is not defined` at `getURL` was fixed via `import.meta.url`. **Follow-up:** directory-string `wasmPaths` forced `import()` of `ort-wasm-simd-threaded.mjs` → `[UNKNOWN] no available backend`. Fix: `{ wasm: vendor .wasm URL }` so the inlined factory in `ort.wasm.bundle.min.mjs` is used. Harness: face **45/45**, NER **28/28**, privacy **38/38**, inject **40/40**. |
| WASM | ORT WASM `.mjs` / `blob:` dynamic import in the module worker | ml + backend + frontend + privacy + eval | **FIXED in code** (manual Reload+Run Agent owed) | Directory-string `wasmPaths` skipped inlined factory; residual `blob:` import killed by patched `ort.min.js` (`to`/`Kr`). `classifyError` maps backend-miss / blob → `INIT_FAILED`. HTTP smoke faceModelReady true. |
| 2.10 | Post-reload content script on file:// eval pages | backend + frontend + privacy + eval | **FIXED in code** (manual Reload+Run Agent owed) | After INIT-timeout Reload, popup showed `[UNKNOWN] Could not establish connection. Receiving end does not exist.` Badge **Models idle** (INIT never started). Root: orphaned content script after unpacked Reload; `DOM_SCAN` failed; `classifyError` unmapped. Fix: `sendTabMessage` inject+retry once, `NO_CONTENT_SCRIPT`, `file://*/*` match, onInstalled re-inject. Harness: inject **39/39**, privacy **36/36**, face **36/36**, NER **27/27**. |
| 2.8 | Live face redaction must complete before any VLM call | lead + ml/backend/frontend/privacy/eval | **FIXED in code** (browser E2E still manual) | Root cause: offscreen sent `{ imageData }`, worker read `payload.imageDataUrl`; errors fail-opened to `[]`; `blaze.onnx` missing on main. Fix: dual payload + fail-closed `FACE_MODEL_UNAVAILABLE` + `assertReadyForVlm()` gate before `fetch`. Harness `eval/harness/face-redaction-before-vlm.test.js` **31/31**. Logged in specialist `work_done.md` files + `engineers/Lead/work_done.md`. |
| 2.9 | Live NER redaction for names, places, orgs before VLM | lead + ml/backend/frontend/privacy/eval | **FIXED in code** (browser E2E still manual) | Root cause: `aggregation_strategy` on `pipeline()` construction (no-op in transformers.js v4.2.0) so `entity_group` was missing and every PER/ORG/LOC was dropped. Fix: call-site aggregation + `NER_MODEL_UNAVAILABLE` fail-closed + `nerPassComplete` + `redactNerSpansInFields()`. Harness `eval/harness/ner-redaction-before-vlm.test.js` **27/27**; face harness still **31/31**. Logged in specialist `work_done.md` + `engineers/Lead/work_done.md`. |
| 3.1 | Hosted VLM / Gemini API key (session only) | backend, frontend, database, privacy | **FIXED in code** | `chrome.storage.session.vlmApiKey`; Bearer on non-localhost; localhost Ollama unauthed. Never `storage.local`. |
| 3.2 | Never send a frame if redaction models failed | backend, privacy, eval | **Re-audited, still gated** | Error response is `{error,errorCode}` only. Face 31/31, NER 27/27, privacy 31/31. |
| 3.3 | Re-detect sensitive fields on DOM mutation | frontend | **FIXED in code** | Debounced MutationObserver 400ms; overlay only; no VLM. |
| 3.7 | Sticky overlays + face blur on tp08 (user feedback) | frontend + ml + privacy + Lead | **FIXED in code** (manual Reload+Run Agent owed) | Overlays: live element anchors + rAF scroll/resize (drift caused Password-on-Phone). Face: prefetch ORT `wasmBinary` so INIT skips `.mjs` import(); post-sanitize face overlay prefers `#applicant-photo`. Harness: face **46/46**, NER **28/28**, privacy **38/38**, inject **43/43**. |
| 3.8 | ORT `blob:` dynamic-import INIT_FAILED (Chrome MV3 CSP) | ml + backend + privacy + eval + Lead | **FIXED in code** (manual Reload+Run Agent owed) | Root: unpatched ORT `Kr()`→`import(blob:…)` rejected by MV3 CSP even after `{ wasm }`/`wasmBinary`/`numThreads=1`. Fix: patch `ort.min.js` (`to()` always inlined factory; `Kr` disabled) + `lockOrtWasmSingleThread()`. HTTP smoke: **INIT_DONE faceModelReady=true** (~2s). Harness: face **50/50**, NER **28/28**, privacy **38/38**, inject **43/43**. |
| 3.4 | Strip URL/title from VLM payload (Finding D) | backend, privacy | **FIXED in code** | `buildPageStructureForVlm` omits url/title (now also emits `imageSize`; still no url/title). |
| 4.1 | `[UNKNOWN] Unexpected token 'S'` after BlazeFace went green | lead + backend + eval | **FIXED in code; VLM path measured live** | Root: V8 `JSON.parse` SyntaxError text matched no `classifyError` keyword → fell through to terminal `return "UNKNOWN"`. Defect was the error taxonomy, not the parser. Fix: `requestVlmContent()` (HTTP body surfaced, e.g. Ollama "model runner has unexpectedly stopped"), `VLM_BAD_RESPONSE`, terminal `BAD_JSON`, `safeExcerpt()` strips base64. `parseAction` now balanced-brace + fence + curly-quote tolerant; **`sanitizeAction`/`profileKey` guard byte-for-byte unchanged**. Bounded single retry at temp 0. Harness: sanitize-action **35/35** (22 new prose/fence cases). |
| 4.2 | Problem 4 (The Hand) — click missed on every HiDPI display | lead + frontend + eval | **FIXED in code; harness-proven** | Root: VLM answers in the capture's PHYSICAL px (CSS×dpr); `elementFromPoint` takes CSS px. On dpr=2 any x past the CSS viewport width returned `null` — right half of the screen was unclickable. Fix: scale by dpr, fall back to raw frame, skip html/body, climb to nearest clickable via `closest()`. New `eval/harness/execute-action.test.js` **38/38**; run against pre-fix `content.js` it reports **25 passed / 13 failed** incl. `{"error":"No element at (1200, 400)"}`. |
| 4.3 | Problem 3 — free-form chat prompt (summarize / click) | lead + backend | **FIXED in code; measured live** | System prompt was form-fill-only ("strict form-fill agent"), routing every non-profile task to the canned "Profile missing information". Rewritten as a general browser agent, profile rules scoped to `type` only. Live `qwen2.5vl:7b`: `Summarize this page` → `{"action":"done","summary":"A form page with a text input field for 'Full Name'…"}` **54.7s cold / 1.3–1.6s warm**. Prompt defect found+fixed: model echoed the example `x:512,y:880` verbatim (out of bounds); example neutralised and `pageStructure.imageSize` added. |
| 4.4 | Extension shows as 629 MB in chrome://extensions | lead + codebase | **FIXED — lean `dist/` build** | Load root was the repo (654 MB: node_modules 518M, .opencode 61M, src 41M, graphify-out 4.4M). `scripts/build-dist.sh` hardlinks only runtime files → **15 MB measured**, all 19 manifest paths verified resolvable. Excludes dead `ort-wasm-simd-threaded.jsep.wasm` (27.8 MB) — WASM-only ORT bundle references only `ort-wasm-simd-threaded.wasm`. |
| 4.5 | NER downloads ~89 MB from the internet at demo time | lead + ml | **OPEN RISK — measured, not fixed** | `allowLocalModels=false` → DistilBERT `model_quantized.onnx` **66,944,702 B from huggingface.co** + ORT WASM **21,649,119 B from jsdelivr**, on a **fail-closed** gate. No network at the venue = NER fails = VLM call blocked = demo dead. Both hosts returned HTTP 200 when probed 2026-08-29. Mitigation: warm the browser cache before judging, or vendor the model. |
| 3.5 | Loading state, sanitized preview, privacy receipt | frontend | **FIXED in code** | Pipeline steps + preview of `sanitizedImage` + existing receipt. |
| 3.6 | Prove client loop on eval pages in real Chrome | eval | **PARTIAL** — worker INIT now works in Chrome for Testing; full popup Run Agent → Ollama fill not driven | `--load-extension` INIT probe: `faceModelReady: true`. Prefer **TP08** + `dummy-profile-ananya.json`. User must Reload extension, refresh the tab, Run Agent. See evaluation `work_done.md`. |

## Team (8 subagents + lead)

`ml-engineer`, `backend-engineer`, `frontend-engineer`, `privacy-engineer`, `eval-engineer`, `codebase-maintainer` (new), `db-engineer` (new, owns storage contract), `git-engineer` (new, owns commit hygiene).

## Active Decisions

- **Privacy boundary:** browser is the enforcement point; backend receives only sanitized context. Never add a Raw Screen → Backend path.
- **Runtime:** WASM is the baseline; WebGPU is a bonus optimization only.
- **Redaction layers:** DOM-native signals (password/autocomplete) over CV when reliable; NER limited to high-confidence entities to avoid over-redaction.
- **VLM:** Qwen3-VL-8B-Instruct; structured action output validated before browser execution.

## Repo Research (lead, 2026-08-28)

- Survey complete → `docs/07_EXTENSION_REPO_RESEARCH.md` (registered in `docs/00_INDEX.md`).
- Tier-1 deep dives: `nico-martin/gemma4-browser-extension` (HF blog guide; background = single coordinator, typed message enums, `webMcp` tool schema, IndexedDB state) and `JaySmith502/PiiI` (regex+Named Entity Recognition dual-detector, alias map + audit log + whitelist, fail-closed file scan).
- Tier-2: openbrowse (offscreen inference), tantara/transformers.js-chrome (WebGPU + model-unload + TPS), infosetGR/AIFormFiller + hddevteam/smart-form-filler (RAG form-fill), Clearform-Labs/Redact (quantized MiniLM, BLOCK/WARN), Governs-AI/pii-guard (offscreen OCR), omkar-2882 + cikinodapz (rule-first AI-second), best-practices (MV3 hygiene).
- Top steal-patterns: (1) shared typed message contract, (2) rule-first/AI-second fill + per-site mapping cache, (3) alias map + BLOCK/WARN + audit log, (4) model telemetry/unload, (5) origin-bundled models, (6) offscreen OCR, (7) per-site adapters.
- Draft rebuild parts R1–R4 in report §6 — **awaiting user approval before dispatch.**

## Blockers

- No open blockers. (Update here as they appear.)

## Dispatch Log — 2026-08-28 (Lead, live parallel run)

Dispatched 6 subagents in parallel (via Cursor Task tool, running the exact `.opencode/agent/*.md` persona prompts, since `opencode run --agent <subagent>` cannot invoke a subagent directly from the CLI — only a primary agent's own Task tool can):

| Agent | Task | Status |
|---|---|---|
| ml-engineer | Measure DistilBERT NER latency (2.2 blocker) via headless-browser benchmark | dispatched |
| eval-engineer | Re-run E2E gate (2.5) now that the `userProfile` bug (2.3/2.4) is fixed | dispatched |
| privacy-engineer | Re-audit current state; verify F-11 (VLM endpoint stored unencrypted) status | dispatched |
| db-engineer | Formalize `chrome.storage.local` schema contract + recommend F-11 remediation | dispatched |
| git-engineer | Repo-hygiene audit of current large diff; propose commit grouping (no commits) | dispatched |
| codebase-maintainer | Sweep `src/` for stale code/comments left over from Phase 2 work | dispatched |

### Mid-run correction (Lead)

db-engineer correctly found `userProfile`/`normalizeProfile`/`sanitizeAction` **absent** from `src/background/background.js` and `src/popup/popup.js` — this was NOT a stale report from backend/frontend, it was a second instance of the same checkpoint-recovery gap that had already hit `.opencode/`/`engineers/` (commit `0b06663` on `cursor/remove-ds-store-files` had the real code; it just hadn't been restored to `main`'s working tree yet). Restored `background.js`, `popup.js`, `popup.html`, `inference.worker.js` from that commit — verified present now (12 refs in background.js, 7 in popup.js). Updated `docs/STORAGE_CONTRACT.md` and `engineers/database/work_done.md` to reflect the resolution.

privacy-engineer and codebase-maintainer independently hit the exact same pre-restore snapshot (their reads happened before the restore above landed) and each raised it as a Critical finding — both correctly and honestly, from what they could see. Corrected both `engineers/privacy/work_done.md` (Findings B/C/E resolved — BlazeFace/NER/`sanitizeAction` are real, not stubs; Finding D and the F-11 downgrade still stand) and `engineers/codebase/work_done.md` (the "Critical finding" is resolved; the `popup.js:114` `INIT_DONE`-forwarding TODO is confirmed still genuinely open, unrelated to the recovery gap). eval-engineer's in-flight re-verification should now be checking the real, correct code.

git-engineer's proposed 4-commit plan (see `engineers/git/work_done.md`) predates the `src/` restore and `docs/STORAGE_CONTRACT.md` — it will need a 5th commit group (`[fix] restore Phase 2 src/ implementation` + `[docs] add storage contract`) before anything is actually committed. Not committing anything yet — no commit has been requested.

## Lessons Learned

- **NEVER** claim metrics that were not measured; targets become claims only after measurement.
- Wasting tokens on proof-of-concept models is avoidable — benchmark before selecting.
- 2.3 fix: never `Object.keys()`/`Object.entries()` a value whose runtime type you don't control — always normalize through `normalizeProfile()` first (accepts object, JSON string, or free text). Empty/malformed → `{}` → truthful done-action.

## 2026-08-28 — Live face redaction BEFORE VLM (critical privacy invariant)

| # | Task | Owner | Status | Measured result |
|---|---|---|---|---|
| 2.8 | Live face redaction must complete before any VLM call | lead + ml/backend/frontend/privacy/eval | **FIXED in code** (browser E2E still manual) | Root cause: offscreen sent `{ imageData }`, worker read `payload.imageDataUrl`; errors fail-opened to `[]`; `blaze.onnx` missing on main. Fix: dual payload + fail-closed `FACE_MODEL_UNAVAILABLE` + `assertReadyForVlm()` gate before `fetch`. Harness `eval/harness/face-redaction-before-vlm.test.js` **31/31**. |
| 2.9 | Live NER must redact PER/ORG/LOC before any VLM call | lead + ml/backend/frontend/privacy/eval | **FIXED in code** (browser E2E still manual) | Root cause: `aggregation_strategy` on `pipeline()` construction (no-op in transformers.js v4.2.0) so `entity_group` was missing and every name/place/org was dropped. Fix: call-site aggregation + `NER_MODEL_UNAVAILABLE` fail-closed + `nerPassComplete` gate + label redaction. Harness `eval/harness/ner-redaction-before-vlm.test.js` **27/27**; face harness still **31/31**. |

- **Privacy boundary (unchanged, now enforced):** browser is the enforcement point; VLM receives only `sanitizeResponse.sanitizedImage` after `facePassComplete`. If BlazeFace cannot load, the VLM call is refused (fail closed), not sent with raw faces.
- User toggle `faceDetection === false` still skips the layer (opt-out). Default remains `true`.
- NER (2.9): same pattern for `piiDetection === false`. Default remains `true`. `nerPassComplete` is required before VLM when the layer is on.


## Cross-role Notes

- 2.3 (backend) needs `userProfile` from `chrome.storage.local` produced by 2.4 (frontend popup). Coordinate the key name (`userProfile`) so they match.
- 2.5 (eval) gates 2.1–2.3 as complete; nothing ships without privacy-engineer review.
- Detailed per-engineer work is in `engineers/<role>/work_done.md`. Lead's cross-cutting log is `engineers/Lead/work_done.md`. This file holds only the cross-cutting essence.
- **Standing rule:** every completed task is recorded in the matching `engineers/<role>/work_done.md` (and Lead + this file) before it is called done. See `.cursor/rules/engineer-work-logs.mdc`.