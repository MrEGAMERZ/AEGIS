# 05 — Milestones

**AEGIS: On-device Visual Perception for Light-weight Browser Agents**

---

## Overview

6 phases, each building on the previous. Designed to reach a working demo by end of Phase 5, with Phase 6 for polish and rehearsal.

---

## Phase 1 — Extension Scaffold + Face Detection Baseline (Days 1–2)

**Goal:** A Chrome extension that captures the screen and runs BlazeFace ONNX face detection locally via WASM.

### Deliverables
- [ ] MV3 extension scaffold (service worker, content script, offscreen document)
- [ ] `chrome.tabs.captureVisibleTab()` working from service worker
- [ ] Offscreen document created via `chrome.offscreen.createDocument()`
- [ ] ONNX Runtime Web loaded in offscreen document (WASM backend)
- [ ] BlazeFace ONNX model loaded and cached in Cache API
- [ ] Face detection running on captured screenshot — bounding boxes logged to console
- [ ] Mask rendering: Gaussian blur applied to detected face regions on canvas

### Exit Criteria
- Extension installed in Chrome, clicking action icon captures screen, detects faces, blurs them, outputs sanitized image.

### Dependencies
- None (starting point)

### Risks
- `captureVisibleTab` permission issue in MV3 — mitigate: use `<all_urls>` host permission, not `activeTab` alone
- ONNX model download on first run may be slow — mitigate: Cache API persists weights across sessions

---

## Phase 2 — DOM Detection + NER Pipeline + Combined Masking (Days 2–3)

**Goal:** Full three-layer detection pipeline (DOM + visual + text) with combined mask rendering.

### Deliverables
- [ ] Content script DOM scanner: detects `type="password"`, `autocomplete`, `aria-label` sensitive fields
- [ ] DOM field rects extracted and sent to offscreen document
- [ ] DistilBERT NER model loaded via Transformers.js in offscreen document
- [ ] Regex pre-filters for SSN, phone, email, credit card numbers
- [ ] NER + regex pipeline runs on DOM `innerText` — PII entities detected
- [ ] Combined RedactionMap merging all three detection layers
- [ ] Mask renderer handles all types: blur (faces, PII text), black-fill (password fields)
- [ ] Structural context payload built (sanitized image + page structure JSON)

### Exit Criteria
- Extension correctly blurs faces (visual), black-fills password fields (DOM), and blurs name/location/email text (NER + regex) on Test Page 1 (login form).

### Dependencies
- Phase 1 complete

### Risks
- NER model download (~66MB) is significant — mitigate: lazy-load on first use, show loading state
- Character offset → bounding box mapping for NER text entities is tricky — mitigate: use `Range` API to get pixel positions of text spans

---

## Phase 3 — WebGPU Acceleration + Resource Profiling (Days 3–4)

**Goal:** WebGPU acceleration path working with automatic WASM fallback. Resource metrics collected.

### Deliverables
- [ ] WebGPU backend selection logic (`navigator.gpu.requestAdapter()` check)
- [ ] BlazeFace + NER inference running via WebGPU when available
- [ ] Graceful fallback to WASM when WebGPU unavailable
- [ ] Model weight caching verified (Cache API, ≤150MB total)
- [ ] Resource instrumentation: peak memory, CPU utilization, cache size logged
- [ ] Latency instrumentation: per-stage timing (capture, inference, mask render)

### Exit Criteria
- Extension runs on both WebGPU-enabled and WebGPU-disabled browsers without code changes. Resource numbers are logged and within budget (≤500MB memory, ≤150MB cache).

### Dependencies
- Phase 2 complete

### Risks
- WebGPU support inconsistent across browsers — mitigate: WASM is always the baseline, WebGPU is opt-in optimization only

---

## Phase 4 — Server VLM Integration + E2E Action Loop (Days 4–5)

**Goal:** Full capture → sanitize → VLM → action loop working end-to-end.

### Deliverables
- [ ] Qwen3-VL-8B-Instruct deployed (Ollama for dev, vLLM for production)
- [ ] Structural context payload sent to VLM via OpenAI-compatible API
- [ ] VLM response parsed into action object (click/type/scroll/done)
- [ ] Content script executes actions on live DOM
- [ ] E2E demo task defined: "Fill the login form and submit" (or loan application form)
- [ ] Full loop working: trigger → capture → sanitize → VLM → action → done

### Exit Criteria
- User triggers task, extension captures screen, sanitizes, sends to VLM, VLM returns correct action, extension executes it. Form is filled/submitted without password ever leaving the device.

### Dependencies
- Phases 2 + 3 complete
- Server GPU available for Qwen3-VL deployment

### Risks
- VLM may not correctly interpret sanitized images — mitigate: structural context payload includes page structure metadata (not just image); tune system prompt
- Network latency to VLM server — mitigate: measure and report; local work stays fast regardless

---

## Phase 5 — Benchmark Harness + Test Pages + Metrics (Days 5–6)

**Goal:** Quantified metrics for all 5 scoring criteria. Ground-truth test pages built.

### Deliverables
- [ ] 5 ground-truth test pages built (login, payment, profile, video call, mixed-PII)
- [ ] Annotation JSON files for each test page (known sensitive/non-sensitive positions)
- [ ] Benchmark script runs all test pages and outputs metrics
- [ ] Precision/recall calculated for PII detection
- [ ] Redaction precision and over-redaction rate calculated
- [ ] E2E latency measured across all pages
- [ ] Resource utilization measured (peak memory, cache size)
- [ ] Results saved to `chrome.storage.local` for retrieval

### Exit Criteria
- Benchmark output shows: Visual Accuracy ≥90%, PII Recall ≥85%, Redaction Precision ≥90%, Memory ≤500MB, E2E Latency ≤3s. Results are real, not estimated.

### Dependencies
- Phase 4 complete

### Risks
- NER precision may be lower than 80% on noisy text — mitigate: tune confidence threshold, combine with regex
- Over-redaction may exceed 10% — mitigate: restrict NER masking to high-confidence entities only, add label-exclusion list

---

## Phase 6 — Demo Polish + Pitch Rehearsal (Days 6–7)

**Goal:** Demo-ready extension and rehearsed pitch following the storytelling framework.

### Deliverables
- [ ] Demo scenario finalized: "loan application form" — matches Act 1 hook from pitch framework
- [ ] Extension popup UI showing redaction status (optional but impressive)
- [ ] Benchmark results displayed in a clean summary (for judges to see)
- [ ] Demo rehearsed on a clean machine (not developer's laptop — tests cold start)
- [ ] Backup plan: pre-recorded video of demo in case of live failure
- [ ] Pitch rehearsed with timing (7-8 minute slot, see storytelling framework)
- [ ] Known failure cases documented and honest answers prepared for judge Q&A

### Exit Criteria
- Demo runs successfully on a non-developer machine. Pitch fits within time slot. Team can answer all 5 judge Q&A stress-test questions from the analysis doc.

### Dependencies
- Phase 5 complete

### Risks
- Demo fails on unfamiliar machine — mitigate: WASM baseline always works; test on 2+ different machines
- Judges ask about failure cases — mitigate: have honest, specific answers ready (from Q&A stress-test section of analysis doc)

---

## Timeline Summary

```
Day 1-2:  Phase 1 — Scaffold + Face Detection
Day 2-3:  Phase 2 — DOM + NER + Combined Masking
Day 3-4:  Phase 3 — WebGPU + Profiling
Day 4-5:  Phase 4 — VLM Integration + E2E Loop
Day 5-6:  Phase 5 — Benchmarks + Test Pages
Day 6-7:  Phase 6 — Demo Polish + Rehearsal
```

**Critical path:** Phase 1 → Phase 2 → Phase 4 → Phase 5 (must complete in sequence)
**Parallelizable:** Phase 3 can overlap with Phase 4 (WebGPU opt while VLM integration happens)

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| VLM cannot interpret sanitized images | Medium | High | Rich structural context payload; tune system prompt; test early |
| NER recall <85% on real-world text | Medium | Medium | Tune confidence threshold; regex covers high-value structured PII regardless |
| WebGPU unavailable on demo machine | Low | Low | WASM is the baseline; WebGPU is bonus |
| Cold start >5s (model download) | Medium | Medium | Pre-cache models before demo; show loading progress |
| Over-redaction breaks agent understanding | Medium | High | Restrict NER to high-confidence; exclusion list for common non-PII words |
| `captureVisibleTab` permission rejected | Low | High | Use `<all_urls>` host permission; test on clean profile |
| Judge asks to demo on unseen page | High | Low | Built-in generalization test pages; have protocol ready |
