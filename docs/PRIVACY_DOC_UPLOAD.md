# PRIVACY_DOC_UPLOAD.md — Document Upload Trust Boundary

**SIH26171 (Aegis). Source:** privacy-engineer audit 2026-09-06 (findings D1–D10, `engineers/privacy/work_done.md`). Status: **enforced in code + harness** (D9/D3/D4/D6 closed 2026-09-06).

---

## 1. The boundary

The extension may transmit **extracted text of the user's own uploaded document** to the **local VLM only** (`http://localhost:<port>`, gateway `:8000` or other loopback), **only after explicit per-upload consent**. Raw document bytes, document images, and vault text **never leave the device**. Aadhaar/PAN/licence/UPI/CVV/passport/SSN values are **extract-and-discard**: stripped before the text is sent to the local VLM and before it is written to the vault — never persisted, never transmitted, not even locally.

**Honest claim:** "document exposure is reduced to the user's own device, a local model process the user runs, and a consent-gated transfer" — NOT "the document never exists outside the browser" (it transits the local gateway to the local model).

## 2. Flows and enforcement points

- **F1 upload:** popup file input → `EXTRACT_DOCUMENT_TEXT` (ArrayBuffer/base64) → offscreen. In-extension structured clone; never logged; response is `{ text }` only (never echo bytes).
- **F2 extraction:** offscreen pdf.js (lazy) / zip+DOCX XML / TXT → **text only**, no rendered doc image.
- **F3 pre-strip:** `stripNeverStore(text)` BEFORE F4 and BEFORE vault write (**input-side strip**).
- **F4 structuring:** `STRUCTURE_DOCUMENT_TEXT` → background → HTTP POST. **Only permitted device exit — loopback only**: `isLocalVlmEndpoint(resolved)` else refuse; then consent re-checked at fetch time (`consented === true` or `docConsent`); fail closed like `assertReadyForVlm`.
- **F5 fields:** structured fields → `aegisProfiles[name]` + `userProfile` via shared `mergeIntoUserProfile()` (output strip = defense-in-depth).
- **F6 vault:** `aegisDocVault` (pre-stripped text only; capped ≤5 docs / ≤256 KB; purge on revocation via `CLEAR_DOC_VAULT`).

## 3. Never-store: input AND output

Output-only strip is insufficient — tokens would ride to the local VLM and into the vault first. Input strip redacts tokens (`[REDACTED]`) pre-VLM/pre-vault; keep output strip. **Accept over-redaction:** patterns are deterministic and high-precision; privacy feature fails closed.

## 4. Pattern coverage (`NEVER_STORE_KEY` + value regexes, enforced 2026-09-06)

Keys: `aadhaar|uidai|pan\b|cvv|cvc|passport|upi|ssn|bank.?account|credit.?card|debit.?card|licen[cs]e|driving|dl\b|voter|elector|account.?no|account.?number|card.?number|ifsc|iban|swift`

Values: Aadhaar `[2-9]\d{3}\s?\d{4}\s?\d{4}`, PAN `[A-Z]{5}[0-9]{4}[A-Z]`, driving licence `[A-Z]{2}[- ]?\d{13}`, UPI handle `[\w.\-]{2,}@[a-z]{2,}`, passport `[A-Z][1-9]\d{7}`, bank `\b\d{9,18}\b` (document context; false positives accepted).

## 5. Storage rules

Vault = pre-stripped text only in `chrome.storage.local` (plaintext at rest — honest UI copy required: "stored unencrypted on this device"); cap ≤5 docs / ≤256 KB; full purge on revoke/clear; revocation removes vault entry **and** `_docSource`-marked profile fields; audit log keeps counts/domain only.

## 6. VLM endpoint rules

`STRUCTURE_DOCUMENT_TEXT` requires `isLocalVlmEndpoint(resolved)` — non-local ⇒ refusal, no fetch, no gateway 403-bounce to a remote-upstream gateway. The **RAG-lite fill prompt** (`CAPTURE_AND_SANITIZE`) injects the `DOCUMENT KNOWLEDGE` block **only when the resolved endpoint is local**; on the remote path the vault provenance cache is cleared and vault-sourced `type` values fail closed.

**Pre-existing accepted risk (unchanged):** typed `userProfile` PII in the system prompt already crosses to configured remote endpoints; the doc feature must NOT inherit that.

## 7. Parsing untrusted documents

- pdf.js `version >= 4.2.67` (CVE-2024-4367 fix) asserted at init; `isEvalSupported: false` in every `getDocument()`; same-origin worker; extraction only (`textContent`).
- Refuse >20 MB / >200 pages / >10,000 text items; DOCX pure-JS zip, decompressed cap 50 MB.
- Doc text is untrusted input: it never enters page-capture prompts on the remote path (see §6).

## 8. RAG-lite prompt-injection isolation

Vault text is untrusted input to the VLM and MUST NOT be concatenated into `CAPTURE_AND_SANITIZE` prompts when the endpoint may be remote. RAG-lite fill uses structured, stripped profile fields only on the consented local path; `sanitizeAction` value-match guard stays last line of defense.

## 9. Verification checklist (harness — all passing 2026-09-06)

1. Remote endpoint ⇒ refusal, no fetch. ✅ `doc-vault.test.js` 104/104
2. Consent off ⇒ refused at fetch time. ✅
3. Doc text with Aadhaar/PAN ⇒ request body + vault contain `[REDACTED]` only. ✅
4. No storage key ever holds raw base64 doc bytes; response is `{ text }` only. ✅
5. Vault cap eviction + full purge on clear/revoke. ✅
6. pdf.js version assert + `isEvalSupported:false` at every call site. ✅ (`document-extract.test.js` 65/65)
7. Vault text absent from remote-path `CAPTURE_AND_SANITIZE` payloads. ✅