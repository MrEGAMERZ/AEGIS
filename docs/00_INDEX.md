# AEGIS — On-device Visual Perception for Light-weight Browser Agents

Public overview and install path: **[README.md](../README.md)** (repo root).

## Project Overview

A privacy-preserving browser extension that intercepts screen content before it leaves the device, runs local vision inference to detect and redact sensitive elements (faces, passwords, PII text), and sends only a sanitized version to a local or optional vision model. The product name is **AEGIS** (Greek: a shield — protector, defender).

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

## Technical Documentation

| Doc | Purpose | Link |
|---|---|---|
| Technical Dossier | **Comprehensive PDF submission for the Jury** | [AEGIS_Technical_Dossier.pdf](AEGIS_Technical_Dossier.pdf) |
| 01. Requirements | Functional/non-functional reqs, redaction taxonomy, MVP scope | [01_REQUIREMENTS.md](01_REQUIREMENTS.md) |
| 02. Architecture | Components, data flow, sanitization pipeline, server contract | [02_ARCHITECTURE.md](02_ARCHITECTURE.md) |
| 03. Tech Stack & Models | Model selection matrix, latency budgets | [03_TECH_STACK_MODELS.md](03_TECH_STACK_MODELS.md) |
| 06. Tech Explainer | ONNX / WASM in plain language | [06_TECH_EXPLAINER.md](06_TECH_EXPLAINER.md) |

## Privacy & Architecture Deep Dives

| Doc | Purpose | Link |
|---|---|---|
| Document Upload Trust Boundary | Data isolation, never-store enforcement points | [PRIVACY_DOC_UPLOAD.md](PRIVACY_DOC_UPLOAD.md) |
| Profile / Fill Form Architecture | Client vs server flow: ingest, face scan, Fill Form | [PROFILE_FILL_ARCHITECTURE.md](PROFILE_FILL_ARCHITECTURE.md) |

## Operator & Run Guides

| Doc | Purpose | Link |
|---|---|---|
| Demo Runbook | Judge Chrome E2E on test pages | [DEMO_RUNBOOK.md](DEMO_RUNBOOK.md) |
| Backend Deploy | Operator path: Node gateway `:8000` to local Ollama | [BACKEND_DEPLOY.md](BACKEND_DEPLOY.md) |
| VLM Server Setup | Measured Ollama install, `qwen2.5vl:7b` configuration | [SERVER_SETUP.md](SERVER_SETUP.md) |

---

## Key Technical Decisions (Summary)

- **Extension:** Chrome Manifest V3, service worker + offscreen document
- **Face detection:** BlazeFace ONNX (~400KB, sub-ms GPU)
- **Text PII:** Hybrid regex + DistilBERT NER via Transformers.js WASM
- **DOM fields:** Programmatic `type="password"` / `autocomplete` attribute detection
- **Server VLM:** Qwen3-VL-8B-Instruct / qwen2.5vl:7b
- **Runtime:** ONNX Runtime Web — WASM baseline, WebGPU acceleration when available
