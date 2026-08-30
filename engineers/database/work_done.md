# Database & Persistence Work Report

**Lead note (2026-08-28):** the `userProfile`/`normalizeProfile` "missing from src/" finding below was accurate at the time it was made — it was a repo-recovery gap (an earlier checkpoint commit hadn't been fully restored to the working tree yet), not unlanded backend/frontend work. It has since been restored and verified present in `src/`. See `docs/STORAGE_CONTRACT.md` for the corrected, verified contract. The F-11 assessment and schema table below stand as good, still-valid engineering judgment.

*(Fill out this table when the task is complete)*

| Item | Status | Notes/Blockers |
|---|---|---|
| Storage schema audit | Done | Read `background.js`, `popup.js`, `offscreen.js`, `content.js`, `inference.worker.js` directly and grepped repo-wide for `storage.local`/`storage.session`/`storage.sync`. Enumerated 6 live `chrome.storage.local` keys (`vlmEndpoint`, `vlmModel`, `detectionEnabled`, `faceDetection`, `passwordDetection`, `piiDetection`) and 1 `chrome.storage.session` key (`lastReceipt`), each with writer/reader call sites. No `storage.sync` usage anywhere (confirmed no local/sync confusion). |
| `docs/STORAGE_CONTRACT.md` | Created | Full table of every persisted key (name, area, shape, writer, reader, sensitivity, retention), plus sections on Cache API (model weights — currently stubbed, not yet writing anything) and `eval/ground-truth/*.json` fixtures. |
| `userProfile` contract | **Discrepancy found** | `engineers/backend/work_done.md` and `engineers/frontend/work_done.md` describe a shipped `userProfile` key + `normalizeProfile()` fallback parser. I verified directly against the actual files at HEAD (`e4c44d6`, clean working tree) and found **no `userProfile`/`normalizeProfile` reference anywhere under `src/`** — not in `background.js`, not in `popup.js`/`popup.html`. Documented the intended canonical contract (JSON object, with JSON-string/legacy-text fallback) in `docs/STORAGE_CONTRACT.md` §1 as forward-looking, flagged as unverified-against-code, and raised to the Lead as an open item requiring reconciliation (either the work is unlanded, or I'm viewing a stale checkout). |
| Storage safety check (extract-and-discard) | **Pass** | Traced every `storage.*.set()` call site (3 total). Confirmed matched PII text (Aadhaar/PAN/SSN/email/phone) from `detectTextPII()` is used only for in-memory canvas redaction and is never written to any persistence layer — only aggregate counts reach `chrome.storage.session.lastReceipt`. No Aadhaar/PAN/licence numbers persisted anywhere. |
| F-11 assessment (VLM endpoint stored unencrypted) | **Disagree with finding as worded — recommend accepted-risk, not a fix** | `vlmEndpoint` is a user-configured local/self-hosted server address (e.g. Ollama), not a secret; no API key/token is embedded in it anywhere in the code I read. `chrome.storage.local` (local-only, not synced) is the correct storage area for this. Full reasoning + forward-looking guardrail (future hosted-VLM API keys should go in `chrome.storage.session`, not `.local`) in `docs/STORAGE_CONTRACT.md` §7. Recommend privacy engineer downgrade F-11 from "Leaking" to "Accepted risk". |
| Other findings (not in scope to fix this pass) | Flagged only | `detectionEnabled` key is written on install but never read anywhere (dead key). `vlmModel` default string differs between `background.js` (`qwen2.5vl:7b`) and `popup.js`'s fallback (`Qwen/Qwen3-VL-8B-Instruct`). Both noted in `docs/STORAGE_CONTRACT.md` §8 for a future change; no `src/*.js` edits made per this task's scope. |

## 2026-08-28 — `faceDetection` is now a live-path consumer (Task 2.8)

**Schema change:** no new keys. `faceDetection` (boolean, default `true`) was already written by `onInstalled` and the popup checkbox. It is now **read** by `handleCaptureAndSanitize()` and forwarded on the `SANITIZE` message so offscreen can skip or require the BlazeFace pass.

**Contract:** `docs/STORAGE_CONTRACT.md` readers column for `faceDetection` updated to include background.js (live VLM gate). Opt-out (`false`) remains user-controlled; default stays `true`.

**Not changed:** no encryption, no `storage.session` move, no new PII persisted. Face boxes still extract-and-discard (counts only on `lastReceipt`).

## 2026-08-28 — `piiDetection` is now a live-path consumer (Task 2.9)

**Schema change:** no new keys. `piiDetection` (boolean, default `true`) was already written by `onInstalled` and the popup. It is now **read** by `handleCaptureAndSanitize()` and forwarded on `SANITIZE` so offscreen can require the DistilBERT NER pass (PER/ORG/LOC) before the VLM call.

**Contract:** `docs/STORAGE_CONTRACT.md` readers column for `piiDetection` should list background.js (live NER gate). Opt-out (`false`) remains user-controlled; default stays `true`. Matched entity strings are still extract-and-discard — only aggregate counts on `lastReceipt`.

## 2026-08-28 — New session key `vlmApiKey` (hosted VLM / Gemini)

**Schema change:** `chrome.storage.session.vlmApiKey` (string, High sensitivity, session-only). Written by `SET_VLM_API_KEY`. Read by `handleCaptureAndSanitize` for Bearer auth on non-localhost endpoints. `GET_VLM_API_KEY_STATUS` returns `{ configured: boolean }` only.

**Guard:** `sanitizeLocalConfig()` strips `vlmApiKey`/`apiKey`/`authorization`/`token`/`secret` from every `SET_CONFIG`/`GET_CONFIG` so the credential cannot persist in `chrome.storage.local`.

**Not persisted:** API key is never in `lastReceipt`. Closing the browser clears it.

See `docs/STORAGE_CONTRACT.md` §2.

