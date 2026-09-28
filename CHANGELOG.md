# AEGIS X Changelog - Release v0.2.0

## Features & UX Polish
- **Human-in-the-Loop (HITL) Action Approval:** Added a Golden Approval Card allowing users to explicitly Allow/Deny agent actions. Includes voice control support and inline editing for fields/URLs.
- **Drop-and-Fill PDF UX:** Drag & drop a PDF directly into the sidepanel to instantly extract fields and generate an autofill profile.
- **Dashboard Enhancements:** Live scan history, profile statistics, privacy score computation, and audit log exports (JSON and CSV).
- **Aadhaar Masking:** Ensured UIDAI compliance by masking all displayed Aadhaar values to `XXXX XXXX 1234` in the UI.
- **Scanned PDF Fallback:** Added explicit user warnings when a PDF lacks text and requires OCR fallback.
- **Password-Protected PDFs:** Added an interactive UI prompt to handle password-locked PDFs securely.
- **Cross-Domain Session Memory:** The local AI now remembers conversation context for the last few turns per domain.
- **Friendly Errors:** All raw stack traces and debug codes are mapped to clear, actionable human-readable messages.

## Accuracy & Core Pipeline
- **BlazeFace & DistilBERT Hardening:** Resolved race conditions, ensured correct ONNX inference, and properly bridged NER bounding boxes.
- **Dynamic Checkout (MutationObserver):** Tuned debounce rates to 200ms and added safety rescans at 2s/4s to correctly catch injected fields on dynamic pages.
- **Over-Redaction Guards:** Implemented `SAFE_PATTERNS` (allowlists for KPI/metric fields) to achieve ≤10% false positive rates on business dashboards.
- **PII Detection Confidence:** Added extensive regexes covering password inputs, OTPs, PINs, bank accounts, SSNs, and medical/insurance identifiers.
- **Verhoeff Algorithm Checksum:** Validates extracted Aadhaar values using proper cryptographic checksums.

## Architecture & Security
- **Native React/Angular Injection:** Overrode standard `.value` assignment with native InputEvent dispatching for compatibility with legacy framework portals.
- **VLM Rate Limiting:** Queues requests to the Ollama backend to prevent concurrent request crashes.
- **CSP Lockdown:** Hardened `manifest.json` with strict `connect-src 'none'` (except local gateway) for absolute zero-egress enforcement.
- **Crash Recovery:** Ensured the Service Worker properly re-warms models and recovers scans gracefully during Chrome MV3 lifecycle restarts.
- **Tab Capture Guard:** Added protections against scanning `chrome://` and PDF-viewer extensions.
- **Regression Test Harness:** Added `regression-node.test.js` to run the eval harness locally and guarantee pattern integrity.
