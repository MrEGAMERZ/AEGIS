# Aegis — On-device Visual Perception for Light-weight Browser Agents

## Project Overview

A privacy-preserving browser extension that intercepts screen content before it leaves the device, runs local vision inference to detect and redact sensitive elements (faces, passwords, PII text), and sends only a sanitized version to a cloud VLM for agentic action.

**Organization:** Indian Space Research Organisation (ISRO)
**Problem Statement Code:** SIH26171
**Category:** Software

---

## Evaluation Criteria (5 Explicitly Weighted)

| Criterion | Weight |
|---|---|
| Visual Accuracy (local model understands screen) | 25% |
| PII Detection Recall/Precision | 20% |
| Redaction Precision (correct, not over/under-redacting) | 20% |
| Client-side Resource Utilization | 20% |
| End-to-end Latency | 15% |

---

## Planning Documents

| Doc | Purpose | Link |
|---|---|---|
| Master Task Board | **Canonical outstanding-work board (OPEN WORK A–H)** — what is not done, owners, dependencies, acceptance criteria | [TASK_MASTER.md](TASK_MASTER.md) |
| 01 | Requirements — functional/non-functional reqs, redaction taxonomy, MVP scope | [01_REQUIREMENTS.md](01_REQUIREMENTS.md) |
| 02 | Architecture — components, data flow, sanitization pipeline, server contract | [02_ARCHITECTURE.md](02_ARCHITECTURE.md) |
| 03 | Tech Stack & Models — model selection matrix, ADRs, latency budgets | [03_TECH_STACK_MODELS.md](03_TECH_STACK_MODELS.md) |
| 04 | Evaluation & Test Plan — metrics, ground-truth test pages, instrumentation | [04_EVAL_TEST_PLAN.md](04_EVAL_TEST_PLAN.md) |
| 05 | Milestones — phased build plan, dependencies, deliverables | [05_MILESTONES.md](05_MILESTONES.md) |

## Research Documents (from analysis phase)

| Doc | Purpose | Link |
|---|---|---|
| Deep Structured Analysis | Problem understanding, feasibility, competitor landscape, evaluator lens | [Aegis_Deep_Structured_Analysis.md](../docs/Aegis_Deep_Structured_Analysis.md) |
| Pitch Storytelling Framework | Narrative arc for the final pitch | [Aegis_Pitch_Storytelling_Framework.md](../Aegis_Pitch_Storytelling_Framework.md) |

## Privacy & Security Documents

| Doc | Purpose | Link |
|---|---|---|
| Document Upload Trust Boundary | What may leave the device for the PDF/DOCX upload + AI-structured profile feature, never-store enforcement points, verification checklist | [PRIVACY_DOC_UPLOAD.md](PRIVACY_DOC_UPLOAD.md) |

---

## Key Technical Decisions (Summary)

- **Extension:** Chrome Manifest V3, service worker + offscreen document
- **Face detection:** BlazeFace ONNX (~400KB, sub-ms GPU)
- **Text PII:** Hybrid regex + DistilBERT NER via Transformers.js WASM
- **DOM fields:** Programmatic `type="password"` / `autocomplete` attribute detection
- **Server VLM:** Qwen3-VL-8B-Instruct (Apache-2.0, native GUI grounding)
- **Runtime:** ONNX Runtime Web — WASM baseline, WebGPU acceleration when available
- **Build order:** WASM baseline → redaction pipeline → WebGPU opt → server loop → benchmarks → demo
