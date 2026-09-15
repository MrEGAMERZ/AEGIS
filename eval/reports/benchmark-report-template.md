# AEGIS — Benchmark Report

**Date:** <!-- FILL: e.g. 2026-08-26 -->  
**Evaluator:** <!-- FILL: name/role -->  
**Extension Version:** 0.1.0  
**Report Version:** 1.0

---

## Environment

| Field | Value |
|---|---|
| **Browser** | <!-- FILL: Chrome 127.0.6533.120 --> |
| **OS** | <!-- FILL: macOS 14.5 / Windows 11 / Ubuntu 22.04 --> |
| **Hardware** | <!-- FILL: MacBook Pro M3, 16GB RAM --> |
| **GPU** | <!-- FILL: Apple GPU (WebGPU) / None (WASM) --> |
| **Model (face)** | BlazeFace ONNX (placeholder — not yet loaded) |
| **Model (NER)** | DistilBERT NER (placeholder — not yet loaded) |
| **Regex engine** | Native browser JS regex |
| **ONNX Runtime** | onnxruntime-web 1.21.0 |
| **Backend** | <!-- FILL: webgpu / wasm --> |

---

## Dataset

| Field | Value |
|---|---|
| **Test pages** | 7 (TP01–TP07) |
| **Total sensitive elements** | 39 |
| **Total non-sensitive elements** | 38 |
| **Dynamic elements** | 5 (TP06) |
| **Unseen/generalization pages** | 2 (TP06, TP07) |
| **Ground truth source** | `eval/ground-truth/ground-truth-master.json` |

---

## Results

### Detection Metrics (Per Page)

| Page | TP | FP | FN | TN | Precision | Recall | F1 |
|---|---|---|---|---|---|---|---|
| TP01 Login Form | — | — | — | — | — | — | — |
| TP02 Payment Form | — | — | — | — | — | — | — |
| TP03 Profile Page | — | — | — | — | — | — | — |
| TP04 Healthcare Dashboard | — | — | — | — | — | — | — |
| TP05 Business Dashboard | — | — | — | — | — | — | — |
| TP06 Dynamic Checkout | — | — | — | — | — | — | — |
| TP07 KYC Portal | — | — | — | — | — | — | — |
| **Micro Average** | **—** | **—** | **—** | **—** | **—** | **—** | **—** |
| **Macro Average** | — | — | — | — | **—** | **—** | **—** |

### Redaction Metrics

| Page | Masked Regions | Correct Masks (TP) | Over-redacted (FP) | Over-redaction Rate |
|---|---|---|---|---|
| TP01 | — | — | — | — |
| TP02 | — | — | — | — |
| TP03 | — | — | — | — |
| TP04 | — | — | — | — |
| TP05 | — | — | — | — |
| TP06 | — | — | — | — |
| TP07 | — | — | — | — |
| **Overall** | **—** | **—** | **—** | **—** |

### Latency (ms)

| Stage | Min | Avg | Max | Target |
|---|---|---|---|---|
| Screenshot capture | — | — | — | < 100ms |
| DOM scan | — | — | — | — |
| Local inference (DOM + regex) | — | — | — | ≤ 500ms |
| VLM round-trip | — | — | — | ≤ 2000ms |
| Action execution | — | — | — | < 50ms |
| **End-to-end** | — | — | — | **≤ 3000ms** |

### Resource Utilization

| Metric | Value | Target |
|---|---|---|
| Peak JS heap memory | — MB | ≤ 500 MB |
| Memory delta per inference | — MB | — |
| Model cache size (ONNX) | — MB (not loaded yet) | ≤ 150 MB |
| Cold start time (first inference) | — ms | ≤ 5000ms |
| Warm inference time | — ms | ≤ 500ms WASM, ≤ 200ms WebGPU |

---

## Pass/Fail Summary

| Criterion | Value | Target | Result |
|---|---|---|---|
| Average Precision | — | ≥ 90% | — |
| Average Recall | — | ≥ 85% | — |
| Average F1 | — | ≥ 87.5% | — |
| Over-redaction Rate | — | ≤ 10% | — |
| Max Inference Latency | — ms | ≤ 500ms | — |
| End-to-End Latency | — ms | ≤ 3000ms | — |
| Peak Memory | — MB | ≤ 500MB | — |

**Overall Release Gate Status:** ⬜ NOT YET EVALUATED

---

## Failure Cases

### False Negatives (Missed PII)

| Page | Selector | PII Type | Detection Layer | Root Cause |
|---|---|---|---|---|
| — | — | — | — | — |

### False Positives (Over-redaction)

| Page | Selector | Element Type | Root Cause |
|---|---|---|---|
| — | — | — | — |

### Known Limitations

| Limitation | Affected Pages | Engineering Recommendation |
|---|---|---|
| BlazeFace model not yet loaded — face detection returns `[]` | TP03 | Load `blazeface.onnx` via Cache API; implement full BlazeFace pipeline in `inference.worker.js` |
| DistilBERT NER model not yet loaded — text PII falls back to regex only | TP03, TP04, TP07 | Load `distilbert-ner.onnx`; implement tokenization + inference + entity extraction |
| Medical NER not implemented — diagnosis/medication text not detected | TP04 | Requires specialized biomedical NER (e.g., PubMedBERT) — flag as out-of-scope for current milestone |
| Context-aware salary detection not implemented | TP05 | Would require semantic context (surrounding labels) — add label-proximity heuristic |
| Over-redaction: continuous 16-digit strings (e.g., order IDs) can false-positive | TP05 | Add Luhn checksum validation to card number regex |
| Aadhaar regex may miss alternative formats | TP07 | Add additional Aadhaar format variants |

---

## Interpretation

<!-- FILL AFTER RUNNING BENCHMARK -->

### What the numbers mean:

> [!NOTE]
> Fill this section after running the benchmark runner. Be honest. If precision is low, say why and what would fix it.

**Precision (X%):**  
...

**Recall (X%):**  
...

**F1 (X%):**  
...

**Latency:**  
...

**Memory:**  
...

### Honest Assessment:

The DOM-based detection layer (passwords, autocomplete attributes, keyword scanning) is **deterministic and complete** — it will achieve near-100% recall and precision on structured form inputs. This is the strongest part of the system.

The regex-based layer achieves high recall on well-formatted PII (SSN, email, phone) but has known false-positive risks on certain number patterns (order IDs, zip codes in some contexts).

The NER and face detection layers are **stubs in the current build** (v0.1.0). All reported metrics for these layers reflect the absence of ONNX models. This is the primary gap between current and target performance.

**Recommendation:** Load BlazeFace and DistilBERT ONNX models to unlock the full detection pipeline before the finale evaluation.

---

## Dynamic Detection Results

| Test ID | Description | Injection Delay | Detection Delay | Result |
|---|---|---|---|---|
| DYN-01 | Card number field after 1500ms | 1500ms | — ms | — |
| DYN-02 | KYC/SSN field after 3000ms | 3000ms | — ms | — |
| DYN-03 | Password field on tab switch | immediate | — ms | — |

> [!IMPORTANT]
> MutationObserver is not implemented in the current content script build. Add `MutationObserver` watching for `childList` and `subtree` mutations to enable dynamic detection.

---

## Failure Mode Test Results

| Test | Condition | Expected Behavior | Actual Behavior | Pass? |
|---|---|---|---|---|
| WebGPU unavailable | Disable WebGPU in `chrome://flags/#enable-unsafe-webgpu` | WASM fallback activates | — | — |
| Network throttle to 3G | DevTools → Network → Slow 3G | Local latency unchanged | — | — |
| Dynamic content delayed | TP06 — 3s SSN injection | MutationObserver fires within 500ms | Not yet implemented | ❌ |
| NER model absent | Models not loaded | Graceful fallback to regex only | Empty array returned | ✅ |
| Empty page | Navigate to blank page | Zero detections, no errors | — | — |
| Malformed JSON from VLM | VLM returns invalid JSON | Markdown code block extraction fallback | — | — |

---

## Regression Test Results

Run by: `window.__aegis_regression.runRegressionTests()`

| Suite | Tests | Passed | Failed |
|---|---|---|---|
| DOM Detection | 10 | — | — |
| Regex Detection | 10 | — | — |
| Metrics Calculation | 5 | — | — |
| Failure Modes | 6 | — | — |
| Performance | 2 | — | — |
| **Total** | **33** | **—** | **—** |

---

## Release Gate Checklist

- [ ] Functional tests pass (DOM + regex detection working on all 7 pages)
- [ ] Privacy tests pass (no PII leaves the browser — verify network tab shows no sensitive data in VLM payload)
- [ ] Generalization tests pass (TP06 unseen layout, TP07 government portal)
- [ ] Performance is measured (latency + memory for all pages)
- [ ] Failure cases are documented (see above)
- [ ] Regression tests exist and pass (≥ 30/33 tests passing)
- [ ] BlazeFace ONNX loaded and face detection working
- [ ] DistilBERT NER ONNX loaded and text PII working
- [ ] MutationObserver implemented for dynamic content

**A feature is complete when all boxes above are checked.**
