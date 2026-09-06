# Aegis — Master Task Board (SIH26171)

**How this works:**
- `## OPEN WORK` is the single source of truth for what is NOT done. Everything in it is actionable with an owner, a dependency, and measurable acceptance criteria.
- "DONE" means **tested** (harness or measured live), not merely written. Code without a harness entry or live measurement is "code done, proof owed" and stays OPEN.
- Engineers read this file at session start along with `.opencode/memory/team-memory.md` (live status) and `docs/ENGINEERING_RULES.md`.
- Priority order at every decision: **Working → Measurable → Explainable → Privacy-safe → Lightweight → Demoable.**

---

## CURRENT STATUS

- **Phase 1 — COMPLETE**
- **Phase 2 — Code + harness largely complete; live-browser proof + demo numbers owed** (see OPEN WORK §A–§C)
- **Next gate before demo:** §A live Chrome proof on TP08, §B measured SIH numbers, §C privacy re-audit sign-off

---

## OPEN WORK

### A. Live-browser proof — code done + harnessed, Chrome proof owed (demo gate)

| # | Task | What's already measured | Owner | Depends on | Acceptance criteria (done means) |
|---|---|---|---|---|---|
| **A1** | Chrome E2E on TP08: Privacy scan → preview + receipt (no Ollama) | Harness 237/237; runbook §"Judge demo without Ollama" | eval | runbook rehearsal | Scan completes <120 s on TP08 with NER pre-warmed; receipt gates met; zero VLM/Ollama calls; screenshots + timings logged in `engineers/evaluation/work_done.md` |
| **A2** | Live redaction proof: faces + PII redacted before any VLM call | face-redaction 54/54, ner-redaction 32/32 harness | ml + frontend + eval + privacy | A1 | Live Chrome scan on a page with a photo + names shows redacted masks + preview; network log shows one request, to local endpoint, after redaction only |
| **A3** | HiDPI (Retina, dpr≥2) click accuracy proof | execute-action 38/38 harness | frontend + eval | A1 | On a Retina display, Run Agent clicks land within the target control; coordinates verified against DPR-corrected mapping |
| **A4** | Run Agent / Fill loop live on TP08 with real Ollama (multi-step + fill-as-agent + :8000 gateway) | agent-loop 12/12; sanitize-action 36/36; GW-2 rewrite in code | backend + frontend + eval | A1; Ollama pre-warmed (runbook §2) | One multi-turn task (e.g. "fill email then submit") completes via `http://localhost:8000`; every `type` value traceable to profile/vault (sanitizeAction enforced); latency per turn logged |
| **A5** | Live STRUCTURE fill: drop a real PDF/DOCX → consent ON → AI-extracted fields land in profile → fill a form | doc-vault 104/104; document-extract 65/65; popup-consent 26/26 | backend + frontend + eval | A1, A4 | A real PDF (not the harness fixture) yields ≥3 correct profile fields; a fill turn types one of them; vault stores only scrubbed text (no Aadhaar/PAN); consent OFF → refused cleanly |
| **A6** | Popup drag-drop E2E + voice mic in real Chrome | document-extract 65/65 (offscreen path); voice page built | frontend + eval | A1 | Drag a `.docx` into the popup → text preview shows (DOMParser path in real Chrome); mic permission + one transcript from Web Speech API |

### B. Measured SIH numbers for the pitch (demo gate)

| # | Task | What's already known | Owner | Depends on | Acceptance criteria |
|---|---|---|---|---|---|
| **B1** | Latency/resource table across the 5 weighted criteria | Cold VLM 54.7s / warm 1.3–1.6s (curl); scan-only path untimed | eval | A1–A4 | One table, measured on the demo machine: scan-only E2E, redaction pipeline time, VLM warm/cold, click→action, memory during scan (chrome://system or OS), model-load bytes. Write into `docs/04_EVAL_TEST_PLAN.md` per-criterion results |
| **B2** | Generalization check: 2 unseen test pages (not TP01–TP08) | — | eval | A4 | Pipeline runs on 2 fresh pages with different HTML/CSS/forms; PII recall/precision + action success reported (see `04_EVAL_TEST_PLAN.md` §training leak guard) |

### C. Privacy re-audit (demo gate — nothing ships without privacy sign-off)

| # | Task | What's closed already | Owner | Depends on | Acceptance criteria |
|---|---|---|---|---|---|
| **C1** | Privacy re-audit post-offline-NER + doc-upload feature | D9/D3/D4/D6 closed 2026-09-06 (doc-vault 104/104); face/NER fail-closed gates | privacy | A1, A5 | Re-verify: doc text loopback-only, consent enforced in SW, never-store covers Aadhaar/PAN/licence/UPI/passport/bank at input AND output, vault capped+purgeable, raw screen never reaches backend. Findings logged in `engineers/privacy/work_done.md` with verdict per item |

### D. Deferred — post-demo (do NOT build before demo unless explicitly re-prioritized)

| # | Task | Owner | Status |
|---|---|---|---|
| D1 | WebGPU inference path + WASM fallback (runtime currently WASM baseline) | ml | DEFERRED |
| D2 | Full tp01–tp08 EDR/PII benchmark matrix | eval | DEFERRED |
| D3 | Progressive self-learning profile (vault is RAG-lite today; no learning over time) | backend | DEFERRED (future scope per Phase 4) |

### E. Hygiene / tech-debt (safe anytime, low risk)

| # | Task | Owner | Acceptance criteria |
|---|---|---|---|
| E1 | `normalize-profile.test.js` tests an embedded copy, not a live import — diff the copy against current `src/background/background.js` (`normalizeProfile`), convert to live import or document the drift | eval + codebase | Harness runs against the REAL function; stale-copy note removed |
| E2 | Remove stale root `patch_vlm_stream.js` / `patch_vlm_json.js` (superseded by `server/index.js` gateway; verify dead references before deleting) | codebase | Grep shows zero references; files deleted or archived; no behavior change |
| E3 | Document CMap-needing PDFs as an accepted fail-closed limitation (pdf.js lazy load) in demo runbook §known-limitations | frontend + codebase | One honest bullet in `docs/DEMO_RUNBOOK.md` |
| E4 | Standing rule: re-run `scripts/build-dist.sh` + manifest-path check after ANY `src/` change; record dist size in the commit/log | lead (whoever changes src) | `dist/` byte-identical to `src/` semantics; size logged (currently 81M) |

### F. Demo rehearsal & judge prep (final gate)

| # | Task | Owner | Acceptance criteria |
|---|---|---|---|
| F1 | Full `docs/DEMO_RUNBOOK.md` rehearsal end-to-end on a non-developer machine (both hero paths: no-Ollama scan + warm-Ollama Run Agent) | lead + all | Runbook steps all pass with timings; one dry run recorded |
| F2 | Judge Q&A prep: 5 stress-test questions from `Aegis_Deep_Structured_Analysis.md` §evaluator lens; open `05_MILESTONES.md` boxes (benchmark summary visible, known failure cases documented) | lead + eval | Answers drafted with honest limitations; failure-mode sheet (`ENGINEERING_RULES.md` §failure modes) matches real behavior |

### G. Git / release

| # | Task | Owner | Status |
|---|---|---|---|
| G1 | Commit staged Phase-2 `src/` per the 4+1 commit plan in `engineers/git/work_done.md` (incl. restore commit + storage contract) | git | **WAITING — user must request commit** (standing instruction: no commits without explicit request) |
| G2 | Pre-demo release tag + secret scan + `dist/` freeze | git | Tag `demo-YYYY-MM-DD`; no secrets/vendor blobs in git; dist frozen after final rebuild |

### H. Known-limitation documentation (keep honest, no build work)

- `qwen2.5vl:7b` (Ollama) is the working model; `qwen3-vl:8b` not in Ollama registry (documented `SERVER_SETUP.md`).
- `06_TECH_EXPLAINER.md` still references llava/qwen2-vl in spots — update names if the doc is presented to judges.
- Always-set "URL omitted from VLM payload" + audit log cap 50 — verify in re-audit (C1).

---

## DONE (verified — code + harness and/or measured live)

### Phase 1 — Foundation
- [x] 1.1 Build tooling: vendor onnxruntime-web + transformers.js
- [x] 1.2 Wire inference.worker.js into offscreen.js
- [x] 1.3 devicePixelRatio coordinate mapping (harness 38/38 — live Retina proof is A3)
- [x] 1.4 VLM server up (gateway `:8000` → Ollama `:11434`, real qwen2.5vl:7b measured)
- [x] 1.5 DOM password-field masking end-to-end

### Phase 2 — Core (code + harness)
- [x] 2.1 BlazeFace ONNX pipeline (harness 54/54 + live smoke on TP08 photo)
- [x] 2.2 DistilBERT NER pipeline, offline (harness 32/32; offline smoke 0 external reqs, 668ms)
- [x] 2.3 VLM integration + structured action sanitization (sanitize-action 36/36)
- [x] 2.4 Extension UI: scan/run-agent, settings, profile, voice, dashboard, docs
- [x] 2.5 E2E harness suite (12 suites, 453 checks green 2026-09-06)

### Features shipped & verified (code + harness)
- [x] Multi-step agent loop, password-detection toggle, fill-as-VLM-agent
- [x] Universal document ingestion: PDF/DOCX/TXT/JSON/CSV/MD → on-device text → profile (document-extract 65/65)
- [x] AI structuring + dynamic profile + RAG-lite vault, LOCAL-VLM-only, consent-gated (doc-vault 104/104, extract-profile 21/21)
- [x] Privacy audit gates D9/D3/D4/D6 — see `docs/PRIVACY_DOC_UPLOAD.md` + `engineers/privacy/work_done.md`
- [x] Degenerate-image guard in `server/index.js` (<28px → 400, never reaches Ollama; harness 19/19 + live curl)
- [x] `dist/` build pipeline (`scripts/build-dist.sh`, 81M, all manifest paths resolve)

---

## RULES (from ENGINEERING_RULES.md — abbreviated)

- A task is complete only when eval measured it AND privacy cleared it, or remaining risks are explicit.
- Never claim a metric that was not measured.
- On contradiction: stop, report in the CONTRADICTION FOUND format, resolve in code — do not paper over.
- Privacy boundary: browser is the enforcement point; sanitized context only to backend; doc text is loopback-only and consent-gated.