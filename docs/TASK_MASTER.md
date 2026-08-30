# Aegis — Master Task Board

**How this works:**
- Tasks are listed by phase. Only Phase 2 is expanded into engineer prompts.
- When a phase is complete, report back. The next phase unlocks with full prompts.
- Every task has an owner (engineer role). Cross-team dependencies are noted.
- Nothing is marked complete until it has been tested, not just written.

---

## CURRENT STATUS

**Phase 1 — COMPLETE**
**Phase 2 — IN PROGRESS (2-Day MVP Deadline - STRICT SCOPE)**

---

## PHASE 1 — Foundation (Complete)
- [x] 1.1 Build tooling: vendor bundle onnxruntime-web + transformers.js
- [x] 1.2 Wire inference.worker.js into offscreen.js
- [x] 1.3 Fix devicePixelRatio coordinate mapping
- [x] 1.4 VLM server up
- [x] 1.5 Verify DOM password-field masking works end-to-end

---

## PHASE 2 — Core MVP (Current - 2 Days)

Goal: Implement the baseline ML inference for face/text redaction and wire up a simple, non-personalized VLM action loop. (NO RAG/PROFILE LOGIC).

| # | Task | Owner | Depends On | Status |
|---|---|---|---|---|
| 2.1 | BlazeFace ONNX: full pipeline (download → preprocess → infer → DPR rescale) | ML | — | ☐ |
| 2.2 | DistilBERT NER: full pipeline (transformers.js pipeline → entity spans → DOM rects) | ML | — | ☐ |
| 2.3 | Baseline VLM Integration: Send redacted image + raw DOM to server, execute basic returned actions | Backend | — | ☐ |
| 2.4 | Extension UI: Simple On/Off toggle and status indicator (No Profile Setup) | Frontend | — | ☐ |
| 2.5 | End-to-End Evaluation & Tabular Report: Test basic redaction + action loop | Evaluation | 2.1, 2.2, 2.3 | ☐ |

---

## PHASE 3 — Demo Polish & Rehearsal (Locked)
- Benchmark runner tests, cold start tests, pitch recording.

---

## PHASE 4 — Future Scope (Pitch/Research Only - DO NOT BUILD)
- 4.1 Progressive RAG Profile (Learning user data over time)
- 4.2 Extract-and-Discard Local Document Parsing (PAN/Licence OCR)
