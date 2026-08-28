# Aegis — Master Task Board

**How this works:**
- Tasks are listed by phase. Only Phase 1 is expanded into engineer prompts.
- When a phase is complete, report back. The next phase unlocks with full prompts.
- Every task has an owner (engineer role). Cross-team dependencies are noted.
- Nothing is marked complete until it has been tested, not just written.

---

## CURRENT STATUS

**Phase 1 — IN PROGRESS**
All other phases locked until Phase 1 is reported complete.

---

## PHASE 1 — Foundation (Current)

Goal: Extension runs, masks are positioned correctly, VLM server is reachable.
Without this, nothing else can be tested.

| # | Task | Owner | Depends On | Status |
|---|---|---|---|---|
| 1.1 | Build tooling: vendor bundle onnxruntime-web + transformers.js into src/vendor/ | Frontend | — | ☐ |
| 1.2 | Wire inference.worker.js into offscreen.js (postMessage bridge) | ML | 1.1 | ☐ |
| 1.3 | Fix devicePixelRatio coordinate mapping for all mask types | Privacy | — | ☐ |
| 1.4 | VLM server up: Ollama running Qwen3-VL-8B, endpoint smoke-tested | Backend | — | ☐ |
| 1.5 | Verify DOM password-field masking works end-to-end on tp01-login-form.html | Evaluation | 1.3 | ☐ |

---

## PHASE 2 — Core ML Models (Locked)

| # | Task | Owner |
|---|---|---|
| 2.1 | BlazeFace ONNX: full pipeline (download → cache → preprocess → infer → decode anchors → DPR rescale) | ML |
| 2.2 | DistilBERT NER: full pipeline (transformers.js pipeline → chunk text → entity spans → DOM rects) | ML |
| 2.3 | Model weight caching via Cache API (ETag-based invalidation) | ML + Privacy |
| 2.4 | Combined RedactionMap: merge DOM + face + regex + NER detections | ML + Privacy |

---

## PHASE 3 — Evaluation Infrastructure (Locked)

| # | Task | Owner |
|---|---|---|
| 3.1 | Write ground-truth JSON for tp02 through tp07 | Evaluation |
| 3.2 | Implement eval-harness.js DOM-layer evaluation (TP/FP/FN for DOM + regex) | Evaluation |
| 3.3 | Implement eval-harness.js face + NER evaluation once models are live | Evaluation |
| 3.4 | Latency instrumentation: per-stage timing logged to console | Evaluation |
| 3.5 | Memory instrumentation: peak JS heap logged at inference time | Evaluation |

---

## PHASE 4 — VLM Integration & E2E Loop (Locked)

| # | Task | Owner |
|---|---|---|
| 4.1 | Structural context payload: validate no sensitive values leak into payload | Privacy |
| 4.2 | VLM prompt tuning: test system prompt against sanitized tp03 (face+name page) | Backend |
| 4.3 | Action executor hardening: validate x,y bounds before click, handle missing selector | Backend |
| 4.4 | Full E2E demo task on tp01: trigger → capture → sanitize → VLM → click Submit | All |
| 4.5 | ensureOffscreen(): replace boolean flag with chrome.runtime.getContexts() check | Privacy |
| 4.6 | MutationObserver re-detection trigger (password field appearing dynamically) | Frontend |

---

## PHASE 5 — Demo Polish & Rehearsal (Locked)

| # | Task | Owner |
|---|---|---|
| 5.1 | Popup: add live redaction count display (faces N, passwords N, PII N) | Frontend |
| 5.2 | Popup: add sanitized image preview thumbnail | Frontend |
| 5.3 | Benchmark runner: test on tp01–tp07, produce metrics JSON | Evaluation |
| 5.4 | Cold start test on a clean Chrome profile (not developer machine) | All |
| 5.5 | Demo rehearsal: run the full loan-form scenario from zero | All |
| 5.6 | Pre-record video backup of working demo | All |

---

*Phase prompts unlock sequentially. Report phase complete → next phase prompts issued.*
