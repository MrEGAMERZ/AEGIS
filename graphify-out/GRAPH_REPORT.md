# Graph Report - SIH26  (2026-08-29)

## Corpus Check
- 86 files · ~103,313 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1303 nodes · 1644 edges · 104 communities (89 shown, 15 thin omitted)
- Extraction: 86% EXTRACTED · 14% INFERRED · 0% AMBIGUOUS · INFERRED: 224 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e4c44d6b`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- ortWasmThreaded
- ortWasmThreaded
- 05 — Milestones
- manifest.json
- eval-harness.js
- execute-action.test.js
- OUTPUT FORMAT
- face-redaction-before-vlm.test.js
- 1. Functional Requirements
- THREAT MODEL
- Aegis — Benchmark Report
- SIH26171 — Backend & AI Agent Engineer
- SIH26171 — QA, Benchmark & Evaluation Engineer
- SIH26171 — Browser Extension Engineer
- SIH26171 — Lead Engineer & System Architect
- regression-tests.js
- Aegis — Evaluation Framework
- test_rag_form_fill.py
- background.js
- c
- ollama
- popup.js
- 🎤 Pitch Storytelling Framework — Aegis
- Git Work Report — Repository Hygiene Audit & Commit Plan Proposal
- offscreen.js
- 🎯 Aegis — Deep Structured Analysis
- ENGINEERING RULES — Aegis
- package.json
- v
- SERVER_SETUP.md
- ML Work Report
- Team Memory — Aegis (SIH26171)
- a
- content-script-inject.test.js
- 2. Ground-Truth Test Page Suite
- Aegis — Storage Contract
- content.js
- /graphify
- 2026-08-28 — Task 2.9: live NER redaction for names, places, orgs
- On-device Visual Perception for Light-weight Browser Agents (SIH26171)
- Evaluation Work Report
- Privacy Work Report
- Output format per cleanup pass
- lead.md
- sanitize-action.test.js
- Aegis — Master Task Board
- 5. BlazeFace ONNX
- 6. Transformers.js
- 7. Ollama
- Codebase Maintenance Work Report
- normalize-profile.test.js
- backend-engineer.md
- eval-engineer.md
- 3. WebAssembly (WASM)
- 4. WebGPU
- ner-redaction-before-vlm.test.js
- frontend-engineer.md
- ml-engineer.md
- privacy-engineer.md
- inference.worker.js
- 2026-08-28 — Demo pack (tasks 3.1–3.6)
- 🧠 Plain-Language Tech Explainer — Aegis
- 1. Chrome Extension (Manifest V3)
- 2. ONNX Runtime Web
- 9. Canvas API
- Backend Work Report
- smoke_test_vlm.py
- db-engineer.md
- Ab
- 2026-08-28 — INIT_FAILED: dedicated Worker has no chrome.* API
- 10. Web Workers
- 8. Qwen-VL / LLaVA (the Vision-Language Model)
- 2026-08-28 — Task 2.8: live face redaction before VLM
- git-engineer.md
- Backend Engineer — Rules & Prompts
- Evaluation Engineer — Rules & Prompts
- Frontend Engineer — Rules & Prompts
- Frontend Work Report
- ML Engineer — Rules & Prompts
- Privacy Engineer — Rules & Prompts
- backend/GLOBAL ENGINEERING RULE — SIH26171.md
- Database & Persistence Work Report
- evaluation/GLOBAL ENGINEERING RULE — SIH26171.md
- frontend/GLOBAL ENGINEERING RULE — SIH26171.md
- Lead/GLOBAL ENGINEERING RULE — SIH26171.md
- ml/GLOBAL ENGINEERING RULE — SIH26171.md
- privacy/GLOBAL ENGINEERING RULE — SIH26171.md
- 2026-08-28 — INIT timeout before VLM (Chrome for Testing)
- privacy-payload.test.js
- 2026-08-28 — Kitchen-sink test form for manual redaction + fill
- 2026-08-28 — Post-reload "Receiving end does not exist" (file://)
- Lead Work Report
- 2026-08-28 — ORT WASM `.mjs` fetch miss after import.meta.url fix
- ort-blob-init-http-smoke.mjs
- ort-blob-init-smoke.mjs
- 2026-08-28 — Sticky overlays + face blur (tp08 user feedback)
- 02 — Architecture
- 2026-08-28 — Kill ORT blob: dynamic import (INIT_FAILED)
- patch_transformers.js
- patch_vlm_json.js
- patch_vlm_stream.js
- build-dist.sh

## God Nodes (most connected - your core abstractions)
1. `ortWasmThreaded()` - 104 edges
2. `wa()` - 93 edges
3. `ortWasmThreaded()` - 81 edges
4. `Oa()` - 74 edges
5. `v()` - 24 edges
6. `v()` - 19 edges
7. `c()` - 14 edges
8. `🧠 Plain-Language Tech Explainer — Aegis` - 14 edges
9. `Lead Work Report` - 14 edges
10. `🎯 Aegis — Deep Structured Analysis` - 13 edges

## Surprising Connections (you probably didn't know these)
- `ortWasmThreaded()` --indirect_call--> `Dc()`  [INFERRED]
  src/vendor/ort-wasm-simd-threaded.jsep.mjs → src/vendor/ort-wasm-simd-threaded.mjs
- `ortWasmThreaded()` --indirect_call--> `Ec()`  [INFERRED]
  src/vendor/ort-wasm-simd-threaded.jsep.mjs → src/vendor/ort-wasm-simd-threaded.mjs
- `wa()` --indirect_call--> `ab()`  [INFERRED]
  src/vendor/ort-wasm-simd-threaded.jsep.mjs → src/vendor/ort-wasm-simd-threaded.mjs
- `wa()` --indirect_call--> `Dc()`  [INFERRED]
  src/vendor/ort-wasm-simd-threaded.jsep.mjs → src/vendor/ort-wasm-simd-threaded.mjs
- `wa()` --indirect_call--> `eb()`  [INFERRED]
  src/vendor/ort-wasm-simd-threaded.jsep.mjs → src/vendor/ort-wasm-simd-threaded.mjs

## Import Cycles
- None detected.

## Communities (104 total, 15 thin omitted)

### Community 0 - "ortWasmThreaded"
Cohesion: 0.05
Nodes (82): Da(), Ra(), ortWasmThreaded(), a(), Aa(), ab(), ac(), ad() (+74 more)

### Community 1 - "ortWasmThreaded"
Cohesion: 0.08
Nodes (50): ortWasmThreaded(), ac(), ad(), $b(), bc(), bd(), $c(), cc() (+42 more)

### Community 2 - "05 — Milestones"
Cohesion: 0.06
Nodes (34): 05 — Milestones, Deliverables, Deliverables, Deliverables, Deliverables, Deliverables, Deliverables, Dependencies (+26 more)

### Community 3 - "manifest.json"
Cohesion: 0.06
Nodes (30): action, default_icon, default_popup, background, service_worker, type, content_scripts, content_security_policy (+22 more)

### Community 4 - "eval-harness.js"
Cohesion: 0.12
Nodes (20): avg(), buildSelector(), buildSummary(), computeAggregateReport(), computeDetectionMetrics(), computePassFail(), EVAL_CONFIG, evalPage() (+12 more)

### Community 5 - "execute-action.test.js"
Cohesion: 0.18
Nodes (8): el(), fs, HTMLInputElement, HTMLTextAreaElement, loadContentScript(), path, source, vm

### Community 6 - "OUTPUT FORMAT"
Cohesion: 0.08
Nodes (23): Browser Compatibility, CONFIDENCE HANDLING, DETECTION TAXONOMY, DO NOT, DOM-sensitive elements, Failure Cases, Latency, Memory (+15 more)

### Community 7 - "face-redaction-before-vlm.test.js"
Cohesion: 0.07
Nodes (25): BACKGROUND_PATH, backgroundSrc, captureIdx, fetchIdx, fs, gateCallIdx, manifest, MANIFEST_PATH (+17 more)

### Community 8 - "1. Functional Requirements"
Cohesion: 0.04
Nodes (41): Aegis — On-device Visual Perception for Light-weight Browser Agents, Evaluation Criteria (5 Explicitly Weighted), Key Technical Decisions (Summary), Planning Documents, Project Overview, Research Documents (from analysis phase), 01 — Requirements, 1. Functional Requirements (+33 more)

### Community 9 - "THREAT MODEL"
Cohesion: 0.10
Nodes (20): Attack Scenario, Current Behavior, Finding, PRIMARY OBJECTIVE, PRIVACY PRINCIPLE, Recommended Fix, REQUIRED OUTPUT, RESPONSIBILITIES (+12 more)

### Community 10 - "Aegis — Benchmark Report"
Cohesion: 0.10
Nodes (20): Aegis — Benchmark Report, Dataset, Detection Metrics (Per Page), Dynamic Detection Results, Environment, Failure Cases, Failure Mode Test Results, False Negatives (Missed PII) (+12 more)

### Community 11 - "SIH26171 — Backend & AI Agent Engineer"
Cohesion: 0.11
Nodes (18): Acceptance Criteria, ACTION SAFETY, API Contract, DO NOT, Failure Modes, Input, Latency, Output (+10 more)

### Community 12 - "SIH26171 — QA, Benchmark & Evaluation Engineer"
Cohesion: 0.11
Nodes (18): Dataset, Environment, Failure, Failure Cases, Functional, Generalization, Interpretation, Performance (+10 more)

### Community 13 - "SIH26171 — Browser Extension Engineer"
Cohesion: 0.11
Nodes (17): Acceptance Criteria, CORE ARCHITECTURE, Data Flow, DO NOT, DOM-AWARE PRIVACY, EVERY IMPLEMENTATION MUST INCLUDE, FAILURE HANDLING, Files Changed (+9 more)

### Community 14 - "SIH26171 — Lead Engineer & System Architect"
Cohesion: 0.12
Nodes (16): Acceptance Criteria, ARCHITECTURE RESPONSIBILITIES, BEFORE APPROVING ANY FEATURE, Data Flow, Decision, DECISION RULE, DO NOT, ENGINEERING PRIORITIES (+8 more)

### Community 15 - "regression-tests.js"
Cohesion: 0.34
Nodes (15): assertEqual(), assertLte(), assertTrue(), cleanup(), getContainer(), inject(), _regressionResults, runRegressionTests() (+7 more)

### Community 16 - "Aegis — Evaluation Framework"
Cohesion: 0.12
Nodes (16): Aegis — Evaluation Framework, Detection, Directory Structure, Engineering Recommendations, Five Evaluation Dimensions, Known Limitations (Current Build v0.1.0), Latency, Memory (+8 more)

### Community 17 - "test_rag_form_fill.py"
Cohesion: 0.18
Nodes (16): build_prompt_buggy(), build_prompt_fixed(), build_prompt_hardened(), call_vlm(), _keys_correlate(), _normalize_key_for_match(), parse_action(), expect: dict describing what a correct action looks like, for scoring. (+8 more)

### Community 18 - "background.js"
Cohesion: 0.11
Nodes (33): ACTION_LIMITS, assertReadyForVlm(), balancedJsonObjects(), buildPageStructureForVlm(), buildVlmAuthHeaders(), describeVlmHttpError(), ensureOffscreen(), escapeRegex() (+25 more)

### Community 19 - "c"
Cohesion: 0.13
Nodes (17): bb(), cb(), db(), Eb(), c(), fb(), Gb(), hb() (+9 more)

### Community 20 - "ollama"
Cohesion: 0.12
Nodes (15): context, output, model, qwen3:8b, models, name, npm, options (+7 more)

### Community 21 - "popup.js"
Cohesion: 0.10
Nodes (15): checkModelStatus(), loadApiKeyStatus(), loadConfig(), loadLastReceipt(), modelStatus, pipelineEl, previewImg, previewWrap (+7 more)

### Community 22 - "🎤 Pitch Storytelling Framework — Aegis"
Cohesion: 0.13
Nodes (14): 🎯 A Closing Line Worth Rehearsing, 🪝 Act 1: The Hook — Make it personal, not abstract, ⚡ Act 2: Raise the stakes — this isn't paranoia, it's already flagged, 🕳️ Act 3: Why hasn't anyone fixed it? (Show you understand the landscape), 💡 Act 4: The reveal — your solution, in plain language first, 🎬 Act 5: The demo — prove it, don't just claim it, 🌍 Act 6: The bigger picture — why this matters beyond your demo, On-device Visual Perception for Light-weight Browser Agents (+6 more)

### Community 23 - "Git Work Report — Repository Hygiene Audit & Commit Plan Proposal"
Cohesion: 0.11
Nodes (18): 1. Current working tree state (ground truth), 2. `.gitignore` coverage check (read-only, verified with `git check-ignore -v`), 3. Secret scan (read-only), 4. Proposed commit plan, 5. Summary for Lead, 6. Addendum — late-arriving file (not covered by the plan above), 7. Addendum — 2026-08-28 after Task 2.8 (still no commits), 8. Addendum — 2026-08-28 after Task 2.9 (still no commits) (+10 more)

### Community 24 - "offscreen.js"
Cohesion: 0.20
Nodes (17): applyPixelation(), canvas, ctx, describeWorkerError(), detectFaces(), detectTextPII(), ensureWorkerReady(), forwardProgress() (+9 more)

### Community 25 - "🎯 Aegis — Deep Structured Analysis"
Cohesion: 0.10
Nodes (21): 10. 🎤 Judge Q&A Stress-Test, 1. 🔎 Pain Points & Core Understanding, 2. ⚙️ Feasibility of Execution, 3. 🌍 Impact & Relevance, 4. 💡 Scope of Innovation (Existing Solutions), 5. 🧩 Clarity of Problem Statement, 6. 🎯 Evaluator's Perspective, 7. 👥 Strategy for Team Fit & Execution (+13 more)

### Community 26 - "ENGINEERING RULES — Aegis"
Cohesion: 0.14
Nodes (13): Before adding a feature, Before calling something complete, Before implementing anything, Before making a technical claim, Enforcement, ENGINEERING RULES — Aegis, Honesty Protocol for the Demo, Rules (+5 more)

### Community 27 - "package.json"
Cohesion: 0.14
Nodes (13): @huggingface/transformers, onnxruntime-web, dependencies, @huggingface/transformers, onnxruntime-web, description, name, private (+5 more)

### Community 28 - "v"
Cohesion: 0.19
Nodes (14): a(), dc(), Ea(), ec(), fc(), Ha(), Kb(), kc() (+6 more)

### Community 29 - "SERVER_SETUP.md"
Cohesion: 0.15
Nodes (11): Endpoint, Extension Configuration, Hardware, Known Limitations, Model, Option Used: Ollama (local, CPU+GPU via Apple Metal), Reproducing on a New Machine, Smoke Test Results (+3 more)

### Community 30 - "ML Work Report"
Cohesion: 0.11
Nodes (17): 2026-08-28 — INIT_FAILED: `chrome is not defined` in dedicated module Worker, 2026-08-28 — INIT timeout in Chrome for Testing (BlazeFace load path), 2026-08-28 — Kill ORT blob: dynamic import (Chrome MV3 CSP), 2026-08-28 — Live NER (PER/ORG/LOC) actually runs; fail-closed before VLM, 2026-08-28 — Live-path DETECT_FACES contract + fail-closed (Lead / ML), 2026-08-28 — Module-Worker load bug CONFIRMED + fixed; two more real bugs found along the way; NER model ID fixed, 2026-08-28 — ORT WASM dynamic-import of `.mjs` in the module worker, Environment for these numbers (+9 more)

### Community 31 - "Team Memory — Aegis (SIH26171)"
Cohesion: 0.15
Nodes (12): 2026-08-28 — Live face redaction BEFORE VLM (critical privacy invariant), Active Decisions, Active Tasks, Blockers, Cross-role Notes, Current Status, Dispatch Log — 2026-08-28 (Lead, live parallel run), Lessons Learned (+4 more)

### Community 32 - "a"
Cohesion: 0.18
Nodes (13): Ca(), a(), Ga(), H(), ib(), sd(), Ta(), td() (+5 more)

### Community 33 - "content-script-inject.test.js"
Cohesion: 0.14
Nodes (15): BACKGROUND_PATH, backgroundSrc, check(), CONTENT_PATH, contentSrc, fs, loadBackground(), manifest (+7 more)

### Community 34 - "2. Ground-Truth Test Page Suite"
Cohesion: 0.08
Nodes (23): 04 — Evaluation & Test Plan, 1.1 Visual Accuracy — 25% of score, 1.2 PII Detection Recall/Precision — 20% of score, 1.3 Redaction Precision — 20% of score, 1.4 Client-side Resource Utilization — 20% of score, 1.5 End-to-end Latency — 15% of score, 1. Metrics by Scoring Criterion, 2. Ground-Truth Test Page Suite (+15 more)

### Community 35 - "Aegis — Storage Contract"
Cohesion: 0.18
Nodes (10): 1. `chrome.storage.local` (persists across browser restarts, NOT synced across devices — this extension never calls `chrome.storage.sync`, confirmed by repo-wide grep), 2. `chrome.storage.session` (in-memory, cleared on browser close — by design, never touches disk), 3. Cache API (model weights — planned, not yet active), 4. Fixture / annotation JSON — `eval/ground-truth/*.json`, 5. Storage safety verification (extract-and-discard rule), 6. `chrome.storage.sync` — confirmed unused, 7. Assessment: Finding F-11 ("VLM endpoint URL is stored without encryption in chrome.storage.local"), 8. Open items for the Lead (+2 more)

### Community 36 - "content.js"
Cohesion: 0.17
Nodes (14): applyBoxRect(), attributeTokens(), buildSelector(), clickPoints(), dispatchClick(), ensureOverlayListeners(), executeClick(), getOrCreateOverlayRoot() (+6 more)

### Community 37 - "/graphify"
Cohesion: 0.20
Nodes (9): /graphify, Part A - Structural extraction for code files, Part B - Semantic extraction (parallel subagents), Step 1 - Ensure graphify is installed, Step 2 - Detect files, Step 3 - Extract entities and relationships, Usage, What graphify is for (+1 more)

### Community 38 - "2026-08-28 — Task 2.9: live NER redaction for names, places, orgs"
Cohesion: 0.25
Nodes (8): 2026-08-28 — Task 2.9: live NER redaction for names, places, orgs, Acceptance criteria, Data flow, Decision, Implementation tasks (done), Risks, SIH impact, Why

### Community 39 - "On-device Visual Perception for Light-weight Browser Agents (SIH26171)"
Cohesion: 0.20
Nodes (9): Architecture, Chosen Use Case: Privacy-Preserving Form-Fill Agent, Competitive Landscape Note, Government ID Handling — Compliance-Safe Design, On-device Visual Perception for Light-weight Browser Agents (SIH26171), Personalization: How the Agent Knows Your Details, Pitch Framing, Problem Statement (+1 more)

### Community 40 - "Evaluation Work Report"
Cohesion: 0.11
Nodes (18): 2026-08-28 — Acceptance: live face redaction before VLM, 2026-08-28 — Acceptance: live NER redaction of names/places/orgs before VLM, 2026-08-28 — Content-script inject after extension reload (file://), 2026-08-28 — INIT_FAILED worker load (chrome is not defined) — harness + Chrome probe, 2026-08-28 — INIT timeout (Chrome for Testing, before VLM), 2026-08-28 — ORT blob: INIT kill (harness + HTTP smoke), 2026-08-28 — ORT WASM `.mjs` dynamic-import miss (harness), 2026-08-28 — Re-verification of Task 2.5 gate (profile-injection fix) (+10 more)

### Community 41 - "Privacy Work Report"
Cohesion: 0.12
Nodes (15): 2026-08-28 — Content-script re-inject after Reload (privacy clearance), 2026-08-28 — Finding B re-opened then closed: live faces could still reach the VLM, 2026-08-28 — Finding C re-opened then closed: live NER dropped every PER/ORG/LOC, 2026-08-28 — Finding D closed in the VLM payload; F-11 key path implemented, 2026-08-28 — ORT blob path kill (privacy clearance), 2026-08-28 — ORT WASM init miss stays fail-closed (privacy clearance), 2026-08-28 — Sticky overlays + wasmBinary prefetch (privacy clearance), Lead note (2026-08-28) — Findings B, C, E were accurate at read-time, now resolved; F partially resolved (+7 more)

### Community 42 - "Output format per cleanup pass"
Cohesion: 0.20
Nodes (9): Behavior changes (should be none unless agreed with Lead), Changing rules, Contradictions found (doc vs code), Files touched, Memory protocol, Output format per cleanup pass, Responsibilities, Scope (what was reorganized) (+1 more)

### Community 43 - "lead.md"
Cohesion: 0.20
Nodes (9): "Complete" gate, Decision rule, Decision → ### Why → ### Data Flow → ### Risks → ### SIH Impact → ### Implementation Tasks → ### Acceptance Criteria, Delegation protocol — every Task prompt you send must include:, Memory protocol (persistence across sessions), Operating procedure, Owned responsibilities, When a contradiction appears (+1 more)

### Community 44 - "sanitize-action.test.js"
Cohesion: 0.18
Nodes (9): fs, GOOD_CTX, PAGE_FIELDS, path, PROSE_SHAPES, sandbox, source, SRC_PATH (+1 more)

### Community 45 - "Aegis — Master Task Board"
Cohesion: 0.25
Nodes (7): Aegis — Master Task Board, CURRENT STATUS, PHASE 1 — Foundation (Current), PHASE 2 — Core ML Models (Locked), PHASE 3 — Evaluation Infrastructure (Locked), PHASE 4 — VLM Integration & E2E Loop (Locked), PHASE 5 — Demo Polish & Rehearsal (Locked)

### Community 46 - "5. BlazeFace ONNX"
Cohesion: 0.29
Nodes (7): 5. BlazeFace ONNX, How it works (simplified):, How to verify it works:, The ONNX file we use:, What does it do in our project?, What is it?, What it can't do (important limitation):

### Community 47 - "6. Transformers.js"
Cohesion: 0.29
Nodes (7): 6. Transformers.js, Analogy:, How it loads models:, How to verify it works:, The model we use:, What does it do in our project?, What is it?

### Community 48 - "7. Ollama"
Cohesion: 0.29
Nodes (7): 7. Ollama, How to check what models you have:, How to verify Ollama is running:, The problem (important):, What does it do in our project?, What is it?, Your current setup (from `opencode.json`):

### Community 49 - "Codebase Maintenance Work Report"
Cohesion: 0.12
Nodes (15): 2026-08-28 — Follow-up after demo pack 3.1–3.6, 2026-08-28 — Follow-up after post-reload content-script inject, 2026-08-28 — Follow-up after Task 2.8 (face-before-VLM), 2026-08-28 — Follow-up after Task 2.9 (NER-before-VLM), 2026-08-28 — Lean "Load unpacked" root (`dist/`) + dead-vendor-file finding, Codebase Maintenance Work Report, Critical finding — Phase-2 work described in engineer reports is not present in `src/`, Doc-vs-code contradictions found (reported, not edited) (+7 more)

### Community 50 - "normalize-profile.test.js"
Cohesion: 0.33
Nodes (3): cases, normalizeProfile(), safeStringify()

### Community 51 - "backend-engineer.md"
Cohesion: 0.29
Nodes (6): Memory protocol (persistence across sessions), Phase 2 task (current), Reporting, Responsibilities, Trust boundary (absolute), VLM output & safety

### Community 52 - "eval-engineer.md"
Cohesion: 0.29
Nodes (6): Memory protocol (persistence across sessions), Phase 2 task (current), Release gate, Required metrics, Responsibilities, Rules (binding)

### Community 53 - "3. WebAssembly (WASM)"
Cohesion: 0.33
Nodes (6): 3. WebAssembly (WASM), Analogy:, How to verify it works:, What does it do in our project?, What is it?, Why does this matter?

### Community 54 - "4. WebGPU"
Cohesion: 0.33
Nodes (6): 4. WebGPU, Analogy:, Current reality check:, How to verify it works:, What does it do in our project?, What is it?

### Community 55 - "ner-redaction-before-vlm.test.js"
Cohesion: 0.10
Nodes (18): assertCallIdx, BACKGROUND_PATH, backgroundSrc, entities, fetchIdx, fields, fs, OFFSCREEN_PATH (+10 more)

### Community 56 - "frontend-engineer.md"
Cohesion: 0.33
Nodes (5): Core principles, Memory protocol (persistence across sessions), Phase 2 task (current), Reporting, Responsibilities

### Community 57 - "ml-engineer.md"
Cohesion: 0.33
Nodes (5): Memory protocol (persistence across sessions), Phase 2 tasks (current), Reporting, Responsibilities, Rules of measurement (binding)

### Community 58 - "privacy-engineer.md"
Cohesion: 0.33
Nodes (5): Memory protocol (persistence across sessions), Output format, Phase 2 oversight, Threat model, What you audit

### Community 59 - "inference.worker.js"
Cohesion: 0.29
Nodes (7): detectNER(), ensureOrtWasmBinary(), loadFaceModel(), loadNERModel(), lockOrtWasmSingleThread(), nerEntityGroup(), VENDOR_DIR

### Community 60 - "2026-08-28 — Demo pack (tasks 3.1–3.6)"
Cohesion: 0.29
Nodes (7): 2026-08-28 — Demo pack (tasks 3.1–3.6), Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

### Community 61 - "🧠 Plain-Language Tech Explainer — Aegis"
Cohesion: 0.40
Nodes (4): 🧠 Plain-Language Tech Explainer — Aegis, Quick Reference: What to install/verify right now, The Big Picture First, The Full Stack, All Together

### Community 62 - "1. Chrome Extension (Manifest V3)"
Cohesion: 0.40
Nodes (5): 1. Chrome Extension (Manifest V3), How to verify it works:, Key parts of our extension:, What does it do in our project?, What is it?

### Community 63 - "2. ONNX Runtime Web"
Cohesion: 0.40
Nodes (5): 2. ONNX Runtime Web, Analogy:, How to verify it works:, What does it do in our project?, What is it?

### Community 64 - "9. Canvas API"
Cohesion: 0.40
Nodes (5): 9. Canvas API, Analogy:, How to verify it works:, What does it do in our project?, What is it?

### Community 65 - "Backend Work Report"
Cohesion: 0.15
Nodes (12): 2026-08-28 — Classify ORT WASM backend miss (not [UNKNOWN]), 2026-08-28 — classifyError maps blob: ORT failures, 2026-08-28 — Fix: missing-data hallucination in smart form-fill (RAG), 2026-08-28 — Fix Transformers.js blob: dynamic import (INIT_FAILED), 2026-08-28 — INIT timeout: offscreen worker ready-path, 2026-08-28 — Live face redaction is a hard gate before any VLM call, 2026-08-28 — Live NER (PER/ORG/LOC) is a hard gate before any VLM call, 2026-08-28 — Post-reload "Receiving end does not exist" on file:// tabs (+4 more)

### Community 66 - "smoke_test_vlm.py"
Cohesion: 0.40
Nodes (4): check_shape(), post(), POST to ENDPOINT, return (response_json, elapsed_ms)., Verify the response has choices[0].message.content.

### Community 67 - "db-engineer.md"
Cohesion: 0.40
Nodes (4): Memory protocol, Responsibilities, Rules, What the system persists today

### Community 68 - "Ab"
Cohesion: 0.40
Nodes (5): Ab(), Ee(), Fe(), Oc(), ze()

### Community 69 - "2026-08-28 — INIT_FAILED: dedicated Worker has no chrome.* API"
Cohesion: 0.29
Nodes (7): 2026-08-28 — INIT_FAILED: dedicated Worker has no chrome.* API, Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

### Community 70 - "10. Web Workers"
Cohesion: 0.50
Nodes (4): 10. Web Workers, Analogy:, What does it do in our project?, What is it?

### Community 71 - "8. Qwen-VL / LLaVA (the Vision-Language Model)"
Cohesion: 0.50
Nodes (4): 8. Qwen-VL / LLaVA (the Vision-Language Model), What does it do in our project?, What is it?, Why we need a VLM and not just a regular LLM:

### Community 72 - "2026-08-28 — Task 2.8: live face redaction before VLM"
Cohesion: 0.25
Nodes (8): 2026-08-28 — Task 2.8: live face redaction before VLM, Acceptance criteria, Data flow, Decision, Implementation tasks (done), Risks, SIH impact, Why

### Community 74 - "git-engineer.md"
Cohesion: 0.50
Nodes (3): Memory protocol, Responsibilities, Rules

### Community 78 - "Frontend Work Report"
Cohesion: 0.22
Nodes (8): 2026-08-28 — Demo UI + session API key + dynamic overlay, 2026-08-28 — Face-redaction failure is visible in the popup, 2026-08-28 — Friendly NO_CONTENT_SCRIPT + file:// re-inject guard, 2026-08-28 — NER failure is visible in the popup, 2026-08-28 — ORT WASM miss uses existing INIT_FAILED / FACE_REDACTION copy, 2026-08-28 — Sticky redaction overlays + face overlay wire-up, 2026-08-28 — Surface INIT_PROGRESS in the popup, Frontend Work Report

### Community 82 - "Database & Persistence Work Report"
Cohesion: 0.40
Nodes (4): 2026-08-28 — `faceDetection` is now a live-path consumer (Task 2.8), 2026-08-28 — New session key `vlmApiKey` (hosted VLM / Gemini), 2026-08-28 — `piiDetection` is now a live-path consumer (Task 2.9), Database & Persistence Work Report

### Community 89 - "2026-08-28 — INIT timeout before VLM (Chrome for Testing)"
Cohesion: 0.29
Nodes (7): 2026-08-28 — INIT timeout before VLM (Chrome for Testing), Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

### Community 90 - "privacy-payload.test.js"
Cohesion: 0.09
Nodes (20): BACKGROUND_PATH, backgroundSrc, CONTENT_PATH, contentSrc, contract, CONTRACT_PATH, fs, localSets (+12 more)

### Community 91 - "2026-08-28 — Kitchen-sink test form for manual redaction + fill"
Cohesion: 0.29
Nodes (7): 2026-08-28 — Kitchen-sink test form for manual redaction + fill, Decision, Owners, Pointer, Remaining risks, SIH impact, Status

### Community 92 - "2026-08-28 — Post-reload "Receiving end does not exist" (file://)"
Cohesion: 0.29
Nodes (7): 2026-08-28 — Post-reload "Receiving end does not exist" (file://), Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

### Community 93 - "Lead Work Report"
Cohesion: 0.40
Nodes (4): 2026-08-28 — Standing rule: record every completed task, Lead Work Report, Recording protocol (standing), Task log

### Community 94 - "2026-08-28 — ORT WASM `.mjs` fetch miss after import.meta.url fix"
Cohesion: 0.29
Nodes (7): 2026-08-28 — ORT WASM `.mjs` fetch miss after import.meta.url fix, Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

### Community 95 - "ort-blob-init-http-smoke.mjs"
Cohesion: 0.36
Nodes (7): main(), makeCdp(), MIME, ROOT, serve(), USER_DATA, waitJson()

### Community 96 - "ort-blob-init-smoke.mjs"
Cohesion: 0.36
Nodes (7): CHROME_CANDIDATES, findChrome(), main(), makeCdpClient(), ROOT, USER_DATA, waitForJson()

### Community 97 - "2026-08-28 — Sticky overlays + face blur (tp08 user feedback)"
Cohesion: 0.29
Nodes (7): 2026-08-28 — Sticky overlays + face blur (tp08 user feedback), Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

### Community 98 - "02 — Architecture"
Cohesion: 0.10
Nodes (19): 02 — Architecture, 1. System Overview, 2.1 Content Script (`content.js`), 2.2 Service Worker (`background.js`), 2.3 Offscreen Document (`offscreen.html`), 2.4 Inference Worker (inside offscreen document), 2. Component Breakdown, 3.1 End-to-End Sequence (+11 more)

### Community 99 - "2026-08-28 — Kill ORT blob: dynamic import (INIT_FAILED)"
Cohesion: 0.29
Nodes (7): 2026-08-28 — Kill ORT blob: dynamic import (INIT_FAILED), Acceptance, Decision, Owners, Remaining risks, SIH impact, Status

## Knowledge Gaps
- **738 isolated node(s):** `fs`, `path`, `vm`, `ROOT`, `BACKGROUND_PATH` (+733 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **15 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `ortWasmThreaded()` connect `ortWasmThreaded` to `a`, `ortWasmThreaded`, `Ab`, `ort-wasm-simd-threaded.mjs`, `c`, `v`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `wa()` connect `ortWasmThreaded` to `a`, `ortWasmThreaded`, `Ab`, `c`, `v`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **Why does `Oa()` connect `ortWasmThreaded` to `ortWasmThreaded`, `c`, `Ab`, `v`?**
  _High betweenness centrality (0.008) - this node is a cross-community bridge._
- **Are the 21 inferred relationships involving `ortWasmThreaded()` (e.g. with `gc()` and `hc()`) actually correct?**
  _`ortWasmThreaded()` has 21 INFERRED edges - model-reasoned connections that need verification._
- **Are the 90 inferred relationships involving `wa()` (e.g. with `vc()` and `Ab()`) actually correct?**
  _`wa()` has 90 INFERRED edges - model-reasoned connections that need verification._
- **Are the 18 inferred relationships involving `ortWasmThreaded()` (e.g. with `ab()` and `bb()`) actually correct?**
  _`ortWasmThreaded()` has 18 INFERRED edges - model-reasoned connections that need verification._
- **Are the 72 inferred relationships involving `Oa()` (e.g. with `Ab()` and `dc()`) actually correct?**
  _`Oa()` has 72 INFERRED edges - model-reasoned connections that need verification._