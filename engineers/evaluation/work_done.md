# Evaluation Work Report

*(Fill out this table when the task is complete)*

## 2026-08-XX (original) — VLM Form-Fill Generation: FAIL

*Kept verbatim as historical evidence of the regression that was caught. Do not delete — see re-verification below for current status.*

| Test Stage | Pass/Fail | Latency | Observation |
|---|---|---|---|
| Profile Save (UI) | Pass ✅ | N/A | `popup.js` correctly reads the `<textarea>` and saves the raw string to `chrome.storage.local`. |
| Local Redaction (ML) | Pass ✅ | ~100ms | Pipeline successfully captures screenshot, detects fields, and applies `fillRect` masking via offscreen canvas. |
| VLM Form-Fill Generation | FAIL ❌ | ~2000ms | CRITICAL BUG: `background.js` uses `Object.entries(userProfile)` on a string. The VLM receives a prompt mapped by character index (0: M, 1: y, 2: ...) instead of meaningful fields, breaking generation. |
| DOM Execution (Content) | Pass ✅ | ~10ms | `content.js` `executeType` correctly implements the `nativeInputValueSetter` hack to bypass React/Vue synthetic event blockers. (Verified theoretically; blocked by VLM failure). |
| **OVERALL E2E MVP** | **FAIL** ❌ | **N/A** | The pipeline is broken at the VLM payload generation step due to the profile parsing bug. The agent cannot currently fill forms. |

**Engineering Recommendation (original):**
`background.js` (Lines 160-164) attempts to map a string as an object.
Fix `background.js` to treat `userProfile` as a string:
```javascript
const hasProfile = typeof userProfile === 'string' && userProfile.trim().length > 0;
const profileBlock = hasProfile
  ? `USER PROFILE (use these values to fill form fields):\n${userProfile}\n...`
  : "No user profile is saved...";
```

---

## 2026-08-28 — Re-verification of Task 2.5 gate (profile-injection fix)

**Requested by:** lead, after backend (`engineers/backend/work_done.md`) and frontend (`engineers/frontend/work_done.md`) reported the `Object.entries(userProfile)` bug fixed via a new `normalizeProfile()` helper + JSON-object `userProfile` storage.

**Method:** Per team rule ("don't just trust prior reports — verify from the project"), re-read the actual source files rather than relying on the backend/frontend summaries, then built and ran code-level + live-model regression tests. A live E2E browser+extension run was **not** performed (no Chrome/extension-loading environment in this sandbox); see "What still needs a live run" below.

**⚠️ Note on timing / a moving target:** this verification session observed the repo change state mid-verification. At the start of this re-check, `src/background/background.js` and `src/popup/popup.js` on `main`'s working tree had **no** `normalizeProfile`/`userProfile` code at all (confirmed via direct read + `grep -rn normalizeProfile src/` → 0 matches + `git diff HEAD` → clean). Partway through this session, those same files (plus `popup.html`, `inference.worker.js`) were updated on disk to match the fixed implementation from the `cursor/remove-ds-store-files` branch — **staged in git's index but not yet committed to `main`** (`git status` shows them under "Changes to be committed", `HEAD` is still `e4c44d6`, "ahead of origin/main by 1 commit"). The findings below describe the **final, current state of the working tree** at the end of this session, since that is what actually determines what runs when the extension is loaded — but the gate verdict explicitly flags the uncommitted-staged status as a real risk.

### Finding #1: the fix IS present in the current working tree (as of end of this session) — but not yet committed on `main`

Direct inspection of `src/background/background.js` and `src/popup/popup.js`/`popup.html` as they currently sit on disk confirms:

- `normalizeProfile(raw)` exists in `background.js`, accepting a JSON object, a JSON-object string, or free text, and always returning a flat `{key: value}` map (never throws; returns `{}` for null/undefined/empty/array/non-object-JSON).
- `handleCaptureAndSanitize` now fetches `userProfile` from `chrome.storage.local` and injects `normalizeProfile(config.userProfile)` into a dedicated strict RAG system prompt (`USER PROFILE (available data): ...` / `USER PROFILE: (Empty...)`), replacing the old generic automation prompt.
- `popup.html` now has a "My Profile Data" section (`#profile-input` textarea, `#save-profile-btn`); `popup.js` has `parseUserProfile()` (JSON → `Key: value` lines → `{notes: ...}` fallback) and saves `userProfile` as a JSON **object** to `chrome.storage.local`, and `loadConfig()` repopulates the textarea from a saved object or legacy string.
- A `sanitizeAction()` validator was also added, rejecting malformed/out-of-range `click`/`type`/`scroll`/`navigate`/`done` actions before they ever reach `handleExecuteAction` — this is new hardening beyond what was originally asked for the 2.5 gate, but directly relevant to safety.
- This matches, character-for-character, what was previously only found on the unmerged branch `cursor/remove-ds-store-files` @ commit `0b06663` ("checkpoint before checking out main") — i.e. that branch's fix has now been brought into `main`'s working tree.

**Process flag (not a code bug, but real):** as of writing this entry, `git status` shows these four files as **staged but not committed** on `main` (`HEAD` = `e4c44d6`, unchanged; branch is "ahead of origin/main by 1 commit" from an unrelated earlier commit). Anyone who runs `git checkout .` / `git reset --hard` / clones `main` fresh right now would **not** get this fix. **Recommend committing this staged work immediately** — an uncommitted fix is not a shipped fix.

### Finding #2: the fix's logic and live-model behavior — verified independently, not just re-stated from backend's report

**(a) Code-level regression test — new file `eval/harness/normalize-profile.test.js`**
Extracted `normalizeProfile()` from the current `background.js` into an isolated Node test (no npm deps) covering: JSON object, JSON-object string, legacy `Key: value` text, freeform text (no separators), empty string, whitespace-only, `null`, `undefined`, array, JSON-array string, nested-object values, numeric/boolean coercion, and an explicit regression check reproducing the original char-indexed bug via `Object.entries()` on a raw string to prove the fix does not exhibit it.

```
node eval/harness/normalize-profile.test.js
→ 13/13 passed, 0 failed
```

Result: **PASS**. The function's parsing/normalization logic is correct across all tested edge cases and never throws.

**(b) Live model test — new file `eval/test_rag_form_fill.py`** (adapted from the branch's earlier draft of this same test, run against the actual local Ollama endpoint — confirmed reachable: `qwen2.5vl:7b` served at `http://localhost:11434`)

This drives the **real VLM** with the fixed system-prompt construction (mirrors `handleCaptureAndSanitize`'s prompt-building exactly) and, for contrast, with a Python re-creation of the original buggy (char-indexed) prompt:

```
python3 eval/test_rag_form_fill.py

[FIXED-1: profile has Full Name]            10408ms  → {"action":"type","selector":"#name_input","value":"Alice Smith"}   PASS
[FIXED-2: profile is empty]                  2870ms  → {"action":"type","selector":"#name_input","value":"Alice"}         FAIL (hallucinated)
[FIXED-3: profile missing requested field]   2875ms  → {"action":"type","selector":"#name_input","value":"Software Engineer"}  FAIL (hallucinated)

[BUGGY-repro, char-indexed prompt]            6715ms  → free-text reasoning, NOT valid JSON (parse failed)
```

Findings:
- **The original crash is genuinely fixed by this design.** The buggy char-indexed prompt reproduces exactly as originally reported: the model breaks out of the required JSON action schema entirely (returns prose, unparseable) — this is the "breaking generation" failure from the original FAIL entry. The fixed prompt returns a valid, correctly-parseable JSON action in all 3 cases.
- **When profile data is present and matches the requested field, the value is 100% correct** (`"Alice Smith"` extracted precisely) — this is the core regression that was reported broken, and it is now fixed.
- **New, separate accuracy issue (not the reported regression, but real):** in 2 of 3 cases where the profile is empty or missing the requested field, the model hallucinates a plausible-looking value instead of returning the required `{"action":"done",...}` refusal, despite explicit "MUST NOT guess/invent" instructions and few-shot examples in the prompt. This independently confirms backend's own caveat in `engineers/backend/work_done.md` ("Low accuracy when data is missing... hallucinates placeholder data"). This is a prompt-engineering / model-capability gap in Qwen2.5-VL-7B with negative constraints, not a code bug — but it is a real, measured accuracy shortfall that should not be waved through silently.
- Grep-verified independently (not just trusting backend's claim): no `console.log` on the branch's `background.js`/`popup.js` references profile data — no raw-profile-leak found.

### What still needs a live run (not done here)

- **Real browser + real extension load** (`chrome://extensions` → load unpacked → trigger `CAPTURE_AND_SANITIZE` from the popup against a live test page) was not performed — no Chrome/extension automation environment available in this sandbox. Everything above tests the prompt-construction logic and the live VLM in isolation, not the full `background.js` message-passing pipeline, screenshot capture, or `content.js` DOM execution of the returned action.
- The hallucination-on-missing-data failure mode (Finding #2, cases 2–3) should be re-tested after any prompt-engineering fix, ideally across more than 3 samples (statistical confidence needs a larger n).
- Privacy review of the full profile flow (storage, transmission, redaction interaction) — flagged in backend's report as still owed to "eval-engineer + privacy review (2.5 gate)" — has only been partially covered here (log-leak check only); a full privacy-engineer pass is still recommended before claiming the 2.5 gate closed.

### Gate verdict

| Gate | Verdict | Why |
|---|---|---|
| Original reported bug (`Object.entries()` on a string, char-indexed prompt, generation-breaking) | **FIXED — verified** ✅ | Confirmed absent by code read (13/13 unit tests on `normalizeProfile`) and confirmed fixed at the model level: the live VLM, given the OLD buggy prompt, breaks out of the JSON action schema entirely (unparseable prose) — reproducing the original failure exactly — while the NEW prompt reliably returns valid, correctly-parseable JSON. |
| Working-tree code state (what's actually on disk right now) | **PASS, with a process caveat** ⚠️ | `normalizeProfile`, profile injection into the system prompt, `sanitizeAction` hardening, and the popup "Save Profile" UI are all present and internally consistent between `background.js` ↔ `popup.js` ↔ `popup.html`. **But** these changes are staged, not committed, on `main` (`HEAD` unchanged at `e4c44d6`) — this must be committed before it counts as shipped. |
| VLM accuracy on missing/incomplete profile data (negative-constraint following) | **FAIL — new, separate issue** ❌ | Live test: 2 of 3 cases where the profile lacks the requested field caused the model to hallucinate a plausible-looking value instead of returning the required refusal (`{"action":"done",...}`), despite explicit "MUST NOT guess" instructions + few-shot examples. This is not the originally-reported bug, but it is a real, measured accuracy gap that directly affects the "PII detection precision" and "redaction precision" spirit of the release gate (a hallucinated value could leak/insert wrong data into a form). |
| Full E2E (real browser + real extension + real VLM, end to end) | **NOT RUN — sandbox limitation** ⚪ | No Chrome/extension-loading environment available here. See "What still needs a live run." |

**Overall gate status: PARTIAL-WITH-CONDITIONS.** The specific, originally-reported regression (character-indexed prompt breaking generation) is genuinely fixed and independently verified at both the code level and the live-model level — this is real progress, not a re-statement of backend's claim. However, I cannot sign off on the full 2.5 gate as PASS because: (1) the fix is currently only staged, not committed, on `main` — **commit it now**; (2) a newly-confirmed accuracy gap (hallucination when profile data is missing) means the "smart form-fill" feature is not yet trustworthy in the common real-world case of an incomplete profile; (3) no real browser E2E has been run against this exact working tree; (4) a dedicated privacy-engineer pass on the full profile flow (storage/transmission/redaction interaction) is still outstanding per backend's own note.

**Recommended next steps, in order:** (1) commit the currently-staged `background.js`/`popup.js`/`popup.html`/`inference.worker.js` changes to `main` so the fix is actually persisted; (2) have backend address the missing-data hallucination case (stronger refusal enforcement — e.g. reject/retry a `type` action whose value isn't traceable to a profile key, rather than relying on prompt wording alone); (3) run a real browser E2E pass once an environment is available; (4) get the privacy-engineer review backend flagged as still owed.

### New eval artifacts added this session

- `eval/harness/normalize-profile.test.js` — Node regression test for `normalizeProfile()` (13 cases, run with `node eval/harness/normalize-profile.test.js`).
- `eval/test_rag_form_fill.py` — live-VLM RAG form-fill test against local Ollama, covering profile-present / profile-empty / profile-missing-field cases plus a buggy-prompt reproduction for contrast (run with `python3 eval/test_rag_form_fill.py`).

No production code (`background.js`, `popup.js`, `popup.html`, `manifest.json`) was modified as part of this verification — this was a verification-only pass per task instructions.

---

## 2026-08-28 — Acceptance: live face redaction before VLM

**New harness:** `eval/harness/face-redaction-before-vlm.test.js` (loads the real `background.js` via Node VM, plus source-contract checks on `offscreen.js` / `inference.worker.js` / `manifest.json`).

```
node eval/harness/face-redaction-before-vlm.test.js
→ 31/31 passed, 0 failed
```

Asserts: fail-closed `assertReadyForVlm()`, source order (`SANITIZE` and `assertReadyForVlm` before `fetch(vlmEndpoint)`), VLM `image_url` is `sanitizedImage` not the raw capture, worker accepts `imageData` **and** `imageDataUrl`, offscreen no longer `return []` on face errors, `blaze.onnx` present.

**Regression:** `sanitize-action.test.js` 13/13, `normalize-profile.test.js` 13/13 still pass. `eval/test_rag_form_fill.py` not re-run (live Ollama; not required for this invariant).

**Not run:** real Chrome unpacked-extension E2E on a page with a photographed face (no extension-loading environment here). That remains a manual step: load unpacked → Run Agent on a tab showing a face → confirm privacy receipt `faces > 0` (or a `FACE_REDACTION_REQUIRED` block if the model fails) and that the VLM image is pixelated.

---

## 2026-08-28 — Acceptance: live NER redaction of names/places/orgs before VLM

**New harness:** `eval/harness/ner-redaction-before-vlm.test.js`

```
node eval/harness/ner-redaction-before-vlm.test.js  → 27/27
node eval/harness/face-redaction-before-vlm.test.js → 31/31  (no regression)
node eval/harness/sanitize-action.test.js           → 13/13
node eval/harness/normalize-profile.test.js         → 13/13
```

**Not run:** live DistilBERT in a real extension (HF download + Chrome load). Manual: page containing a person name, org, and location in visible text → receipt `piiSpans > 0` for NER entities, or `NER_REDACTION_REQUIRED` if the model cannot load.

---

## 2026-08-28 — Six-item demo pack (auth, fail-closed, dynamic DOM, URL strip, popup, Chrome E2E)

**Harnesses run (this machine):**

```
node eval/harness/privacy-payload.test.js          → 31/31
node eval/harness/face-redaction-before-vlm.test.js → 31/31
node eval/harness/ner-redaction-before-vlm.test.js  → 27/27
node eval/harness/sanitize-action.test.js           → 13/13
node eval/harness/normalize-profile.test.js         → 13/13
```

**Chrome unpacked E2E: NOT COMPLETE.** `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --load-extension=<repo>` was started and **hung with no DOM dump for >45s** (killed). Prior sessions reported enterprise policy blocking unpacked extension install. **Do not treat this as a pass.**

### Manual Chrome steps (judges / developer machine without the policy)

1. `chrome://extensions` → Developer mode → **Load unpacked** → select repo root (`/Users/rehan/Developer/SIH/SIH26`).
2. Open `eval/test-pages/tp01-login-form.html` (file:// or a local static server). Confirm password overlay on **Scan page**.
3. Open `eval/test-pages/tp06-dynamic-checkout.html` if it injects fields; confirm overlay updates after DOM injection (MutationObserver, ~400ms).
4. Open `eval/test-pages/tp03-profile-page.html` (names / PII). **Run Agent** with a task like "Fill the form". Confirm: pipeline steps in the popup, **sanitized** preview (faces/PII pixelated), privacy receipt counts, and that the VLM was not called if models failed (`FACE_REDACTION_REQUIRED` / `NER_REDACTION_REQUIRED`).
5. Hosted Gemini: paste key in the session-only field (leave empty for local Ollama at `:11434`). Close the browser and reopen — key must be gone.
6. In DevTools on the service worker, inspect the outbound `fetch` body: no `url`/`title` in `pageStructure`; `Authorization` only if the endpoint is not localhost and a session key is set.

---

## 2026-08-28 — INIT timeout (Chrome for Testing, before VLM)

**Harnesses re-run after the INIT fix (this machine, Node, not a live extension):**

```
node eval/harness/face-redaction-before-vlm.test.js → 36/36  (was 31; +5 INIT-path source contracts)
node eval/harness/ner-redaction-before-vlm.test.js  → 27/27
node eval/harness/privacy-payload.test.js          → 32/32  (was 31; +1 INIT_FAILED classifyError)
```

Face/NER fail-closed gates and privacy payload stripping still pass. **No live Chrome-for-Testing Run Agent this session** — the original user failure was real-browser; this re-run is source-contract + VM harness only.

**Added face-harness checks:** INIT timeout ≥ 60s, `INIT_PROGRESS` forwarded, `worker.onerror` rejects pending INIT, transformers.js not statically imported, `wasm-unsafe-eval` CSP.

**Manual next (user / Chrome for Testing):**
1. `chrome://extensions` → **Reload** the unpacked Aegis build (manifest CSP changed).
2. Keep **Allow access to file URLs** on.
3. Open `eval/test-pages/tp01-login-form.html`, click **Run Agent**.
4. Popup should show BlazeFace fetch/WASM compile progress; first run may take up to ~1 minute. VLM still must not run if BlazeFace fails (`FACE_REDACTION_REQUIRED`).

---

## 2026-08-28 — TP08 kitchen-sink manual E2E form + dummy profile

**Goal:** One page for live Chrome testing that covers both **redaction** (already-visible PII + face) and **form-fill** (empty fields whose labels match a profile fixture), plus hallucination traps.

| Artifact | Path | Notes |
|---|---|---|
| Test page | `eval/test-pages/tp08-kitchen-sink-registration.html` | Scholarship portal; left session card = redaction bait; main form empty for fill |
| Face asset | `eval/test-pages/assets/applicant-face.jpg` | 256×256 stock JPEG (Unsplash) for BlazeFace only — not a real applicant |
| Profile JSON | `eval/fixtures/dummy-profile-ananya.json` | 16 fillable keys; **no** Aadhaar/PAN |
| Profile text | `eval/fixtures/dummy-profile-ananya.txt` | Same data as `Key: value` lines |
| Ground truth | `eval/ground-truth/gt-tp08.json` + entry in `ground-truth-master.json` | Expected layers: face, NER, regex, DOM password/card/ID |

**Suggested task string:** `Fill the scholarship application using my saved profile. Leave blank any field that is not in the profile. Do not invent values.`

**Measured:** No live Chrome/extension run in this session (fixture authoring only). Harnesses not re-run (no `src/` change).

**Remaining risks:** Face detection needs the photo visible and large enough in the viewport; open file via `file://` with “Allow access to file URLs”. Agent fill of `<select>` / `type=date` depends on VLM emitting exact option/value strings. Aadhaar/PAN appear only as synthetic visible text + empty inputs — never in the profile fixture.

---

## 2026-08-28 — Content-script inject after extension reload (file://)

**Goal:** Measure that "Receiving end does not exist" is classified and retried, without regressing face/NER/privacy gates.

**New harness:** `eval/harness/content-script-inject.test.js` — loads real `background.js` in a VM; mocks `tabs.sendMessage` + `scripting.executeScript`.

```
node eval/harness/content-script-inject.test.js     → 39/39
node eval/harness/privacy-payload.test.js           → 36/36  (was 32; +4 inject/classifyError/popup)
node eval/harness/face-redaction-before-vlm.test.js → 36/36
node eval/harness/ner-redaction-before-vlm.test.js  → 27/27
node eval/harness/sanitize-action.test.js           → 13/13
node eval/harness/normalize-profile.test.js         → 13/13
```

**Not measured:** live Chrome-for-Testing unpack + Reload + Run Agent on `tp01-login-form.html` (no extension host in this session).

**Manual next (user):** Reload unpacked Aegis → keep Allow access to file URLs → stay on the `file://` test page → Run Agent or Scan page. Expect inject+retry (no refresh required in the common case). If still blocked: refresh the **page tab**, then retry. Badge stays "Models idle" until INIT_PROGRESS (first Run Agent after reload).

---

## 2026-08-28 — INIT_FAILED worker load (chrome is not defined) — harness + Chrome probe

**Root cause (measured in Chrome for Testing 152, `--load-extension`):** dedicated module Worker threw `Uncaught ReferenceError: chrome is not defined` at `inference.worker.js:19` (`chrome.runtime.getURL`). After switching vendor paths to `import.meta.url`, the same probe got `INIT_DONE` with `faceModelReady: true`.

```
node eval/harness/face-redaction-before-vlm.test.js → 38/38  (+2: no chrome.runtime.getURL, import.meta.url vendor dir)
node eval/harness/ner-redaction-before-vlm.test.js  → 27/27
node eval/harness/privacy-payload.test.js          → 36/36
node eval/harness/content-script-inject.test.js    → 39/39
```

**Live extension INIT probe (this session, not a full Run Agent):** unpacked load, open `src/offscreen/offscreen.html`, `new Worker(workerUrl, {type:'module'})`, post `INIT` → `faceModelReady: true` in ~3.5s. Full popup → Ollama → type-into-tp08 was not driven here.

**Manual next:** Reload unpacked extension → refresh tp08/tp01 → Run Agent. First WASM compile may take up to ~1 minute; popup should show Fetching/Compiling progress then a sanitized preview.

---

## 2026-08-28 — ORT WASM `.mjs` dynamic-import miss (harness)

**Goal:** Directory-string `wasmPaths` must not regress; ORT backend-miss must classify as `INIT_FAILED` / `FACE_REDACTION_REQUIRED`, not `[UNKNOWN]`. Face/NER/privacy gates unchanged.

```
node eval/harness/face-redaction-before-vlm.test.js → 45/45  (+7: wasmPaths object, wasm/mjs on disk, WAR globs, classifyError)
node eval/harness/ner-redaction-before-vlm.test.js  → 28/28  (+1 classifyError)
node eval/harness/privacy-payload.test.js          → 38/38  (+2 classifyError)
node eval/harness/content-script-inject.test.js    → 40/40  (+1 classifyError)
node eval/harness/sanitize-action.test.js          → 13/13
node eval/harness/normalize-profile.test.js        → 13/13
```

**Not measured:** live Chrome unpacked Run Agent after this wasmPaths object fix (no extension host in this session). Previous Chrome-for-Testing INIT probe predated this change.

**Manual next:** Reload unpacked Aegis at `chrome://extensions` → refresh the page tab → Run Agent. First WASM compile can take up to ~1 minute. Success: pipeline progress, sanitized preview, privacy receipt — not `[UNKNOWN] no available backend`.





## 2026-08-28 — ORT blob: INIT kill (harness + HTTP smoke)

**Goal:** Prove INIT can succeed after patching ORT’s blob→`import()` path so BlazeFace runs before VLM.

```
node eval/harness/face-redaction-before-vlm.test.js → 50/50
node eval/harness/ner-redaction-before-vlm.test.js  → 28/28
node eval/harness/privacy-payload.test.js          → 38/38
node eval/harness/content-script-inject.test.js    → 43/43
node eval/harness/sanitize-action.test.js          → 13/13
node eval/harness/ort-blob-init-http-smoke.mjs     → PASS faceModelReady=true (~2s, headless Chrome 151)
```

**Not measured:** full popup Run Agent → Ollama fill on tp08 (needs user Reload of unpacked Aegis). Host Chrome `--load-extension` still policy-blocked for a true unpacked id probe this session.

**Manual next:** `chrome://extensions` → Reload Aegis → refresh tp08 → Run Agent. Expect progress (Fetching WASM / Compiling / Loading face) then pixelated `#applicant-photo` + filled fields (Ollama must be up).

