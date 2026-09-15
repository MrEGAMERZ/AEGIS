# 03 — Tech Stack & Model Selection

**AEGIS: On-device Visual Perception for Light-weight Browser Agents**

---

## 1. Model Selection Matrix

### 1.1 Client-Side Models (run in browser)

| Model | Task | Format | Size | Input | Latency (WASM) | Latency (WebGPU) | Source |
|---|---|---|---|---|---|---|---|
| BlazeFace ONNX | Face detection | ONNX opset 16 | ~400KB | 128×128 RGB | 10–15ms | <1ms | `garavv/blazeface-onnx` (HF) |
| `Xenova/distilbert-base-uncased-finetuned-conll03-english` | NER (name/loc/org) | ONNX (Transformers.js) | ~66MB | text tokens | 20–30ms | ~5ms | HF Transformers.js |
| `Xenova/bert-base-NER` | NER (name/loc/org) — heavier alt | ONNX (Transformers.js) | ~100MB | text tokens | 30–50ms | ~8ms | HF Transformers.js |
| Regex engine (built-in) | SSN, phone, email, dates | JS (no model) | 0KB | text | <1ms | <1ms | Custom |

### 1.2 Server-Side VLM (runs on cloud/self-hosted GPU)

| Model | Params | VRAM (AWQ-4bit) | VRAM (FP16) | License | Strengths | Deployment |
|---|---|---|---|---|---|---|
| **Qwen3-VL-8B-Instruct** (selected) | 8B dense | ~4GB | ~16GB | Apache-2.0 | Native GUI grounding, emits bboxes/click coords, computer-use cookbook, 256K context | vLLM or Ollama |
| Qwen3-VL-30B-A3B-Instruct | 30B MoE (3B active) | ~8GB | ~30GB | Apache-2.0 | Better quality, MoE efficiency | vLLM |
| Holo1.5-7B | 7B | ~4GB | ~14GB | Apache-2.0 | GUI-localization specialist, ~2× grounding accuracy | vLLM |
| InternVL3.5-8B | 8B dense | ~5GB | ~16GB | Apache-2.0 | Strong MMMU reasoning | vLLM |

---

## 2. Architecture Decision Records

### ADR-01: BlazeFace ONNX over YOLO/MediaPipe-JS for face detection

**Decision:** Use BlazeFace ONNX (`garavv/blazeface-onnx`) via ONNX Runtime Web, not YOLO variants or MediaPipe JS Solution API.

**Rationale:**
- BlazeFace ONNX is only ~400KB (vs YOLOv8-nano ~12MB)
- 128×128 input → extremely fast inference even on WASM (10–15ms)
- Outputs bounding boxes + 6 facial landmarks — sufficient for blur placement
- Runs via ONNX Runtime Web (same runtime as NER model — single dependency)
- MediaPipe JS Solution API is excellent but brings a heavier runtime dependency and less control over model loading

**Trade-off:** BlazeFace short-range model only detects faces >20% of image area. For screenshots with small faces in video call thumbnails, this may miss detections. Mitigation: use full-range model variant (5% threshold) or combine with a secondary detector if time permits.

### ADR-02: DistilBERT NER over BERT-base / DeBERTa for text PII

**Decision:** Use `Xenova/distilbert-base-uncased-finetuned-conll03-english` (66MB) over BERT-base NER (100MB) or DeBERTa PII (larger).

**Rationale:**
- DistilBERT NER achieves ~96% of BERT-base F1 on CoNLL-2003 with 40% fewer parameters
- 66MB vs 100MB — meaningful difference for browser download/cache budget
- Proven to work via Transformers.js WASM in multiple production tutorials (OpenPHR, PII Guardrail)
- DeBERTa PII models are more accurate but larger and slower in WASM — not worth the latency cost for this use case

**Trade-off:** ~1-2% lower recall on edge-case names vs BERT-base. Acceptable given the hybrid regex + NER approach where regex catches high-value structured PII deterministically.

### ADR-03: Qwen3-VL-8B-Instruct over alternatives for server VLM

**Decision:** Use Qwen3-VL-8B-Instruct as the default server VLM.

**Rationale:**
- Apache-2.0 license — no restrictions for hackathon or post-hackathon use
- Native GUI grounding: emits 2D bounding boxes and click coordinates directly (not a bolt-on)
- Has official computer-use agent cookbook in the Qwen3-VL repo
- Ollama: `ollama run qwen3-vl` (single command for development)
- vLLM: production-ready, OpenAI-compatible API at `/v1`
- AWQ-4bit quantization available (`cpatonn/Qwen3-VL-8B-Instruct-AWQ-4bit`) — runs on single GPU with ~4GB VRAM

**Trade-off:** Holo1.5-7B has ~2× better ScreenSpot-Pro grounding accuracy (57.94% vs 29% for Qwen2.5-VL-7B). If grounding accuracy becomes the bottleneck during testing, consider switching to Holo1.5 as a specialized grounding layer.

### ADR-04: WASM-first over WebGPU-first runtime strategy

**Decision:** Default to WASM backend. WebGPU is an acceleration layer, not a requirement.

**Rationale:**
- WASM works on ~98% of modern browsers — judges' demo machines will definitely work
- WebGPU is stable in Chrome 113+ (~65-70% desktop) but not guaranteed on judges' setup
- WebGPU delivers 3-8× speedup (SitePoint 2026 benchmarks: Phi-3-mini 320ms→85ms/token)
- But WASM is "good enough" for the latency target (≤500ms local inference)
- A flashy WebGPU demo that crashes on the judge's machine is worse than a reliable WASM demo

**Trade-off:** Demo may look slightly slower on WASM. Mitigate by showing benchmark numbers comparing WASM vs WebGPU in the presentation.

### ADR-05: Hybrid regex + NER over NER-only for text PII

**Decision:** Run deterministic regex pre-filters BEFORE the NER model, not NER alone.

**Rationale:**
- Regex handles structured PII (SSN `xxx-xx-xxxx`, emails, phone numbers, 16-digit card numbers) with 100% precision — no false positives
- NER handles unstructured PII (person names, locations in natural language) — regex cannot do this
- Regex runs in <1ms — zero latency cost, removes high-value PII before NER even runs
- Pattern from OpenPHR, Presidio, and multiple production PII redaction systems

---

## 3. Runtime Stack

| Layer | Tool | Version/Source |
|---|---|---|
| Extension framework | Chrome Extension Manifest V3 | Chrome 109+ |
| Build tool | WXT or Vite + CRXJS | Latest stable |
| Language | TypeScript | 5.x |
| Inference runtime | ONNX Runtime Web | Latest (npm `onnxruntime-web`) |
| Model wrapper | Transformers.js | `@huggingface/transformers` (v3+) |
| Model hosting | Hugging Face Hub (CDN) | Auto-download on first run |
| Model caching | Cache API (Service Worker) | Browser native |
| Server inference | vLLM | ≥0.11.0 |
| Server alternative | Ollama | Latest (for dev/demo) |
| API protocol | OpenAI Chat Completions compatible | `/v1/chat/completions` |

---

## 4. Latency Budget

Target: ≤3 seconds total E2E (capture → action execution).

| Stage | Target (WASM) | Target (WebGPU) | Notes |
|---|---|---|---|
| Screenshot capture | ~50ms | ~50ms | `captureVisibleTab` is fast |
| DOM field scan | ~5ms | ~5ms | `querySelectorAll` — negligible |
| Text extraction (innerText) | ~10ms | ~10ms | DOM traversal |
| BlazeFace inference | 10–15ms | <1ms | 128×128 input, tiny model |
| Regex PII scan | <1ms | <1ms | Deterministic, no model |
| DistilBERT NER inference | 20–30ms | ~5ms | Text-only, fast |
| Mask render (Canvas 2D) | ~30ms | ~30ms | Gaussian blur + fillRect |
| Structural payload build | ~5ms | ~5ms | JSON serialization |
| **Local subtotal** | **~140ms** | **~115ms** | Well within 500ms budget |
| VLM round-trip (network) | ~1–2s | ~1–2s | Depends on GPU, network |
| VLM inference | ~500ms–1.5s | ~500ms–1.5s | Qwen3-VL-8B on A100 |
| Action execution | ~10ms | ~10ms | DOM manipulation |
| **E2E total** | **~1.7–2.2s** | **~1.7–2.2s** | ≤3s target met |

---

## 5. Resource Budget

| Resource | Budget | Notes |
|---|---|---|
| Model cache on disk | ≤150MB | BlazeFace (~0.4MB) + DistilBERT NER (~66MB) + ONNX RT (~3MB) + buffer |
| Peak memory (runtime) | ≤500MB | Model weights + inference tensors + canvas buffer |
| CPU utilization | ≤30% avg during inference | Measured on mid-range laptop (i5/8GB) |
| Download on first use | ~70MB | DistilBERT NER + ONNX Runtime + BlazeFace |
