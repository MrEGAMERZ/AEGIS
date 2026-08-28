# SERVER_SETUP.md

**SIH26171 — VLM Server Setup & Verified Configuration**

> This document records the exact working configuration for the team.
> Every number here is measured, not estimated.

---

## Hardware

| Field | Value |
|---|---|
| Machine | Apple M5 MacBook |
| Unified Memory | 16 GB |
| Storage available | ~490 GB free |
| OS | macOS |

---

## Option Used: Ollama (local, CPU+GPU via Apple Metal)

Ollama was chosen over vLLM because:
- Already installed (`ollama 0.11.2`)
- No Python/CUDA setup required
- Apple Metal backend gives GPU acceleration on M-series chips at zero config cost
- Single command to start, single command to pull model

---

## Model

| Field | Value |
|---|---|
| Ollama tag | `qwen2.5vl:7b` |
| Underlying model | Qwen2.5-VL-7B-Instruct |
| Format | GGUF (quantized by Ollama) |
| Download size | ~4.7 GB |
| Model string for API | `qwen2.5vl:7b` |

> **Why `qwen2.5vl:7b` and not `qwen3-vl:8b`?**
> Qwen3-VL-8B-Instruct is not yet available in the Ollama registry as of 2026-08-28.
> Qwen2.5-VL-7B-Instruct is the direct predecessor, same architecture, same OpenAI-compatible API format.
> The extension config uses this model name. Update when Qwen3-VL lands in Ollama.

---

## Endpoint

| Field | Value |
|---|---|
| Base URL | `http://localhost:11434` |
| Chat completions | `http://localhost:11434/v1/chat/completions` |
| Protocol | OpenAI-compatible (`/v1/chat/completions`) |
| Auth | None required (local) |

---

## Starting the Server

```bash
# One-time model pull (~4.7 GB)
ollama pull qwen2.5vl:7b

# Start server (keep this terminal open, or run as background service)
ollama serve
# Server prints: Listening on 127.0.0.1:11434
```

Ollama auto-starts on macOS login if installed via the desktop app. If using CLI only, `ollama serve` must be running.

---

## Smoke Test Results

<!-- Measured by running: python3 eval/smoke_test_vlm.py (run twice: cold then warm) -->

### Test 1 — Text-only

```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen2.5vl:7b",
    "messages": [{"role": "user", "content": "Say the word READY and nothing else."}],
    "max_tokens": 10,
    "temperature": 0.1
  }'
```

| Metric | Cold-start (1st req) | Warm (2nd req) |
|---|---|---|
| Response content | `READY` | `READY` |
| Latency | 6433 ms | **298 ms** |
| Response shape valid | ✅ | ✅ |
| PASS / FAIL | PASS | PASS |

> Cold-start includes model load into Apple Metal GPU memory. Warm latency (298 ms) is the number relevant to demo E2E performance.

### Test 2 — Multimodal (image + text)

Image used: `src/icons/icon128.png` (128×128 px PNG, extension icon — solid black square)

```bash
python3 eval/smoke_test_vlm.py
```

| Metric | Cold-start (1st req) | Warm (2nd req) |
|---|---|---|
| Response content | `The image is a solid black square with no discernible features or variations in color or texture.` | same |
| Latency | 1278 ms | **1280 ms** |
| Response shape valid | ✅ | ✅ |
| PASS / FAIL | PASS | PASS |

> Multimodal latency is **stable at ~1280 ms warm** regardless of cold/warm state — image encoding dominates.
> This is within the 3 s E2E budget (local inference ~140 ms + VLM ~1280 ms + execution ~10 ms ≈ **~1.6 s total**).

> **Note on test image:** `icon128.png` is a 128×128 solid black square — a deliberately trivial image.
> The model's description is correct. The test validates the multimodal API path, not visual comprehension quality.
> Real-world sanitized screenshots will produce richer, more meaningful responses.

---

## Extension Configuration

Open the extension popup and set:

| Field | Value |
|---|---|
| VLM Endpoint | `http://localhost:11434/v1/chat/completions` |
| VLM Model | `qwen2.5vl:7b` |

---

## Known Limitations

- **Ollama is local-only.** For a demo on a different machine, Ollama must be installed and the model pulled on that machine. There is no shared server.
- **16 GB unified memory is the minimum comfortable size for 7B at default quantization.** If other heavy apps are open, Ollama may swap. Close Chrome itself is also using memory for the extension; test with a lean browser profile.
- **First-request latency includes model load.** Report both cold-start and warm latency separately in benchmark results.
- **`qwen2.5vl:7b` ≠ `Qwen/Qwen2.5-VL-7B-Instruct` (HuggingFace FP16).** The Ollama version is quantized. Accuracy may differ slightly from a vLLM FP16 deployment. This is acceptable for the demo but should be noted in the evaluation.

---

## Reproducing on a New Machine

```bash
# 1. Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# 2. Pull model
ollama pull qwen2.5vl:7b

# 3. Start server
ollama serve

# 4. Verify
python3 eval/smoke_test_vlm.py
```

Everything in step 4 should print PASS within 120s.
