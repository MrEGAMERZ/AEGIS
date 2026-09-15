# 01 — Requirements

**AEGIS: On-device Visual Perception for Light-weight Browser Agents**

---

## 1. Functional Requirements

### FR-01 — Screen Capture

The extension SHALL capture the current visible viewport on demand using `chrome.tabs.captureVisibleTab()`.

- Triggered by: user click, agent task request, or periodic snapshot
- Output: raw PNG/JPEG image data URL
- Host permission required: `<all_urls>` (MV3)

### FR-02 — DOM-Based Field Detection (Layer 1)

The extension SHALL scan the live DOM for form elements with sensitive attributes and mark them for redaction without vision inference.

Detection targets:
| Attribute/Pattern | Detection Logic | Example |
|---|---|---|
| `type="password"` | Direct attribute check | `<input type="password">` |
| `type="text"` with `autocomplete="cc-number"` | Autocomplete attribute parsing | Credit card fields |
| `aria-label` containing "password", "SSN", "credit" | Case-insensitive keyword match | Accessibility-labeled fields |
| `data-testid` or `name` containing "password", "pin", "secret" | Regex on name/testid attributes | Custom form fields |
| Contenteditable divs with numeric-only patterns | Heuristic: 16-digit sequences = potential card number | Inline form editors |

Output: array of `{selector, rect, reason}` objects for each sensitive DOM element.

### FR-03 — Visual Face Detection (Layer 2)

The extension SHALL detect faces in the captured screenshot using a locally running BlazeFace ONNX model.

- Model: BlazeFace ONNX (128×128 input)
- Runtime: ONNX Runtime Web (WASM or WebGPU)
- Output: array of `{bbox: [x1,y1,x2,y2], confidence}` for each face

### FR-04 — Text PII Detection (Layer 3)

The extension SHALL detect personally identifiable information in visible on-screen text using a hybrid regex + NER pipeline.

- **Regex layer** (deterministic, <1ms): SSNs (`xxx-xx-xxxx`), phone numbers, email addresses, dates of birth
- **NER layer** (Transformers.js WASM): person names, locations, organizations via `Xenova/distilbert-base-uncased-finetuned-conll03-english`
- Text source: extracted from DOM `innerText` of visible elements

Output: array of `{text, entity_type, start, end, confidence}`

### FR-05 — Mask Rendering

The extension SHALL render visual masks over detected sensitive elements before the screenshot is transmitted.

| Element Type | Mask Method |
|---|---|
| Faces | Gaussian blur over bounding box (kernel = 21px) |
| Password fields | Solid black fill over input rect |
| NER-detected PII text | Pixel-level blur or black bar over text bounding region |
| Structured PII (SSN/phone/email) | Pixel-level blur over matched region |

Mask rendering SHALL happen on an offscreen canvas (via offscreen document) before any network request.

### FR-06 — Structural Context Payload

The extension SHALL send the VLM a structural summary of the page alongside the sanitized image, so the VLM can reason about layout without seeing sensitive content.

Payload format:
```json
{
  "sanitized_image": "base64...",
  "page_structure": {
    "url": "https://example.com/apply",
    "title": "Loan Application",
    "fields": [
      {"type": "text_input", "label": "Full Name", "masked": true},
      {"type": "password_input", "label": "PIN", "masked": true},
      {"type": "button", "label": "Submit"}
    ],
    "masked_regions": [
      {"type": "face", "bbox": [120, 80, 200, 200]},
      {"type": "password_field", "bbox": [100, 300, 400, 340]}
    ]
  },
  "task": "Fill the loan application form with the provided details"
}
```

### FR-07 — Server VLM Integration

The extension SHALL send the structural context payload to a Qwen3-VL-8B-Instruct server via an OpenAI-compatible chat completions API.

- Endpoint: configurable (default `http://localhost:8000/v1/chat/completions`)
- Request: structural context payload with system prompt describing available actions
- Response: structured action (e.g., `{action: "click", x: 350, y: 310}` or `{action: "type", selector: "#field", value: "..."}`)

### FR-08 — Action Execution

The extension SHALL execute actions returned by the VLM on the active tab via DOM manipulation in the content script.

Supported actions: `click(x,y)`, `type(selector, value)`, `scroll(direction)`, `navigate(url)`

---

## 2. Non-Functional Requirements

### NFR-01 — Visual Accuracy (mapped to 25% scoring weight)

> The local vision model SHALL correctly identify screen elements including text content, UI structure, and interactive elements with sufficient accuracy for the VLM to complete tasks.

Measurable target: ≥90% of UI elements correctly represented in the structural context payload (measured against ground-truth test pages).

### NFR-02 — PII Detection Recall/Precision (mapped to 20% scoring weight)

> The PII detection pipeline SHALL achieve high recall (minimize missed detections) and reasonable precision (minimize false positives) across face detection, password field detection, and text PII detection.

Measurable targets:
- Face detection recall: ≥95% on faces occupying >5% of viewport
- Password field detection: 100% (DOM-based, deterministic)
- Text PII recall: ≥85% on names/locations in visible text
- Text PII precision: ≥80% (avoid over-redacting non-sensitive text)

### NFR-03 — Redaction Precision (mapped to 20% scoring weight)

> The redaction system SHALL correctly mask exactly the sensitive elements identified, avoiding both under-redaction (missed PII) and over-redaction (masking non-sensitive content that breaks agent understanding).

Measurable targets:
- Redaction precision: ≥90% (of elements masked, ≥90% were correctly sensitive)
- No over-redaction of labels, navigation, or non-sensitive UI text

### NFR-04 — Client-side Resource Utilization (mapped to 20% scoring weight)

> The extension SHALL run within reasonable browser resource constraints.

Measurable targets:
- Peak memory: ≤500MB (combined model weights + inference buffers)
- CPU utilization: ≤30% average during inference on mid-range laptop
- Model weight cache: ≤150MB on disk after first load
- No memory leaks across repeated inference cycles

### NFR-05 — End-to-end Latency (mapped to 15% scoring weight)

> The full capture → detect → mask → send → VLM response → execute loop SHALL complete within acceptable time for interactive use.

Measurable targets:
- Local inference (capture to mask render): ≤500ms via WASM, ≤200ms via WebGPU
- Full E2E loop (capture to action execution): ≤3s including VLM round-trip
- Cold start (first inference, includes model load): ≤5s

---

## 3. Redaction Taxonomy

| Category | Detection Method | Mask Style | Priority |
|---|---|---|---|
| Faces | BlazeFace ONNX visual detection | Gaussian blur | High |
| Password fields | DOM `type="password"` attribute | Solid black fill | Critical |
| Autocomplete-sensitive fields | DOM `autocomplete` attribute parse | Solid black fill | High |
| Person names (visible text) | NER `PER` / `B-PER` / `I-PER` entities | Blur | High |
| Locations (visible text) | NER `LOC` entities | Blur | Medium |
| Organizations (visible text) | NER `ORG` entities | Blur | Medium |
| SSNs (visible text) | Regex `\d{3}-\d{2}-\d{4}` | Blur | Critical |
| Phone numbers | Regex phone pattern | Blur | Medium |
| Email addresses | Regex email pattern | Blur | Medium |
| Credit card numbers | Regex 16-digit + luhn check | Blur | Critical |

---

## 4. MVP Scope vs. Stretch Goals

### MVP (must ship)

- [ ] Chrome extension (MV3) that captures screen and runs BlazeFace ONNX face detection locally
- [ ] DOM-based password field detection (type=password + autocomplete)
- [ ] Hybrid regex + DistilBERT NER text PII detection via Transformers.js WASM
- [ ] Combined mask render on offscreen canvas (faces blurred, passwords blacked, PII blurred)
- [ ] Structural context payload sent to Qwen3-VL-8B server
- [ ] End-to-end demo: fill a fake loan form without transmitting PII
- [ ] WASM fallback path working (universal browser support)

### Stretch Goals (if time permits)

- [ ] WebGPU acceleration path with automatic fallback
- [ ] Dynamic re-detection on DOM mutations (MutationObserver)
- [ ] Generalization test across 3+ unseen webpages
- [ ] Benchmark harness with precision/recall/latency numbers
- [ ] Firefox support via conditional offscreen API branching
- [ ] Extension popup UI showing redaction status/counts

---

## 5. Traceability Matrix (Requirement → Scoring Criterion)

| Requirement | Scoring Criterion | Weight |
|---|---|---|
| FR-01 + FR-02 + FR-03 + FR-04 | Visual Accuracy | 25% |
| FR-03 + FR-04 | PII Detection Recall/Precision | 20% |
| FR-05 | Redaction Precision | 20% |
| NFR-04 | Client-side Resource Utilization | 20% |
| NFR-05 | End-to-end Latency | 15% |
