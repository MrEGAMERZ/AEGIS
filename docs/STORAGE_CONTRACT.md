# AEGIS — Storage Contract

**Owner:** Database & Persistence Engineer
**Status:** Living document — any storage-key or schema change MUST update every consumer in the same change and be reported to the Lead.
**Last verified against code:** 2026-08-28 (read `src/background/background.js`, `src/popup/popup.js`, `src/offscreen/offscreen.js`, `src/content/content.js`, `src/inference/inference.worker.js` directly; grepped repo-wide for `storage.local`, `storage.session`, `storage.sync`, `userProfile`, `normalizeProfile`, `caches.`, `indexedDB`, `localStorage`).

---

## 1. `chrome.storage.local` (persists across browser restarts, NOT synced across devices — this extension never calls `chrome.storage.sync`, confirmed by repo-wide grep)

| Key | Shape / Type | Default | Written by | Read by | Sensitivity | Retention |
|---|---|---|---|---|---|---|
| `vlmEndpoint` | `string` (URL) | `"http://localhost:11434/v1/chat/completions"` | `chrome.runtime.onInstalled` handler (`background.js:286-294`); `SET_CONFIG` message handler (`background.js:53-56`) triggered by popup's `#vlm-endpoint` input `change` listener (`popup.js:86-101`) | `handleCaptureAndSanitize()` via `chrome.storage.local.get(["vlmEndpoint","vlmModel"])` (`background.js:133`); popup's `loadConfig()` via `GET_CONFIG` message (`background.js:58-61` → `popup.js:70-82`) | **Low** — user-configured server address, not a credential (see §3, F-11 assessment) | Until user changes it or extension is uninstalled |
| `vlmModel` | `string` (model id/tag) | `"qwen2.5vl:7b"` (background.js onInstalled) — **note:** popup's in-memory fallback default is `"Qwen/Qwen3-VL-8B-Instruct"` (`popup.js:78`), a pre-existing inconsistency, not introduced by this pass | same as `vlmEndpoint` | same as `vlmEndpoint` | **None** | Until changed/uninstalled |
| `detectionEnabled` | `boolean` | `true` | `chrome.runtime.onInstalled` handler only (`background.js:290`) | **Nothing reads this key today.** It is not in the `GET_CONFIG` keys list (`popup.js:73`) and no other file references it. Dead/orphan key — flagged below. | None | N/A (never read) |
| `faceDetection` | `boolean` | `true` | `onInstalled` (`background.js:291`); `SET_CONFIG` via `#face-detection` checkbox (`popup.js:87-100`) | popup `loadConfig()` via `GET_CONFIG` (`popup.js:79`); **`handleCaptureAndSanitize()`** (`background.js`) reads it to decide whether the live face-redaction gate is required before the VLM `fetch()`, and forwards it on the `SANITIZE` message to `offscreen.js` | None | Until changed/uninstalled |
| `passwordDetection` | `boolean` | `true` | `onInstalled` (`background.js:292`); `SET_CONFIG` via `#password-detection` checkbox | popup `loadConfig()` via `GET_CONFIG` (`popup.js:80`) | None | Until changed/uninstalled |
| `piiDetection` | `boolean` | `true` | `onInstalled`; `SET_CONFIG` via `#pii-detection` checkbox | popup `loadConfig()` via `GET_CONFIG`; **`handleCaptureAndSanitize()`** reads it to require the live NER (PER/ORG/LOC) gate before the VLM `fetch()`, and forwards it on the `SANITIZE` message to `offscreen.js` | None | Until changed/uninstalled |

### `userProfile` — RESOLVED (Lead note, 2026-08-28): was landed, just not yet restored to the working tree

**Update from the Lead, after this report was filed:** the db-engineer's finding below was correct *as observed* — at the moment it read the files, `src/background/background.js` and `src/popup/popup.js` genuinely had no `userProfile`/`normalizeProfile` code. This was not unlanded work or a stale report; it was a repo-recovery gap. This project's `.opencode`/`engineers` scaffold and several `src/` fixes (this one included) had been captured in a Cursor "checkpoint" commit (`0b06663`, on a side branch) during an earlier branch switch, and the branch switch back to `main` did not carry those working-tree changes with it. I restored `.opencode/`/`engineers/` earlier, but had not yet restored the corresponding `src/` fixes when db-engineer ran — so its report reflects a real, honestly-observed snapshot, just of an incompletely-recovered tree. I've since restored `background.js`, `popup.js`, `popup.html`, and `inference.worker.js` from that same commit. `userProfile`/`normalizeProfile`/`sanitizeAction` are now present and verified in `src/` (12 references in `background.js`, 7 in `popup.js`).

The db-engineer's original observation is kept below verbatim as an accurate record of what it found at the time — the canonical shape it proposed also matches what actually landed.

<details><summary>Original finding (superseded, kept for record)</summary>

`engineers/backend/work_done.md` and `engineers/frontend/work_done.md` (both untracked in git as of this pass) describe a `userProfile` key (RAG form-fill profile), a `normalizeProfile()` function in `background.js`, and a profile textarea in the popup UI. I read the actual files on disk at HEAD (`e4c44d6`, working tree clean, `git log` shows `background.js`/`popup.js` last touched at commit `78bec8a`) and:

- `src/background/background.js` has no `userProfile` reference and no `normalizeProfile` function.
- `src/popup/popup.js` / `popup.html` have no profile input field and never read/write `userProfile`.
- Repo-wide grep for `userProfile|normalizeProfile` only matches files under `engineers/` and `.opencode/` (planning/report docs), never under `src/`.

</details>

The canonical shape below is now the **verified, shipped** contract, not speculative:

```json
{
  "name": "Alice Smith",
  "email": "alice@example.com"
}
```

- **Canonical shape:** JSON object, flat `key: value` string pairs (matches what `engineers/frontend/work_done.md` describes: "saved to chrome.storage.local as a JSON OBJECT").
- **Reader contract:** any reader (`normalizeProfile()` or equivalent) MUST accept, in order: (1) already-parsed JSON object, (2) JSON string → `JSON.parse`, (3) legacy free-text (`Key: value` lines, or an arbitrary blob folded into `{"notes": "<text>"}`) as a fallback so old installs don't break. Malformed/empty input → `{}`, never thrown.
- **Sensitivity:** potentially **Medium-High** depending on what the user puts in it (name/email/address for form-fill). It is a user-controlled convenience store, not extracted PII from a page — distinct from the Aadhaar/PAN/licence extract-and-discard rule below. No raw-profile logging permitted anywhere (per `engineers/backend/work_done.md`, already grep-verified by backend).
- **Retention:** persists until user clears it or uninstalls (same as other `storage.local` keys).

**Resolved by Lead, 2026-08-28:** confirmed merged — see note above. No follow-up pass needed on the shape itself.

---

## 2. `chrome.storage.session` (in-memory, cleared on browser close — by design, never touches disk)

| Key | Shape / Type | Written by | Read by | Sensitivity | Retention |
|---|---|---|---|---|---|
| `lastReceipt` | Privacy receipt object: `{ timestamp, url, masked: { passwordFields, faces, piiSpans }, backend, latencyMs: { capture, domScan, inference, vlm }, totalMs }` | `handleCaptureAndSanitize()` after every sanitize run | `GET_LAST_RECEIPT` → popup `loadLastReceipt()` | **Low-Medium** — local demo receipt; **never sent to the VLM**. Contains page `url` for the user only. Never raw PII or screenshots. | Session only |
| `vlmApiKey` | `string` (API key / bearer token) | popup `#vlm-api-key` → `SET_VLM_API_KEY` | `handleCaptureAndSanitize` (Bearer for non-localhost VLM); `GET_VLM_API_KEY_STATUS` returns `{ configured }` only, never the key | **High** — credential | Session only. **MUST NOT** be written to `chrome.storage.local`. |

No other `storage.session` keys exist besides `lastReceipt` and `vlmApiKey`. `SET_CONFIG` / `GET_CONFIG` strip `vlmApiKey`, `apiKey`, `authorization`, `token`, and `secret` so a mistaken popup write cannot persist a credential to disk.

---

## 3. Cache API (model weights — planned, not yet active)

`src/inference/inference.worker.js` configures Transformers.js with `transformersEnv.useBrowserCache = true` (line 31) and documents (comments only, not yet executed code) an intent to cache BlazeFace ONNX weights via `caches.open('blazeface-v1')`. **Currently `loadFaceModel()` and `loadNERModel()` are stubs that set `faceSession = null` / `nerPipeline = null` unconditionally** (lines 56-87) — no network fetch happens yet, so no Cache API entries are actually written today. When the ML engineer implements Task 1.3 (real model loading), this section must be updated with the actual cache name(s), what's stored (model binaries — not sensitive, publicly downloadable weights), and eviction behavior.

## 4. Fixture / annotation JSON — `eval/ground-truth/*.json`

Static, checked-into-git fixtures (`ground-truth-master.json`, `gt-tp01.json`, …) describing expected sensitive-element detections per test page (selector, type, detection layer, expected redaction, PII category) for the eval harness. Not runtime storage — no chrome.storage/Cache API involved. Contains **synthetic/example PII values only** (e.g. `john.doe@gmail.com` as a fixture, not real user data) — owned/authored by the eval engineer, listed here only for completeness per the db-engineer's persistence inventory.

---

## 5. Storage safety verification (extract-and-discard rule)

Per the db-engineer rule — **Aadhaar/PAN/licence numbers must never be persisted**:

- The only PII detection code path is `detectTextPII()` in `src/offscreen/offscreen.js` (regex stage, `AADHAAR`/`PAN`/`SSN`/`PHONE`/`EMAIL`/`IN_MOBILE` patterns) and the worker's NER stage. Both produce `maskedRegions` (bounding boxes + entity type + confidence) which are used only to draw pixelation on the in-memory canvas and are returned in the message response to `background.js`.
- `background.js` reduces `maskedRegions` down to **counts only** (`passwordFields`, `faces`, `piiSpans`) before writing to `chrome.storage.session.lastReceipt` (`background.js:200-204`). The actual matched text (`pii.text`, e.g. the Aadhaar/PAN digits themselves) is **never** written to `chrome.storage.local`, `chrome.storage.session`, or any other persistence layer — confirmed by reading every `storage.*.set(...)` call site in the codebase (there are exactly 3: two in `onInstalled`/`SET_CONFIG` for config, one for the receipt counts).
- **Verdict: PASS.** No sensitive extracted PII (Aadhaar/PAN/licence/SSN/email/phone matches) is persisted anywhere. Only aggregate counts and non-sensitive config survive a sanitize run.

---

## 6. `chrome.storage.sync` — confirmed unused

Repo-wide grep for `storage.sync` returns zero matches in `src/`. No risk of the "local vs sync" confusion mentioned in the F-11 finding — every persisted config key is local-only, per-device, never sent to Google's sync servers.

---

## 7. Assessment: Finding F-11 ("VLM endpoint URL is stored without encryption in chrome.storage.local")

**Source:** `engineers/privacy/work_done.md` — flagged as "Leaking" in the privacy audit.

**My assessment: Disagree with the finding as currently worded — recommend downgrading to an accepted-risk / documentation item, not a fix.**

Reasoning:

1. **It's not a secret.** `vlmEndpoint` is a URL like `http://localhost:11434/v1/chat/completions` — the address of a server the *user* chose to point the extension at (their own local Ollama instance, or a self-hosted VLM). It is functionally equivalent to a bookmark or a hostname in `/etc/hosts`. Encrypting it would protect against... someone reading the user's own locally-set configuration on the user's own machine. There's no confidentiality boundary being crossed.
2. **No credential is embedded.** I read every write site (`onInstalled`, `SET_CONFIG`) — the value is exactly what the user typed into the `#vlm-endpoint` text input in the popup. There's no API key, bearer token, or auth header baked into this string anywhere in the code. If a future iteration adds an API key to the VLM request (e.g. for a hosted/cloud VLM instead of local Ollama), *that* would be a real secret and *that* key would need OS-level secret storage (which `chrome.storage.local` fundamentally cannot provide — it's plaintext-on-disk by design in every Chromium extension, encryption-at-rest is only as strong as OS disk encryption). But that's not what's stored today.
3. **`chrome.storage.local` is already correctly scoped.** It's local-only (not synced — confirmed above), which is the *right* choice here; nothing about F-11 suggests the finding is confusing `local` with `sync`, but I want it on record that I verified this isn't the actual underlying issue.
4. **Where I'd partially agree:** if the team ever supports a *hosted* (non-localhost) VLM endpoint that requires an API key or bearer token in the request, that credential must NOT go into `chrome.storage.local` as plaintext — it should prompt for re-entry each session (stored in `chrome.storage.session` instead, so it's wiped on browser close, matching the existing `lastReceipt` pattern) or at minimum be documented as a known limitation of the MV3 storage APIs (there is no first-party "secrets" storage in a Chrome extension — `chrome.storage.session` is the closest thing to "not on disk").

**Concrete recommendation:**

- **No code change needed for `vlmEndpoint`/`vlmModel` today.** Document F-11 as an **accepted risk** in the privacy audit with the reasoning above (self-hosted/local endpoint, no embedded secret, local-only storage already correct).
- **Add a forward-looking guardrail** (documentation, not code, per this pass's scope): if/when a hosted VLM + API key is introduced, the API key MUST use `chrome.storage.session` (session-scoped, RAM-only) rather than `chrome.storage.local`, and this contract doc must be updated in the same change per the db-engineer rule.
- Recommend privacy engineer update `engineers/privacy/work_done.md` F-11 status from "Leaking" to "Accepted risk (see docs/STORAGE_CONTRACT.md §7)" rather than leaving it as an open leak, since as currently scoped it does not represent an actual data-exposure vulnerability.

---

## 7.5 `aegisDocVault` — local document vault (NEW, 2026-09-06 backend)

| Key | Shape / Type | Default | Written by | Read by | Sensitivity | Retention |
|---|---|---|---|---|---|---|
| `aegisDocVault` | `Array<{ id: string, docName: string, format: string, extractedAt: ISO string, text: string }>` | `[]` (absent → treated as empty) | `ADD_DOC_TO_VAULT` handler → `AegisDocVault.addDocToVault()` (`src/background/doc-vault.js`) | `retrieveVaultSnippets()` (RAG-lite prompt block in `handleCaptureAndSanitize`), `GET_DOC_VAULT` (dashboard list — names + char counts ONLY, text never returned) | **High** (user's own documents, may contain PII) — mitigated: Aadhaar/PAN numbers are scrubbed to `[REDACTED]` at store time; text NEVER leaves the device / is never sent to any endpoint except the LOCAL VLM's system prompt (same path as `userProfile`) | Until user removes / extension uninstalled; capped at 10 docs / 200 KB total (oldest dropped first) |

Rules (enforced in `src/background/doc-vault.js`, not just documented):

- **Local-only:** vault text is never included in the sanitized-image path and never sent to a remote endpoint. `STRUCTURE_DOCUMENT_TEXT` (the only path that transmits document text to a VLM) rejects any resolved endpoint failing `isLocalVlmEndpoint()` with `STRUCTURE_REMOTE_REJECTED` *before* a request is made.
- **Never persist sensitive:** `normalizeVaultDoc()` runs `redactSensitiveNumbers()` (Aadhaar + PAN regex) on the text before it is written to storage.
- **Caps:** `VAULT_MAX_DOCS = 10`, `VAULT_MAX_BYTES = 200 * 1024` (UTF-8-ish byte sum of `text` fields); `trimVault()` drops oldest (`extractedAt`) first; a single oversized doc is truncated to fit.
- **Synchronous provenance cache:** vault texts are mirrored into an in-memory cache (`getCachedVaultTexts()`), refreshed on vault writes and at capture time, so `sanitizeAction()`'s synchronous "type" guard can verify a value is traceable to vault text. Empty cache → vault provenance disabled → fail closed.
- **Snippet contract:** `retrieveVaultSnippets(docs, query, topK=3)` returns sentence-level matches ≤ 400 chars, keyword-scored (stopwords filtered). Injected into the LOCAL VLM system prompt only, in the `DOCUMENT KNOWLEDGE` block.

---

## 8. Open items for the Lead

1. ~~`userProfile` contract mismatch~~ — **Resolved by Lead 2026-08-28**: was a repo-recovery gap (checkpoint commit not yet restored to the working tree), not unlanded work. Now restored and verified in `src/`.
2. **`detectionEnabled` is a dead key** — written on install, never read anywhere. Recommend either wiring it up (e.g. a master on/off toggle gating `faceDetection`/`passwordDetection`/`piiDetection`) or removing the write to avoid schema drift. Not changed in this pass per scope (no `src/*.js` edits).
3. **`vlmModel` default mismatch** between `background.js` (`"qwen2.5vl:7b"`) and `popup.js`'s in-memory fallback (`"Qwen/Qwen3-VL-8B-Instruct"`) — cosmetic (only shown before `GET_CONFIG` resolves) but worth aligning in a future change since it violates "no renaming/drift without updating all consumers" in spirit.
4. **F-11 recommendation above** needs privacy engineer sign-off to close/downgrade the finding.
