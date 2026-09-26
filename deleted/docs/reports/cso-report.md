# Security Posture Report

**Date:** 2026-09-20
**Scope:** Full Daily Audit (/cso)
**Target:** AEGIS Chrome Extension & Node.js Gateway

## Executive Summary
The AEGIS architecture demonstrates a strong security foundation, particularly with its "Redact-Before-Transmit" pipeline and "Fail-Closed" strict provenance checking. The design effectively mitigates data exfiltration by ensuring the local VLM never receives unredacted PII. However, a critical Stored XSS vulnerability exists in the extension's dashboard UI due to unsafe string interpolation, which could lead to privilege escalation within the extension context. The dependency supply chain also contains a known medium-severity DoS vulnerability.

## Attack Surface Map
══════════════════
CODE SURFACE (Chrome Extension + Node Gateway)
  Public endpoints:      3 (Local Gateway: /health, /v1/models, /v1/chat/completions)
  Authenticated:         0 
  Admin-only:            0 
  API endpoints:         3 (Local Gateway)
  File upload points:    1 (Popup PDF/Document Drop for Vault)
  External integrations: 1 (Local Ollama VLM integration)
  Background jobs:       1 (Service Worker)
  WebSocket channels:    0

INFRASTRUCTURE SURFACE
  CI/CD workflows:       0
  Webhook receivers:     0
  Container configs:     0
  IaC configs:           0
  Deploy targets:        0
  Secret management:     Local chrome.storage.local (unencrypted at rest)

## Critical & High Findings

### 1. Stored XSS in Extension Dashboard via Unsafe `innerHTML` (HIGH)
**Location:** `src/dashboard/dashboard.js` (Lines 39, 59)
**Description:** The dashboard dynamically constructs HTML tables using raw template literals and assigns them directly to `.innerHTML`. Variables such as `val` (user profile data) and `log.domain` (audit log hostname) are interpolated without HTML escaping.
```javascript
// dashboard.js:39
const val = typeof v === "object" ? v.value : v;
tr.innerHTML = `<td><strong>${labelFor(k)}</strong></td><td><code>${val}</code></td>`;
```
**Impact:** If a user drops a malicious PDF into the vault containing an XSS payload, or if a crafted payload is manually added to the profile, the script will execute in the context of the extension page (`chrome-extension://...`). This provides access to privileged `chrome.*` APIs, allowing an attacker to exfiltrate the entire profile/vault.
**Remediation:** Refactor DOM construction to use `document.createElement()` and `textContent`, or sanitize the `val` and `log.domain` variables using a dedicated HTML escaping function before interpolation. (Note: The chat UI in `sidepanel.js` correctly uses `textContent`—replicate that pattern).

## Medium & Low Findings

### 2. Supply Chain Vulnerability in Development Dependencies (MEDIUM)
**Location:** `package.json` -> `adm-zip <=0.6.0`
**Description:** The `adm-zip` package has a known high-severity vulnerability (GHSA-vwc7-r8mq-g2x9) involving arbitrary file overwrite via destination symlinks and uncontrolled memory allocation (DoS).
**Impact:** Because this is a `devDependency` used likely for packaging or testing, it does not affect the production runtime of the extension. However, it poses a risk to developer machines or CI environments building the extension.
**Remediation:** Run `npm audit fix --force` or upgrade `adm-zip` to `>=0.6.1`.

### 3. Indirect Prompt Injection via DOM Content (MEDIUM)
**Location:** `src/background/background.js` (LLM Payload Construction)
**Description:** The VLM reads the structure and text of the webpage. A malicious website can embed hidden text instructing the VLM to perform unintended actions (e.g., `{"action": "navigate", "url": "http://evil.com"}`).
**Impact:** While the Strict Provenance engine prevents the VLM from hallucinating PII into forms, the VLM can still be tricked into navigating the user to a phishing site or clicking unintended buttons. Data exfiltration is naturally bounded because the VLM cannot "see" the redacted PII, but phishing remains a risk.
**Remediation:** While difficult to entirely solve in VLM-based agents, separating system instructions from user/DOM content more aggressively (e.g., placing DOM content inside explicit `<untrusted_page_content>` XML tags in the prompt) can reduce the success rate of injections.

### 4. Plaintext Storage of PII at Rest (LOW / INFORMATIONAL)
**Location:** `chrome.storage.local`
**Description:** The user's document vault and profile are stored in `chrome.storage.local`.
**Impact:** By default, Chrome does not encrypt local storage on disk. If a user's machine is compromised by local malware, the raw JSON containing their PII and documents can be extracted.
**Remediation:** Informational. For a higher security posture, consider implementing an encryption-at-rest layer requiring a user password to unlock the vault upon browser startup.

## Remediation Plan
1. **Immediate (Next PR):** Patch the Stored XSS in `dashboard.js`. Create an `escapeHtml(str)` utility function (as seen in `sidepanel.js`) and wrap all interpolated variables inside the `innerHTML` blocks, or switch to `document.createElement().textContent`.
2. **Short Term:** Update `adm-zip` to resolve the NPM audit flag. 
3. **Long Term:** Investigate prompt injection defenses for the VLM payload and explore encryption-at-rest for the local vault.
