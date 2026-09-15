# 02 — Architecture

**AEGIS: On-device Visual Perception for Light-weight Browser Agents**

---

## 1. System Overview

The system is a Chrome Extension (Manifest V3) that intercepts screen content locally, applies a three-layer privacy sanitization pipeline, and sends only a sanitized representation to a cloud VLM for agentic task execution.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BROWSER (User's Machine)                        │
│                                                                             │
│  ┌─────────────────────┐    ┌──────────────────────────────────────────┐   │
│  │    Content Script    │    │          Service Worker (MV3)            │   │
│  │  (Injected per-tab)  │    │      Event-driven orchestrator           │   │
│  │                      │    │      No DOM access — delegates to:      │   │
│  │  • DOM field scan    │───▶│      • Offscreen doc (inference + mask) │   │
│  │  • Action execution  │◀───│      • Content script (DOM + actions)   │   │
│  │  • MutationObserver  │    │      • Chrome APIs (storage, tabs)      │   │
│  └─────────────────────┘    └──────────────┬───────────────────────────┘   │
│                                             │                               │
│                            ┌────────────────▼──────────────────────┐        │
│                            │       Offscreen Document              │        │
│                            │   (DOM access for Canvas/WebGL/ORT)   │        │
│                            │                                       │        │
│                            │  ┌─────────────────────────────────┐  │        │
│                            │  │   Inference Worker (Web Worker)  │  │        │
│                            │  │                                   │  │        │
│                            │  │  • ONNX Runtime Web (WASM/GPU)   │  │        │
│                            │  │  • BlazeFace ONNX (faces)        │  │        │
│                            │  │  • DistilBERT NER (text PII)     │  │        │
│                            │  │  • Regex engine (structured PII) │  │        │
│                            │  └──────────────┬──────────────────┘  │        │
│                            │                 │ detections           │        │
│                            │  ┌──────────────▼──────────────────┐  │        │
│                            │  │    Mask Renderer (Canvas 2D)     │  │        │
│                            │  │                                   │  │        │
│                            │  │  • Blur faces (Gaussian, k=21)   │  │        │
│                            │  │  • Black-fill password fields    │  │        │
│                            │  │  • Blur NER PII text regions     │  │        │
│                            │  │  • Output: sanitized image        │  │        │
│                            │  └─────────────────────────────────┘  │        │
│                            └───────────────────┬───────────────────┘        │
│                                                 │                            │
└─────────────────────────────────────────────────┼────────────────────────────┘
                                                  │
                                      ┌───────────▼──────────┐
                                      │   Cloud VLM Server    │
                                      │                       │
                                      │  Qwen3-VL-8B-Instruct │
                                      │  (vLLM / Ollama)      │
                                      │                       │
                                      │  Input: sanitized img  │
                                      │         + page struct  │
                                      │  Output: action coords │
                                      └───────────────────────┘
```

---

## 2. Component Breakdown

### 2.1 Content Script (`content.js`)

**Purpose:** Injected into every active tab. Handles DOM interaction.

**Responsibilities:**
1. Scan DOM for sensitive form fields on page load and on MutationObserver events
2. Extract `innerText` from visible elements for NER text scanning
3. Execute VLM-returned actions (click, type, scroll) on the live DOM
4. Relay messages between DOM and service worker via `chrome.runtime.sendMessage()`

**Key DOM APIs:**
- `document.querySelectorAll('input[type="password"], input[autocomplete*="cc-"]')`
- `element.getBoundingClientRect()` for bounding boxes
- `element.innerText` for text extraction
- `MutationObserver` for dynamic re-detection

### 2.2 Service Worker (`background.js`)

**Purpose:** Event-driven orchestrator. No DOM access.

**Responsibilities:**
1. Receive capture requests from popup, content script, or agent task trigger
2. Call `chrome.tabs.captureVisibleTab()` to get screenshot
3. Route screenshot + DOM scan results to offscreen document for inference
4. Manage VLM API calls (fetch to configured endpoint)
5. Pass VLM responses back to content script for execution
6. Persist config (VLM endpoint, detection toggles) in `chrome.storage.local`

**State management:** All state persisted to `chrome.storage.session` (survives service worker restarts).

### 2.3 Offscreen Document (`offscreen.html`)

**Purpose:** Hidden extension page with DOM/canvas access. Runs inference and mask rendering.

**Constraints:** Only one offscreen document per extension. Created on demand via `chrome.offscreen.createDocument()`.

**Responsibilities:**
1. Host a Web Worker that loads ONNX Runtime Web
2. Run BlazeFace ONNX inference on captured screenshot
3. Run DistilBERT NER inference on extracted DOM text
4. Run regex pre-filters on extracted DOM text
5. Merge all detection results
6. Render mask layer on a `<canvas>` element (blur faces, black-fill passwords, blur PII text)
7. Return sanitized image as data URL to service worker

**Lifecycle:**
```
ensureOffscreen() → check chrome.runtime.getContexts()
  → if no offscreen: createDocument({reasons: ['DOM_PARSER']})
  → send message: {type: 'SANITIZE', screenshot, domScanResults}
  → receive response: {sanitizedImage, maskedRegions}
  → optionally closeDocument() when idle
```

### 2.4 Inference Worker (inside offscreen document)

**Purpose:** Dedicated Web Worker for ONNX Runtime Web inference (keeps main thread free for Canvas operations).

**Responsibilities:**
1. Initialize ONNX Runtime Web session with backend selection:
   - Try WebGPU first: `executionProviders: ['webgpu']`
   - Fallback to WASM: `executionProviders: ['wasm']`
2. Load and cache model weights (BlazeFace ONNX, DistilBERT NER ONNX)
3. Run inference on demand, return detection arrays

**Backend selection logic (runs once at startup):**
```javascript
async function selectBackend() {
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) return 'webgpu';
    } catch (e) { /* fall through */ }
  }
  return 'wasm';
}
```

---

## 3. Data Flow — Sanitization Pipeline

### 3.1 End-to-End Sequence

```
User/Agent triggers task
        │
        ▼
[1] Service Worker: chrome.tabs.captureVisibleTab() → raw screenshot
        │
        ▼
[2] Content Script: DOM scan → sensitive field rects + visible text
        │
        ▼
[3] Offscreen Document receives both:
        │
        ├─▶ [3a] BlazeFace ONNX inference on screenshot → face bboxes
        │
        ├─▶ [3b] Regex pre-filter on text → structured PII spans
        │
        ├─▶ [3c] DistilBERT NER on text → name/loc/org spans
        │
        ▼
[4] Merge all detections into unified RedactionMap:
        │
        │   redactionMap = {
        │     faces: [{bbox, confidence}],
        │     passwordFields: [{selector, rect}],
        │     textPII: [{text, entity, bbox, confidence}],
        │     structuredPII: [{type, start, end, bbox}]
        │   }
        │
        ▼
[5] Mask Renderer (Canvas 2D):
        │
        │   • Draw original screenshot to canvas
        │   • For each face bbox → apply Gaussian blur (kernel 21)
        │   • For each password rect → fillRect with black
        │   • For each text PII bbox → apply Gaussian blur
        │   • For each structured PII bbox → apply Gaussian blur
        │
        ▼
[6] Canvas.toDataURL('image/png') → sanitized image
        │
        ▼
[7] Build Structural Context Payload:
        │   {
        │     sanitized_image: base64,
        │     page_structure: {url, title, fields: [...], masked_regions: [...]},
        │     task: "..."
        │   }
        │
        ▼
[8] Service Worker: fetch(VLM_ENDPOINT, payload)
        │
        ▼
[9] VLM returns: {action: "click", x: 350, y: 310}
        │
        ▼
[10] Content Script executes action on live DOM
```

### 3.2 Detection → Bounding Box Mapping

To render masks correctly, each detection type must be mapped to a pixel-space bounding box on the original screenshot.

| Detection Source | Coordinate System | Mapping Required |
|---|---|---|
| BlazeFace ONNX | Normalized [0,1] on 128×128 input | Scale to original screenshot dimensions |
| DOM field scan | DOM element rect (CSS pixels) | Direct pixel mapping (accounts for devicePixelRatio) |
| NER text entities | Character offsets in `innerText` | Map character range → DOM node → getBoundingClientRect() |
| Regex PII | Character offsets in `innerText` | Same as NER |

**Critical detail:** `chrome.tabs.captureVisibleTab()` returns a high-DPI image. The mapping must account for `window.devicePixelRatio` when converting CSS pixels to image pixels.

---

## 4. VLM Contract

### 4.1 Request Format

```json
{
  "model": "Qwen/Qwen3-VL-8B-Instruct",
  "messages": [
    {
      "role": "system",
      "content": "You are a browser automation agent. You receive a sanitized screenshot where sensitive data (passwords, faces, personal info) has been blurred or redacted for privacy. You also receive a structural description of the page. Based on the user's task, return a single JSON action object. Available actions: {click: {x, y}}, {type: {selector, value}}, {scroll: {direction: 'up'|'down'}}, {navigate: {url}}, {done: {summary}}. Only use actions that do NOT require reading redacted content."
    },
    {
      "role": "user",
      "content": [
        {
          "type": "image_url",
          "image_url": {"url": "data:image/png;base64,<sanitized_image>"}
        },
        {
          "type": "text",
          "text": "Page structure: {page_structure_json}\n\nTask: {task}"
        }
      ]
    }
  ],
  "max_tokens": 256,
  "temperature": 0.1
}
```

### 4.2 Response Format (parsed from VLM output)

```json
{"action": "click", "x": 350, "y": 310}
```

or

```json
{"action": "type", "selector": "#email", "value": "user@example.com"}
```

or

```json
{"action": "done", "summary": "Form submitted successfully"}
```

### 4.3 Key Design Principle

The VLM receives structural context that says "a password input exists here, currently masked" — it does NOT receive the actual password. The extension handles password entry locally via DOM injection when the task requires it, without ever transmitting the password to the VLM.

---

## 5. WASM-First / WebGPU-Accelerated Strategy

### 5.1 Runtime Backend Selection

```
Startup
  │
  ├─▶ navigator.gpu available?
  │     │
  │     YES ──▶ requestAdapter()
  │     │         │
  │     │         ├─ adapter found ──▶ Use WebGPU backend
  │     │         │
  │     │         └─ no adapter ──▶ Use WASM backend
  │     │
  │     NO ──▶ Use WASM backend
  │
  ▼
  Load models with selected backend
```

### 5.2 Why WASM-First

| Factor | WASM | WebGPU |
|---|---|---|
| Browser support (2026) | ~98% of Chrome/Firefox/Edge | ~65-70% of desktop Chrome |
| Setup complexity | Zero-config | Requires `navigator.gpu.requestAdapter()` |
| Speed | Baseline (adequate) | 3-8× faster for GEMM |
| Memory | Higher (no GPU offload) | Lower (GPU memory) |
| Demo safety | Always works | May fail on judges' machines |

**Decision:** WASM is the always-working baseline. WebGPU is an optimization layer activated only when available. The demo MUST work on WASM alone.

### 5.3 Model Weight Caching

Model weights are cached in the browser's Cache API (via Service Worker) to avoid re-downloading on each session.

```
First load:    Download ONNX file → Cache API → run inference
Subsequent:    Read from Cache API (instant) → run inference
Update check:  HEAD request for model URL → compare ETag → re-download if changed
```

Cache budget: ≤150MB total (BlazeFace ~400KB + DistilBERT NER ~66MB + ONNX Runtime ~3MB + overhead).

---

## 6. Security Boundaries

| Boundary | What Crosses | What Doesn't |
|---|---|---|
| Device → Cloud | Sanitized image + structural metadata | Raw screenshots, passwords, PII text |
| Content Script → Offscreen | DOM text, element rects | Nothing leaves the extension context |
| Service Worker → VLM API | Structural context payload | Never raw DOM, never unmasked screenshot |
| VLM → Content Script | Action coordinates/selectors | No sensitive data flows back from VLM |

**Key invariant:** At no point does the raw, unredacted screenshot or any PII string leave the browser. The VLM never sees passwords, faces, or personal data in any form.
