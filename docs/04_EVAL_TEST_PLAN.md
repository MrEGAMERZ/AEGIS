# 04 — Evaluation & Test Plan

**AEGIS: On-device Visual Perception for Light-weight Browser Agents**

---

## 1. Metrics by Scoring Criterion

### 1.1 Visual Accuracy — 25% of score

**What it measures:** Does the local model correctly understand what is on screen?

**How we measure it:**
- Define a set of UI elements on each test page (buttons, inputs, text blocks, images, navigation)
- After the structural context payload is built, compare detected elements against ground-truth
- Metric: **Element Detection Rate (EDR)** = (correctly detected elements / total ground-truth elements) × 100%

**Target:** ≥90% EDR across all test pages.

**Instrumentation:**
```javascript
const groundTruth = loadGroundTruth('test-page-login.json'); // known elements
const detected = buildStructuralPayload(page);
const edr = groundTruth.filter(gt =>
  detected.fields.some(d => d.label === gt.label && d.type === gt.type)
).length / groundTruth.length * 100;
console.log(`Visual Accuracy EDR: ${edr}%`);
```

### 1.2 PII Detection Recall/Precision — 20% of score

**What it measures:** Does the system reliably find sensitive elements?

**Metrics:**
- **Recall** = TP / (TP + FN) — what % of actual PII was detected
- **Precision** = TP / (TP + FP) — what % of detected items were actually PII
- Measured separately for each detection layer, then averaged weighted

**Per-layer metrics:**

| Layer | Recall Target | Precision Target | How Measured |
|---|---|---|---|
| Face detection (BlazeFace) | ≥95% | ≥90% | Compare detected face bboxes against hand-annotated face positions on test images |
| Password fields (DOM) | 100% | 100% | Deterministic — `type="password"` attribute is ground truth |
| NER text PII (names/locs) | ≥85% | ≥80% | Compare NER entity spans against hand-annotated PII in test page text |
| Regex structured PII | 100% | ≥99% | Regex patterns are deterministic for structured formats |

**Composite PII score:** Weighted average where face detection and NER carry equal weight (since DOM and regex are deterministic/perfect).

### 1.3 Redaction Precision — 20% of score

**What it measures:** Does the system redact *correctly* — not too little, not too much?

**Metrics:**
- **Redaction Precision** = (correctly masked regions / total masked regions) × 100%
- **Redaction Recall** = (correctly masked sensitive regions / total actual sensitive regions) × 100%
- **Over-redaction rate** = (non-sensitive regions masked / total masked regions) × 100%

**Target:** Redaction precision ≥90%, over-redaction rate ≤10%.

**Why over-redaction matters:** If the system blurs the entire form (not just the password field), the VLM cannot understand the page structure and the agent fails. Redaction must be surgical.

**Instrumentation:**
```javascript
// For each masked region, check if it overlaps with a known-sensitive region
// or a known-non-sensitive region
for (const region of maskedRegions) {
  const overlapsSensitive = groundTruthSensitive.some(s => iou(region.bbox, s.bbox) > 0.5);
  const overlapsNonSensitive = groundTruthNonSensitive.some(s => iou(region.bbox, s.bbox) > 0.5);
  if (overlapsSensitive) tp++;
  else if (overlapsNonSensitive) fp_overredact++;
  else unknown++;
}
```

### 1.4 Client-side Resource Utilization — 20% of score

**What it measures:** Is the model genuinely lightweight?

**Metrics:**

| Metric | How Measured | Target |
|---|---|---|
| Peak memory | `performance.memory.usedJSHeapSize` (Chrome) at inference peak | ≤500MB |
| Model cache size | Sum of all ONNX files in Cache API | ≤150MB |
| CPU utilization | Average `performance.now()` duty cycle during inference | ≤30% avg |
| Cold start time | Time from first inference call to first result (includes model download) | ≤5s on good connection |
| Warm inference time | Time for inference after model is cached | ≤500ms WASM, ≤200ms WebGPU |

**Instrumentation:**
```javascript
const memBefore = performance.memory.usedJSHeapSize;
const t0 = performance.now();
const result = await runInference(screenshot);
const t1 = performance.now();
const memAfter = performance.memory.usedJSHeapSize;

console.log(`Inference: ${t1 - t0}ms`);
console.log(`Memory delta: ${(memAfter - memBefore) / 1024 / 1024}MB`);
console.log(`Peak heap: ${memAfter / 1024 / 1024}MB`);
```

### 1.5 End-to-end Latency — 15% of score

**What it measures:** Is the full loop fast enough to be usable?

**Metrics:**

| Stage | Measurement Point | Target |
|---|---|---|
| Screenshot capture | `captureVisibleTab` callback | <100ms |
| Local inference + mask | Start of inference to sanitized image ready | ≤500ms |
| VLM round-trip | fetch() call to response received | ≤2s |
| Action execution | DOM manipulation call | <50ms |
| **Full E2E** | User/agent trigger → action executed | ≤3s |

**Instrumentation (full loop):**
```javascript
const t_start = performance.now();
const screenshot = await captureVisibleTab();               // t1
const {sanitized, payload} = await sanitize(screenshot);     // t2
const vlmResponse = await callVLM(payload);                  // t3
await executeAction(vlmResponse);                             // t4
const t_end = performance.now();

console.log(`Capture: ${t1 - t_start}ms`);
console.log(`Local sanitize: ${t2 - t1}ms`);
console.log(`VLM round-trip: ${t3 - t2}ms`);
console.log(`Action exec: ${t4 - t3}ms`);
console.log(`Total E2E: ${t_end - t_start}ms`);
```

---

## 2. Ground-Truth Test Page Suite

Build 5 self-contained HTML test pages with known PII positions. Each page is a complete, realistic web form/screen.

### Test Page 1: Login Form

```
Elements: email input, password input, "Remember me" checkbox, Submit button
Known PII: email address (visible), password (masked by type=password)
Expected detections: password field (DOM), email regex match
Expected masks: password field black-fill, email blurred
```

### Test Page 2: Payment Form

```
Elements: cardholder name input, card number input, expiry, CVV, billing address
Known PII: cardholder name (NER target), card number (16-digit regex), CVV (password-type)
Expected detections: CVV (DOM), card number (regex), name (NER)
Expected masks: CVV black-fill, card number blurred, name blurred
```

### Test Page 3: Profile Page with Photo

```
Elements: profile photo (face), name heading, bio text, location text, email
Known PII: face in photo (BlazeFace), name (NER), location (NER), email (regex)
Expected detections: face bbox (visual), name span (NER), email (regex)
Expected masks: face blurred, name blurred, email blurred
```

### Test Page 4: Video Call Interface

```
Elements: two face thumbnails (small), chat sidebar with names, shared document with PII
Known PII: faces (may be small — tests BlazeFace limits), names in chat, PII in document text
Expected detections: faces (if >5% viewport), chat names (NER), document PII (NER + regex)
Expected masks: face regions blurred, name text blurred, document PII blurred
```

### Test Page 5: Mixed-PII Dashboard

```
Elements: multiple form fields, some with PII, some without; labels and navigation elements
Known PII: selective fields with passwords, names, SSNs; non-sensitive labels and headings
Expected detections: correct subset only — NOT all text blurred
Expected masks: ONLY sensitive regions masked; labels/navigation remain readable
Purpose: tests over-redaction resistance (Redaction Precision criterion)
```

### Test Page Annotations Format

Each test page ships with a JSON annotation file:

```json
{
  "page": "test-login.html",
  "sensitive_elements": [
    {"type": "password_field", "selector": "#password", "bbox": [100, 300, 400, 340]},
    {"type": "email_text", "text": "user@example.com", "bbox": [100, 400, 250, 420]}
  ],
  "non_sensitive_elements": [
    {"type": "label", "text": "Email", "bbox": [100, 370, 140, 390]},
    {"type": "button", "text": "Submit", "bbox": [300, 500, 400, 540]}
  ],
  "expected_detections": {
    "face_count": 0,
    "password_field_count": 1,
    "ner_entities": ["user@example.com"],
    "regex_matches": ["user@example.com"]
  }
}
```

---

## 3. Generalization Protocol

The PS explicitly says: *"Use cases for evaluation will be provided during finale."* We don't know the exact test scenarios — we must demonstrate generalization.

### 3.1 Cross-Page Test

Run the full pipeline on all 5 test pages and measure average metrics. Target: no page scores below 80% on any criterion.

### 3.2 Unseen Layout Test

Build 2 additional test pages NOT used during development — different HTML structure, different CSS, different form layouts. Run the pipeline and report metrics. This simulates what judges will do (show a page you haven't tested against).

### 3.3 Dynamic Content Test

Test that MutationObserver-triggered re-detection catches:
- A password field that appears after clicking "Show advanced options"
- A face that appears in a video call thumbnail after joining
- PII text that loads asynchronously (simulated with `setTimeout`)

### 3.4 Judge Stress-Test Simulation

Prepare to answer the question: *"Show me this working on a completely different website you haven't tested against."*

Protocol: open a real public webpage (e.g., a real banking login page, a real healthcare portal) and run the extension live. Have this pre-tested but not polished — authenticity matters more than perfection.

---

## 4. Benchmarking Harness Design

### 4.1 Automated Benchmark Script

```typescript
// benchmark.ts — runs in the extension's offscreen document context

interface BenchmarkResult {
  page: string;
  visualAccuracy: { edr: number };
  piiDetection: { recall: number; precision: number };
  redaction: { precision: number; overRedactionRate: number };
  resources: { peakMemoryMB: number; cacheSizeMB: number };
  latency: { captureMs: number; localInferenceMs: number; vlmRoundTripMs: number; totalE2eMs: number };
}

async function runBenchmark(testPages: string[]): Promise<BenchmarkResult[]> {
  const results: BenchmarkResult[] = [];

  for (const pageUrl of testPages) {
    // Navigate to page
    await navigateTo(pageUrl);
    await waitForStable();

    // Capture
    const t0 = performance.now();
    const screenshot = await captureVisibleTab();
    const t1 = performance.now();

    // Local inference + mask
    const t2 = performance.now();
    const { sanitized, payload, detections } = await fullSanitizationPipeline(screenshot);
    const t3 = performance.now();

    // VLM round-trip (optional — can be mocked for local benchmarks)
    const t4 = performance.now();
    // const vlmResponse = await callVLM(payload);
    const t5 = performance.now();

    // Evaluate against ground truth
    const groundTruth = loadGroundTruth(pageUrl);
    const edr = computeEDR(detections, groundTruth);
    const { recall, precision } = computePIIMetrics(detections, groundTruth);
    const { redactionPrecision, overRedactionRate } = computeRedactionMetrics(detections, groundTruth);

    results.push({
      page: pageUrl,
      visualAccuracy: { edr },
      piiDetection: { recall, precision },
      redaction: { precision: redactionPrecision, overRedactionRate },
      resources: {
        peakMemoryMB: performance.memory.usedJSHeapSize / 1024 / 1024,
        cacheSizeMB: await getCacheSize(),
      },
      latency: {
        captureMs: t1 - t0,
        localInferenceMs: t3 - t2,
        vlmRoundTripMs: t5 - t4,
        totalE2eMs: t5 - t0,
      },
    });
  }

  return results;
}
```

### 4.2 Output Format

Results are logged to console and saved to `chrome.storage.local` for later retrieval. During the demo, results are displayed in the extension popup or a dedicated results page.

---

## 5. Known Failure Modes to Test For

| Failure Mode | Test | Expected Behavior |
|---|---|---|
| Face too small for BlazeFace | Video call page with tiny thumbnails | Log warning, continue (NER/regex still work) |
| NER false positive on non-PII | Dashboard page with brand names, product names | Over-redaction rate increases — track and report |
| WebGPU unavailable | Disable WebGPU in chrome://flags | WASM fallback activates seamlessly |
| Slow network to VLM | Throttle network to 3G in DevTools | Local latency unchanged; E2E increases but local work still fast |
| Dynamic content appears late | Password field appears 2s after page load | MutationObserver triggers re-detection within 500ms |
