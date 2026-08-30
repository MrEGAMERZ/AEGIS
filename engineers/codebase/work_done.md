# Codebase Maintenance Work Report

| Item | Status | Notes/Blockers |
|---|---|---|
| Console log prefix consistency (`src/offscreen/offscreen.js`) | Fixed | `Worker.onerror` handler logged `"[SIH26171 Offscreen]"` while the other 3 log/warn calls in the same file use `"[Aegis Offscreen]"`. Standardized to `"[Aegis Offscreen]"` to match the file's dominant convention. Cosmetic only — console text, not part of any message contract. |
| Audit for "done" TODOs (background.js, popup.js, inference.worker.js) | Checked — none removed | See "Critical finding" below. All TODOs found are still accurate; none reference work that has actually landed in the code on disk. |
| Audit for duplicated PII regex patterns | Checked — no duplication found | The PII regex list (SSN/EMAIL/PHONE/IN_MOBILE/AADHAAR/PAN) is defined exactly once, in `detectTextPII()` in `src/offscreen/offscreen.js`. No copy exists elsewhere in `src/`. Nothing to deduplicate. |
| Audit for duplicated DPR-scaling logic | Checked — no duplication found | `scaleToDPR()` is defined exactly once, in `src/offscreen/offscreen.js`, and is the only place that multiplies a CSS-pixel rect by `dpr`. `src/content/content.js` only *reports* `window.devicePixelRatio`; it does not itself do any scaling math. Nothing to deduplicate. |
| Audit for dead code / stub functions superseded elsewhere | Checked — none found | See "Critical finding" below — the stub functions (`loadFaceModel`, `loadNERModel`, `detectFaces`, `detectNER` in `inference.worker.js`) are still the live implementation; no superseding implementation exists anywhere else in the tree, so they are not dead code. |
| Leftover debug `console.log`/`warn`/`error` statements | Checked — none removed | All console calls in `src/background`, `src/content`, `src/offscreen`, `src/inference`, `src/popup` are one-shot startup/error diagnostics (module load, worker ready, worker error, detection failure fallback), not left-in loop/spam debugging. None looked like accidental leftovers from active debugging. Left as-is. |
| `src/vendor/*` | Not touched | Out of scope per maintainer rules regardless of findings. |

## Critical finding — Phase-2 work described in engineer reports is not present in `src/`

The task brief for this session stated that Phase 2 landed real fixes in `src/background/background.js` (`normalizeProfile`, `sanitizeAction`), `src/offscreen/offscreen.js`, `src/inference/inference.worker.js` (BlazeFace parser fix, NER null-rect guard), and `src/popup/popup.js`/`popup.html`. Several existing docs make the same claim:

- `.opencode/memory/team-memory.md` (task table 2.1–2.4) marks BlazeFace as **VERIFIED**, NER as **Working** with a "null-rect guard" fix, and Smart Form-Fill Profile (`normalizeProfile`) as **Working**.
- `engineers/ml/work_done.md` describes a detailed "Fixes applied (inference.worker.js)" section (BlazeFace output-parser rewrite, NER null-rect guard) with measured latencies.
- `engineers/backend/work_done.md` describes `normalizeProfile()` and `sanitizeAction()` as implemented and "Verified via extracted-function node checks (16/16 pass)."
- `engineers/frontend/work_done.md`/team-memory reference a "Progressive Setup UI" (2.4) that saves `userProfile` as a JSON object.

I read every file in scope end-to-end and confirmed by direct grep across the whole repo that **none of this exists in the current working tree**:

- `grep -r "normalizeProfile|sanitizeAction|userProfile"` across `src/` returns **zero matches**. `background.js` has no profile-injection logic, no action-safety validator, and never reads a `userProfile` key.
- `src/inference/inference.worker.js` still contains the original stub implementation: `loadFaceModel()`/`loadNERModel()` set `faceSession`/`nerPipeline` to `null` with `// TODO (Task 1.2 — ML Engineer): Implement ... loading.` comments, and `detectFaces()`/`detectNER()` unconditionally `return [];`. There is no BlazeFace output parser and no NER null-rect guard.
- `src/popup/popup.js` still contains the exact TODO the ML fix was supposed to resolve: `// TODO: when the ML engineer implements model loading, forward INIT_DONE via background → popup messaging or chrome.storage.session.` `checkModelStatus()` is still a hardcoded placeholder (`"● DOM ready"`).
- `src/popup/popup.html` has no "Progressive Setup" section; it is the same settings/task form as before.
- `git log --oneline -- src/` and `git status --porcelain src/` show a clean, unmodified tree with only generic commit messages ("Update"/"update") — no commit corresponds to any of the described fixes.

**I did not implement any of this missing functionality.** Implementing `normalizeProfile`/`sanitizeAction`, the BlazeFace parser, the NER guard, or the popup model-status relay is feature work, not code-organization cleanup, and is explicitly out of scope for this role. Flagging so the lead/backend/ML engineers know their reported work did not actually make it into `src/` (possibly lost in a `git checkout`/reset — see the `e4c44d6 checkpoint before checking out main` commit — or the reports describe a branch/worktree not reflected here).

**Practical consequence for this cleanup pass:** because none of that work has actually landed, the TODO comments and stub functions that the task asked me to look for ("TODO referencing work that is now done", "stub whose real implementation has since landed elsewhere") do not currently exist — the TODOs I found are all still accurate descriptions of the current code and must stay.

## Flagged, not changed

| Item | Location | Why flagged instead of fixed |
|---|---|---|
| VLM endpoint/model default mismatch | `src/popup/popup.js` (`loadConfig()` fallback: `http://localhost:8000/...`, `Qwen/Qwen3-VL-8B-Instruct`) and matching placeholders in `src/popup/popup.html` (lines with `#vlm-endpoint`/`#vlm-model`) vs. `src/background/background.js` `onInstalled` defaults (`http://localhost:11434/...`, `qwen2.5vl:7b`) | `docs/SERVER_SETUP.md` documents `qwen2.5vl:7b` @ `:11434` (Ollama) as the only measured/verified config, which matches `background.js`. The popup's fallback/placeholder values reference a different port and an unreleased model (doc explicitly says `Qwen3-VL-8B-Instruct` is not yet in the Ollama registry). This fallback only activates before `chrome.storage.local` is populated, so it's low-impact, but changing the actual default *values* shown to a user is a behavior change I'm not confident is purely cosmetic, so I left it for the frontend/backend engineer to reconcile intentionally. |
| Duplicated DOM-scan + show-overlay call sequence | `src/background/background.js`: `handleScanAndOverlay()` (lines ~75-92) and the equivalent block inside `handleCaptureAndSanitize()` (lines ~108-118) both send `DOM_SCAN` then `SHOW_REDACTION_OVERLAY` to the content script | Looks like duplicated logic, but the two call sites have different error-handling semantics: `handleScanAndOverlay` awaits the overlay message and returns fields/dpr synchronously as the message's own result, while `handleCaptureAndSanitize` fires the overlay message with a swallowed `.catch(() => {})` so a failed overlay never blocks the VLM pipeline. Merging them into one shared helper risks silently changing one of those two behaviors, so I left both as-is. |
| Worker message `id` field appears unused on the receiving end | `src/inference/inference.worker.js` (`self.onmessage`, includes `id` in every `postMessage` reply) and `src/offscreen/offscreen.js` (`handleWorkerMessage` / `pendingRequests`, keyed by message `type`, not `id`) | `pendingRequests` in `offscreen.js` matches on response `type`, not `id`, so the `id` round-tripped through every worker message is currently write-only. This may be intentional scaffolding for a future multi-in-flight-request model. Removing/using it touches the worker `postMessage` message shape, which is explicitly frozen for this task — flagging only, not touching. |

## Files changed

- `src/offscreen/offscreen.js` — 1-line console log prefix fix (`"[SIH26171 Offscreen]"` → `"[Aegis Offscreen]"`) for internal consistency. No behavior change, no message-contract change.

## Doc-vs-code contradictions found (reported, not edited)

1. ~~`.opencode/memory/team-memory.md` task table (2.1, 2.2, 2.3) ... none of this code exists in `src/`~~ — **Resolved, see Lead note below.**
2. ~~"Progressive Setup UI" persisting `userProfile` ... not present~~ — **Resolved, see Lead note below.**
3. `src/popup/popup.js`/`popup.html` default VLM endpoint/model (`:8000`, `Qwen/Qwen3-VL-8B-Instruct`) contradicts `docs/SERVER_SETUP.md`'s verified config (`:11434`, `qwen2.5vl:7b`), which is what `background.js` actually uses as its installed default. **Still valid, unaffected by the note below.**

## Lead note (2026-08-28) — the "Critical finding" above was a repo-recovery gap, now fixed

Excellent catch, and the hypothesis in your own report (`"possibly lost in a git checkout/reset — see the e4c44d6 checkpoint before checking out main commit"`) was exactly right. Earlier in this session, a Cursor branch-checkout event stashed a batch of already-implemented Phase 2 work (this `.opencode`/`engineers` scaffold *and* several `src/` files) into a side-branch checkpoint commit (`0b06663`) without carrying it into `main`'s working tree. I'd already restored `.opencode`/`engineers` but had not yet restored the `src/` files when you ran this sweep — so every observation you made was a true, honest read of the tree at that moment; it just wasn't a complete tree. I've since restored `src/background/background.js`, `src/popup/popup.js`, `src/popup/popup.html`, and `src/inference/inference.worker.js` from that commit and verified directly:

- `normalizeProfile()` / `sanitizeAction()` are present and wired up in `background.js` (12 identifier references).
- `loadFaceModel()` / `detectFaces()` and `loadNERModel()` / `detectNER()` in `inference.worker.js` are real implementations, not stubs — `src/vendor/blaze.onnx` exists on disk.
- `popup.html` has the `#profile-input` / `#save-profile-btn` Progressive Setup UI; `popup.js` reads/writes `userProfile` as documented.

**One item from your report is still a genuinely live, unrelated finding, not a recovery artifact:** the `// TODO: when the ML engineer implements model loading, forward INIT_DONE` comment (`popup.js:114`) and `checkModelStatus()`'s hardcoded `"● DOM ready"` placeholder (`popup.js:124-127`) — I checked this specifically after restoring the files, and it's real: model loading is now implemented in the worker, but nothing forwards `INIT_DONE` to the popup yet, so this TODO is accurate and still open. Good candidate for a future small task (background → popup relay, or `chrome.storage.session` poll) — feature work, correctly still out of your scope as maintainer.

Your 1-line `offscreen.js` console-prefix fix stands as good, low-risk cleanup — no action needed there.

---

## 2026-08-28 — Follow-up after Task 2.8 (face-before-VLM)

No cleanup pass this turn (feature work landed on the live path; maintainer did not rewrite it).

**Now in `src/` (verified present, not stubs):** `detectFacesFromPayload`, `assertReadyForVlm`, `facePassComplete`, restored `src/vendor/blaze.onnx`. Offscreen no longer `return []` on face errors.

**Still genuinely open (unchanged):** `popup.js` `INIT_DONE` forwarding TODO and hardcoded `"● DOM ready"` in `checkModelStatus()`. Model load is real in the worker; the popup still does not surface it.

**Doc vs code:** team-memory 2.8 and specialist `work_done.md` files now describe this gate. Finding D (URL/title to VLM) remains open. Task 2.9 (NER `aggregation_strategy`) is closed — see follow-up below.

---

## 2026-08-28 — Follow-up after Task 2.9 (NER-before-VLM)

No cleanup pass. Feature work: `nerPassComplete`, `nerEntityGroup()`, `redactNerSpansInFields()`, `NER_REDACTION_REQUIRED` in the popup.

**Still genuinely open:** popup `INIT_DONE` forwarding TODO / `"● DOM ready"` placeholder. Finding D (full URL/title to VLM) unchanged.

---

## 2026-08-28 — Follow-up after demo pack 3.1–3.6

No cleanup pass. Landed in `src/`: `SET_VLM_API_KEY` (session), `sanitizeLocalConfig`, `buildPageStructureForVlm` (no url/title), content-script `MutationObserver`, popup loading/preview/receipt.

**Finding D closed in the VLM JSON** (local `lastReceipt.url` still session-only). **Still genuinely open:** popup `INIT_DONE` / `"● DOM ready"` placeholder. Chrome unpacked E2E still not run (`--load-extension` hung).

## 2026-08-28 — Follow-up after post-reload content-script inject

No cleanup pass. Feature work: `sendTabMessage` inject+retry, `NO_CONTENT_SCRIPT`, content-script `__AEGIS_CONTENT_SCRIPT__` guard, explicit `file://*/*` match.

**"● DOM ready" placeholder:** `checkModelStatus()` now sets **Models idle** (INIT-timeout work). `INIT_PROGRESS` / `INIT_DONE` listeners exist in `popup.js`; they fire only after offscreen starts. Not a leftover `"● DOM ready"` string — grep would confirm. Live Chrome E2E still owed.

---

## 2026-08-28 — Lean "Load unpacked" root (`dist/`) + dead-vendor-file finding

Chrome reported the extension at **629 MB** because `chrome://extensions` "Load unpacked" was pointed at the repo root, so `node_modules/`, `.opencode/` and the rest of the dev tree were billed to the extension. No `src/` file was edited this pass (Lead was editing concurrently).

| Item | Status | Notes / measured result |
|---|---|---|
| Verify `ort-wasm-simd-threaded.jsep.wasm` / `.jsep.mjs` are unreferenced | **Confirmed dead weight** | `rg "[A-Za-z0-9._-]*\.jsep\.(wasm\|mjs)"` over all of `src/` excluding the two jsep files themselves returns **zero matches**. Only 3 files in `src/` contain the token `jsep` at all: the jsep glue itself, `ort.min.js` (2 lines), `transformers.min.js` (2 lines). Evidence detailed below. |
| `scripts/build-dist.sh` (new, executable) | **Added** | Builds `dist/` as a minimal load root mirroring the repo layout (`dist/manifest.json` + `dist/src/...`), so no path inside `manifest.json` changes. Idempotent (`rm -rf dist` first); re-ran it and got a byte-identical tree. |
| Hardlink large binaries | **Working** | `*.wasm` / `*.onnx` are hardlinked (`ln`), with `cp -p` fallback. Verified by inode: `src/vendor/ort-wasm-simd-threaded.wasm` and `dist/src/vendor/ort-wasm-simd-threaded.wasm` are both inode `10804381`, link count 2; `blaze.onnx` both inode `11188073`. Small text files are copied so an editor rewriting `src/` cannot silently mutate `dist/`. |
| Manifest-path verification | **19/19 resolve** | The script embeds a Node check (temp file, `mktemp`) that walks `dist/manifest.json` and asserts `background.service_worker`, every `content_scripts[].js`, `action.default_popup`, `action.default_icon.*`, `icons.*` and every `web_accessible_resources` entry exists inside `dist/`. Globs are satisfied when ≥1 file matches: `src/vendor/*.wasm` → 1 match, `src/vendor/*.mjs` → 1 match. Build exits non-zero if any path is missing. |
| `dist/` ignored | **Done** | Added `dist/` to `.gitignore` (line 17) and `.graphifyignore` (line 5). `git check-ignore -v dist/manifest.json` → `.gitignore:17:dist/`; `git status --short` shows no `dist` entries. |
| `graphify update .` | **Run** | Rebuilt: 1277 nodes, 1611 edges, 110 communities. |
| Deleting the jsep pair from `src/vendor/` | **Not done — Lead's call** | Excluded from `dist/` only, per instructions. |
| `node_modules/`, `.opencode/`, `.git/`, `graphify-out/` | **Not touched** | Out of scope. |

### Evidence that the `.jsep.` pair is dead

1. **`src/vendor/ort.min.js` is the WASM-only bundle.** Its *only* wasm filename literals are 4 occurrences of `ort-wasm-simd-threaded.wasm`, across exactly 2 code sites, both plain string literals with no template concatenation:
   - `K??=t.locateFile?t.locateFile("ort-wasm-simd-threaded.wasm",h):h+"ort-wasm-simd-threaded.wasm":new URL("ort-wasm-simd-threaded.wasm",…)`
   - `o.in.wasm.wasmPaths={wasm:new URL("ort-wasm-simd-threaded.wasm",import.meta.url).href}`
2. **The `jsep` tokens in `ort.min.js` are runtime hook property names, not filenames:** `jsepOnCreateSession`, `jsepOnReleaseSession`, `jsepOnRunStart`, `jsepRegisterBuffer`, `jsepGetBuffer`, `jsepCreateDownloader`. All are `?.()`-guarded optional calls on the Emscripten module object, present whether or not a JSEP build is loaded.
3. **The worker never names a jsep file.** `src/inference/inference.worker.js:50-52` and `:59` both hardcode `new URL('ort-wasm-simd-threaded.wasm', VENDOR_DIR)`, and `ensureOrtWasmBinary()` prefetches that binary into `ort.env.wasm.wasmBinary` so `locateFile` is a no-op. `numThreads=1` / `proxy=false` also rule out the pthread and proxy-worker paths.
4. **Transformers.js does not want the jsep pair either.** Its inlined ORT references `${t}ort-wasm-simd-threaded.mjs/.wasm` and `${t}ort-wasm-simd-threaded.asyncify.mjs/.asyncify.wasm` — never `.jsep.`. `.asyncify.*` is the ORT ≥1.21 replacement for the old jsep build, and we do not vendor those files. `inference.worker.js:149-151` deliberately leaves `wasmPaths` at its default so NER fetches its own WASM remotely.
5. **`src/offscreen/offscreen.html` loads no vendor script at all** (explicit comment: both are ESM and would race the worker); `offscreen.js:96` only resolves `src/inference/inference.worker.js`.

So `ort-wasm-simd-threaded.jsep.wasm` (**27,797,172 B**) and `ort-wasm-simd-threaded.jsep.mjs` (**46,676 B**) — 27,843,848 B combined — are unreachable at runtime. They are still on disk in `src/vendor/`; only `dist/` excludes them.

Caveat on `ort-wasm-simd-threaded.mjs` (24,218 B): it is also never dynamically imported, because `ort.min.js` is patched so the blob→import path is disabled. It is shipped anyway — it is listed by name in `manifest.json` `web_accessible_resources` and costs 24 KB.

### Measured sizes (`du` / `stat`, no estimates)

Old load root — repo root, measured before `dist/` existed:

| Path | `du -sh` |
|---|---|
| `.` (whole repo = what Chrome was loading) | **654M** |
| `node_modules` | 518M |
| `.opencode` | 61M |
| `src` | 41M (of which `src/vendor` is 41M; all other `src/` dirs total 140K) |
| `.git` | 29M |
| `graphify-out` | 4.4M |

New load root:

| Metric | Value |
|---|---|
| `du -sh dist` | **15M** (`du -sk dist` = 14,952 KB) |
| Sum of `stat -f %z` over all files in `dist` | **15,266,705 bytes** |
| File count in `dist` | 18 |
| Real extra disk consumed | ~1,200 KB — `du -sk .` went 669,696 KB → 670,896 KB, because 14,497,687 B of that is hardlinked, not duplicated |

Every file shipped in `dist/src/vendor` (`ls -l`, exact bytes):

| File | Bytes |
|---|---|
| `ort-wasm-simd-threaded.wasm` | 13,961,845 (hardlink) |
| `transformers.min.js` | 557,060 |
| `blaze.onnx` | 535,842 (hardlink) |
| `ort.min.js` | 73,040 |
| `ort-wasm-simd-threaded.mjs` | 24,218 |
| `transformers-global.js` | 1,297 |
| **total** | **15,153,302** |

Excluded from `dist/src/vendor` (still present in `src/vendor/`): `ort-wasm-simd-threaded.jsep.wasm` 27,797,172 B, `ort-wasm-simd-threaded.jsep.mjs` 46,676 B.

### Usage

```
./scripts/build-dist.sh
```

Then point `chrome://extensions` → "Load unpacked" at `/Users/rehan/Developer/SIH/SIH26/dist` (not the repo root).

### Remaining risks

1. **Not verified in a live Chrome.** I verified statically that all 19 manifest paths resolve inside `dist/` and that no runtime code references anything absent from `dist/`. Loading `dist/` unpacked and running an end-to-end capture is still owed — the same live-Chrome E2E gap noted in earlier entries.
2. **`dist/` is a snapshot.** Editing anything under `src/` does not update the copied files in `dist/`; the script must be re-run. Anyone testing from `dist/` after a `src/` edit will otherwise silently run stale code. This is the main day-to-day footgun.
3. **Hardlink aliasing.** `*.wasm` / `*.onnx` in `dist/` share an inode with `src/vendor/`. An in-place rewrite of a vendor binary (rather than a delete-and-replace) would change both. Rewriting via a normal editor/download creates a new inode and leaves `dist/` stale instead — covered by risk 2. Small text files are copied specifically to avoid this ambiguity.
4. **Transformers.js NER fetches WASM from the network** (`allowLocalModels=false`, default `wasmPaths`). Unchanged by this work, but it means `dist/` being self-contained does *not* make NER offline-capable.
5. **The jsep deletion decision is Lead's.** I only excluded them. If some path I did not find loads them, deleting from `src/vendor/` would break it — though points 1-5 above are as thorough as static analysis gets here.

