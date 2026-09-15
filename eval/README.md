# AEGIS — Evaluation Framework

**QA, Benchmark & Evaluation System for the Privacy-Preserving Browser Agent**

---

## Directory Structure

```
eval/
├── test-pages/                  # 7 synthetic test pages (ground-truth annotated)
│   ├── tp01-login-form.html      Layout: centered card, blue theme
│   ├── tp02-payment-form.html    Layout: dark, two-column grid
│   ├── tp03-profile-page.html    Layout: social profile, sidebar
│   ├── tp04-healthcare-dashboard.html  Layout: clinical, left nav + grid
│   ├── tp05-business-dashboard.html    Layout: KPI + table, purple theme
│   ├── tp06-dynamic-checkout.html      Layout: e-commerce accordion (unseen)
│   └── tp07-kyc-portal.html      Layout: government portal, table-based (unseen)
│
├── ground-truth/
│   └── ground-truth-master.json  All 7 pages: sensitive/non-sensitive annotations
│
├── harness/
│   ├── eval-harness.js           Core evaluation engine (standalone JS)
│   ├── benchmark-runner.html     UI runner — opens all pages, shows aggregate report
│   └── regression-tests.js       33 unit tests for detection and metrics logic
│
└── reports/
    └── benchmark-report-template.md   Fill-in template for formal benchmark reports
```

---

## Five Evaluation Dimensions

| Dimension | Weight | How Measured |
|---|---|---|
| Visual context accuracy | 25% | Element Detection Rate (EDR) — detected vs. GT elements |
| PII detection precision/recall | 20% | TP/FP/FN/TN per page, Precision/Recall/F1 |
| Redaction precision | 20% | Masked region IoU vs. GT sensitive regions |
| Client-side resource utilization | 20% | `performance.memory.usedJSHeapSize`, inference timing |
| End-to-end latency | 15% | captureMs + inferenceMs + vlmMs + actionMs |

---

## Test Page Summary

| Page | Layout | Sensitive Elements | Key Sensitive Types | Purpose |
|---|---|---|---|---|
| TP01 Login Form | Centered card | 2 | password, email | Baseline |
| TP02 Payment Form | Dark two-column | 4 | cc-number, cvv, cc-name, cc-exp | Financial PII |
| TP03 Profile Page | Social sidebar | 6 | name, email, phone, location, DOB, face | Personal PII |
| TP04 Healthcare Dashboard | Clinical nav+grid | 8 | name, SSN, MRN, DOB, phone, insurance, diagnosis, meds | High-density PII |
| TP05 Business Dashboard | KPI + table | 6 | SSN, salary, bank account, API key, password, name | Over-redaction resistance |
| TP06 Dynamic Checkout | E-commerce accordion | 6 | 3× dynamic (1.5s, 3s, tab switch) | MutationObserver test |
| TP07 KYC Portal | Government table-based | 7 | Aadhaar, PAN, PIN, name, DOB, phone, address | Generalization (unseen layout) |

---

## Quick Start

### Option A — Benchmark Runner (Recommended)

1. Load the extension in Chrome (`chrome://extensions → Load unpacked → dist/`)
2. Open `eval/harness/benchmark-runner.html` in Chrome
3. Click **▶ Run All Tests**
4. Wait ~30 seconds for all 7 pages to be evaluated
5. View per-page cards and aggregate metrics
6. Click **⬇ Export JSON** to save the full report

### Option B — DevTools Console (Single Page)

1. Open any test page in Chrome (e.g., `tp01-login-form.html`)
2. Open DevTools (F12) → Console
3. Load the harness:
   ```js
   // Paste the contents of eval/harness/eval-harness.js
   // Then run:
   evalPage()
   ```
4. View structured output in console

### Option C — Regression Tests

1. On any page with `eval-harness.js` loaded:
   ```js
   // Load regression-tests.js, then:
   window.__aegis_regression.runRegressionTests()
   ```
2. See pass/fail for all 33 unit tests

---

## Metrics Computed

### Detection
- True Positive (TP), False Positive (FP), True Negative (TN), False Negative (FN)
- Precision = TP / (TP + FP)
- Recall = TP / (TP + FN)
- F1 = 2 × Precision × Recall / (Precision + Recall)
- Over-redaction Rate = FP / (TP + FP)
- Micro-average and Macro-average across all pages

### Latency
- DOM scan time (`performance.now()` before/after)
- Screenshot capture time (when running inside extension)
- VLM round-trip (when VLM is reachable)
- End-to-end total

### Memory
- `performance.memory.usedJSHeapSize` before and after inference
- Delta and peak in MB

---

## Pass Targets (SIH Rubric)

| Metric | Target |
|---|---|
| Precision | ≥ 90% |
| Recall | ≥ 85% |
| F1 Score | ≥ 87.5% |
| Over-redaction Rate | ≤ 10% |
| Local inference latency | ≤ 500ms |
| End-to-end latency | ≤ 3000ms |
| Peak memory | ≤ 500 MB |

---

## Known Limitations (Current Build v0.1.0)

| Limitation | Impact |
|---|---|
| BlazeFace ONNX not loaded | Face detection returns `[]` — TP03 face recall = 0 |
| DistilBERT NER not loaded | Text PII falls back to regex only — NER entities missed |
| MutationObserver not implemented | Dynamic field detection fails (TP06 DYN-01, DYN-02, DYN-03) |
| No medical NER | TP04 diagnosis/medication text not detected |
| Card number Luhn validation absent | Risk of false-positive on non-Luhn 16-digit strings |

---

## Engineering Recommendations

1. **Highest priority:** Load BlazeFace ONNX model — face detection is a core demo feature
2. **Second priority:** Implement MutationObserver in `content.js` — judges test dynamic pages
3. **Third priority:** Load DistilBERT NER — required for name/location/entity detection
4. **Improvement:** Add Luhn algorithm check to card number regex to reduce FP rate
5. **Improvement:** Add label-proximity heuristic for context-aware salary/financial detection

---

## Release Gate

A feature is **complete** (not just working once) when:

- [ ] Functional tests pass on all 7 pages
- [ ] Privacy tests pass (zero PII leaves browser unredacted)
- [ ] Generalization tests pass (TP06, TP07 — unseen layouts)
- [ ] Performance is measured and within targets
- [ ] All failure cases documented and triaged
- [ ] Regression suite passes (≥ 30/33 tests)

> "Show me this on a webpage you haven't seen before."
> — This framework tests exactly that. TP06 and TP07 were never used during development.
