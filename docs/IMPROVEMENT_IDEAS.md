# Improvement ideas (honest backlog)

**Date:** 2026-09-09  
**Problem:** SIH26171 — on-device visual perception, redaction before any VLM, light-weight browser agent. Demo vehicle: privacy-preserving **form fill**.  
**Sources:** `docs/TASK_MASTER.md` deferred D1–D3, `docs/DEMO_RUNBOOK.md`.  
**Rule:** ideas only. No fake features, no invented metrics.

---

## Ranking

**Demo-week** = raises judge-visible reliability, privacy story, or Resource/Latency scores before the live demo.  
**Post-demo** = real product work that must not steal rehearsal time.

| Rank | When | Idea | SIH26171 tie |
|---|---|---|---|
| 1 | Demo-week | **Prove Privacy scan on TP08 from `dist/`** (TASK_MASTER A1) — timed, screenshots, receipt counts | Visual accuracy + redaction precision, no VLM required |
| 2 | Demo-week | **Keep face/NER off the browse path** — on-demand scan only (see §1) | Client-side resource (20%); privacy without turning every tab into a camera |
| 3 | Demo-week | **Fill Form local-first, then one VLM batch** — rehearse the shipped path (see §2) | Form fill without burning 90 s/field; anti-hallucination still on |
| 4 | Demo-week | **Always use gateway `:8000`**, never Ollama `:11434` from Chrome | Brain Connection actually works (403 otherwise) |
| 5 | Demo-week | **Load `dist/` (81M), never repo root (1.4G)** | Resource criterion; see `EXTENSION_SIZE.md` |
| 6 | Demo-week | **Pre-warm Ollama + say 30–90 s cold WASM/NER out loud** | Latency (15%) honesty; avoid a “hung” first click |
| 7 | Demo-week | **Vault/docs dry run once** — one résumé, consent ON, never-store visible | On-device ingest + Aadhaar/PAN discarded |
| 8 | Post-demo | **WebGPU inference + WASM fallback** (D1) | Latency / resource on capable GPUs; WASM stays the baseline |
| 9 | Post-demo | **Full tp01–tp08 EDR/PII matrix** (D2) + two unseen pages (B2) | PII recall/precision (20%), anti-training-leak |
| 10 | Post-demo | **Progressive self-learning profile** (D3) | Personalization without claiming model training |
| 11 | Post-demo | **Leaner NER / lazy model load** so daily install is not 65M of DistilBERT | Resource utilization without dropping fail-closed NER |
| 12 | Post-demo | **Always-on DOM covers polish** (teammate Slice C leftover) — outlines only, `pointer-events: none` | Privacy UX; still no BlazeFace on scroll |

---

## 1. On-demand face scan (do not BlazeFace every page)

**Today (fact-check, 2026-09-09):** `src/content/content.js` MutationObserver only re-runs **DOM** password/autocomplete overlays. BlazeFace + DistilBERT live in the inference worker and run on **Privacy scan / Run Agent / capture-sanitize**, not on every navigation.

**Risk if we “finish always-on covers” badly:** wiring face pixelation or NER into the observer would compile ~13 MB WASM and run BlazeFace on ordinary browsing — that fights SIH26171’s *light-weight* and *client-side resource* scores and is a privacy smell (continuous face detection).

**Idea:** keep a hard split:

- **Browse:** DOM-only “protected field” outlines (no screenshot, no ONNX, no Ollama).
- **User clicks Scan / Run Agent / Fill:** capture → BlazeFace → NER → receipt.

Treat any PR that loads `blaze.onnx` from a content-script path as out of demo-week scope unless eval measures CPU/memory on a long browsing session. **Implementation is a parallel code task.**

---

## 2. Fill Form local-first

Lead 2026-09-06: local `FILL_MATCHING_FIELDS` plus `fill_many` so a saved profile can fill matching fields in one turn; leftover fields still cost a VLM round (~90 s cold). Harness: sanitize-action 49/49, agent-loop 13/13 — **Chrome TP08 still unmeasured**.

**Demo-week:** Reload `dist/`, save `dummy-profile-ananya.json`, Fill Form on TP08, show Undo / trap fields empty. Do not promise “full government form, zero VLM.”

**Post-demo:** better label→selector mapping; never send vault text to a remote Gemini endpoint (already fail-closed for STRUCTURE).

---

## 3. Vault / documents

Shipped in code: on-device PDF/DOCX/… extract, consent default OFF, never-store Aadhaar/PAN/licence/UPI/passport/bank, vault cap + purge (`PRIVACY_DOC_UPLOAD.md`). Live STRUCTURE fill (A5) is still OPEN.

**Demo-week:** one short PDF or DOCX, consent checkbox explained, “numbers never stored.” Skip CMap-heavy PDFs (known fail-closed; TASK_MASTER E3).

**Post-demo:** D3 progressive profile (vault is RAG-lite, not learning over time — do not pitch it as done).

---

## 4. Latency (say the real numbers)

Already measured (do not invent new ones):

- Ollama warm multimodal ~1.3–1.6 s (`SERVER_SETUP.md` / runbook).
- Ollama cold historically ~55 s on 16 GB (`DEMO_RUNBOOK.md`); text-only cold also recorded at 6.4 s in `SERVER_SETUP.md` — report the protocol you actually ran.
- First Scan/Run Agent after extension load: **30–90 s** WASM + NER init.

**Demo-week:** pre-warm (`BACKEND_DEPLOY.md`); warn the room on first scan. **Post-demo:** D1 WebGPU; lazy-load NER only when Text PII is on; consider a smaller quantized NER if recall holds (must re-measure PII metrics — D2).

---

## 5. Other honest items (not fake features)

| Item | Notes |
|---|---|
| **Gateway 403** | Operator path is `:8000`. Not a new feature — a deploy rule. |
| **`dist/` size** | 81M, ~80% NER. Resource slide should say “on-device NER, not 1.4 GB repo.” Shrinking NER is post-demo (rank 11). |
| **HiDPI clicks (A3)** | Harness 38/38; live Retina proof owed — demo-week if the judging machine is Retina. |
| **Qwen3-VL-8B** | Still not the Ollama tag we run. Pitch `qwen2.5vl:7b` or you will lose a live pull. |

---

## What we are not putting on the demo slide

- Self-learning / fine-tuning (D3 is retrieval + saved answers at most).
- Storing Aadhaar/PAN “for convenience.”
- WebGPU as the baseline (D1 is bonus; WASM is what we ship).
- Mock gateway (`--mock`) as the judged Brain Connection.
- Firefox, cloud Firebase, or a public `:8000` on the open internet.

---

## CEO review locks (2026-09-15)

Mode: **HOLD SCOPE** on the proof package, with one extra product item you asked for.

**This week’s product (not a scripted demo)**
- Demo on a **normal form you already use**. Do not add test-page-only rules, dummy-person theater, or extra demo switches.
- When Chrome opens, Aegis **starts itself and wakes the on-device models**. **20–30 seconds** on first open is fine. After Ready, Scan/Fill must work with no extra freeze.
- Ready means **faces and name-hiding are both awake**, not faces only.
- If nothing is saved, tell the user to **save a profile**. Do not sit on the local brain waiting.
- **Never store Aadhaar/PAN** (and the other ID numbers already on the never-store list). On-device later is fine for name, email, phone, résumé text. Cloud brain is a **later story**, not this room.
- Face finding runs only when the privacy toggle is **on**. Idle browsing does not scan faces.
- Judged laptop path: **Ollama + the local helper**. The extension must not talk to Ollama by itself (Chrome will refuse). Load Aegis from the **small build folder**, not the whole project.
- After a practice: **screenshots, clock times, tick the task board**.
- Printed start list: Ollama, helper, Chrome with Aegis, then your form.

**Not this week**
- WebGPU, smaller NER, self-learning, cloud deploy, tiny on-device chat model as a new ship.
- Hard-fail the whole app because our kitchen-sink test page missed a tiny photo.
- Rewriting the product around one dummy JSON person.

**Code still owes (CEO rules, not in the tree yet)**
- Wake models on Chrome/extension start (`onStartup` / first load → offscreen INIT through name-hiding).
- Popup Ready gated on that full wake.
- Empty-profile copy; do not call the local brain when Fill has nothing to type.

**Operator docs still stale (fix when touching the runbook, not as demo theater)**
- Printed path should be the helper, not a direct Ollama URL. Practice pages: prefer `http://127.0.0.1:8765` over `file://`.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | issues_open | mode: HOLD_SCOPE, 1 expansion accepted (wake on Chrome open), 3 critical gaps (wake/Ready/empty-profile not in code yet) |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | Codex CLI not installed; same-family outside voice used |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 0 | — | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run (no new screens; Ready + save-profile copy only) |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **VERDICT:** CEO HOLD_SCOPE with wake-on-open accepted — not ready to treat live proof as done; eng review required before shipping the warmup/Ready/empty-profile work.
NO UNRESOLVED DECISIONS
