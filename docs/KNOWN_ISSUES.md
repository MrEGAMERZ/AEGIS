# Known Issues & Future Work

While AEGIS represents a fully functional local-first browser agent architecture, there are several known constraints and edge cases in `v0.1.0`. These are tracked here for the SIH Jury and future development phases.

## 1. WASM Cold Start Latency
**Issue**: The first time a user clicks **Privacy Scan**, the extension must initialize the ONNX Runtime Web environments and load the ~400KB BlazeFace and DistilBERT models into memory. This "cold start" can take anywhere from 3 to 15 seconds depending on hardware.
**Impact**: High latency on initial run.
**Mitigation/Future**: Implement Web Worker pre-warming when the extension loads, or aggressive caching of the ONNX execution provider state.

## 2. WebGPU Availability in Chrome Extensions
**Issue**: While we engineered AEGIS to utilize WebGPU for ML inference, `navigator.gpu` is heavily restricted or entirely hidden inside Manifest V3 Service Workers and Offscreen Documents by default in Chrome 109+.
**Impact**: The system falls back to WASM SIMD, which is slower.
**Mitigation/Future**: Awaiting upstream Chromium relaxing WebGPU restrictions for offscreen canvas contexts, or explicit enterprise flag configurations.

## 3. Large Canvas OOM (Out of Memory)
**Issue**: On extremely long, vertically scrolling pages, the screenshot captured by the Chrome API can exceed 8K resolution. When this is sent to the local Ollama gateway (`localhost:8000`), the `qwen2.5vl:7b` vision runner occasionally runs out of memory or times out.
**Impact**: Run Agent or Fill Form fails on massive pages.
**Mitigation/Future**: Implementing a viewport chunking strategy, or aggressively down-sampling the sanitized PNG inside the offscreen document before dispatching it to the Node gateway.

## 4. In-PDF Visual Redaction
**Issue**: AEGIS flawlessly detects and redacts standard DOM input fields (`type="password"`) and visible HTML text. However, if a user opens a raw PDF file inside the Chrome browser tab, AEGIS cannot currently inject DOM-level blackout boxes over passwords printed inside the PDF structure.
**Impact**: Purely visual edge case. The vault data extraction handles PDFs perfectly, but visual scan overlays on raw PDF tabs are limited.
**Mitigation/Future**: Deep integration with `pdf.js` canvas rendering to apply bounding box blurs directly over the rendered PDF layers.

## 5. Strict Zero-Trust vs KYC Pass-through
**Issue**: We recently introduced a `kycPassThrough` option in the profile extractor to allow legitimate KYC pipelines to bypass the `NEVER_STORE` regex filters for Aadhaar/PAN fields (specifically using Verhoeff validation). If this flag is accidentally inherited by standard untrusted tabs, it could leak PII to local storage.
**Impact**: Security regression risk.
**Mitigation/Future**: Enforce strict Origin boundaries on which URLs can request `kycPassThrough` extraction, limiting it exclusively to whitelisted `.gov.in` domains.
