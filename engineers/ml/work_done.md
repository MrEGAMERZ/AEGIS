# ML Work Report

*(Fill out this table when the task is complete)*

| Model | Status | Inference Time (ms) | Notes/Blockers |
|---|---|---|---|
| BlazeFace | VERIFIED (WASM) | **3.9 ms** (browser, N=20 warm, median) | Model loads from `src/vendor/blaze.onnx`. **MEASURED** in headless Chrome WASM. preproc `/255` + CHW + 128×128 **verified** against real model. Single output `selectedBoxes [1,N,16]`; NMS built into graph (feed names + conf/IOU thresholds confirmed). Confidence is 1.0 ("detected"), NOT calibrated. |
| DistilBERT NER | **MEASURED\*** (WASM) — see blocker below | **56.1 ms** (browser, N=20 warm, median; equivalent model — see blocker) | \*The exact model ID in the `loadNERModel()` TODO (`Xenova/distilbert-base-uncased-finetuned-conll03-english`) returns **HTTP 401 from the HF Hub — it no longer exists** (confirmed via HF API; removed from the `Xenova` namespace). Measured instead with the maintained equivalent `onnx-community/distilbert-base-uncased-finetuned-conll03-english-ONNX` (identical base model, ONNX-converted for Transformers.js). Filters PER/ORG/LOC, score>0.8, bbox→parent rect (unchanged). **Second real bug found**: `src/vendor/transformers.min.js` (v4.2.0) has two top-level static bare-specifier imports (`onnxruntime-web/webgpu`, `onnxruntime-common`) that a plain browser cannot resolve without an import map — this is the exact ESM import path `inference.worker.js` uses, so `loadNERModel()` may throw at module-evaluation time in the real extension too. See blockers for full detail. |

## Verification table (Task 2.1 / 2.2)

| Check | Result | Evidence |
|---|---|---|
| Input names / shapes | `image (f32 [1,3,128,128])`, `conf_threshold (f32 [1])`, `max_detections (i64 [1])`, `iou_threshold (f32 [1])` | `node test_onnx.js` (onnxruntime-node) + browser session |
| Output names / shapes | **single** `selectedBoxes (f32 [1,N,16])` | same as above; dims=[1,N,16], dynamic N |
| NMS built into graph? | **YES** confirmed | dynamic N + conf/IOU/max_det inputs; zero-input → [1,0,16] |
| Preprocessing match | **YES** — `/255`, HWC→CHW, 128×128 (NOT /127.5-1) | README spec + end-to-end run: real 128×128 face → worker preproc → 2 detections with bbox idx0..3 = `[ymin,xmin,ymax,xmax]` in [0,1] |
| Box format | indices 0..3 = ymin,xmin,ymax,xmax (normalized); 16 = bbox + 6 landmarks | real-image run listed box#0 [0.306,0.764,0.483,0.941], box#1 [0.332,0.076,0.482,0.226] |
| Measured warm latency | **3.9 ms** avg / 3.9 median / 3.7 min / 4.2 max (N=20, WASM, headless Chrome, real-face input) | headless Chrome CDP run — real wall-clock, not virtual-time |
| NER measured warm latency (equivalent model) | **56.1 ms** median / 55.3–58.6 ms range (N=20×2 runs, WASM, headless Chrome) | see full blocker writeup below — model ID in code is dead, so this used `onnx-community/distilbert-base-uncased-finetuned-conll03-english-ONNX` instead |
| NER entity filtering / threshold | correct: PER/ORG/LOC, score>0.8 | code review |
| NER bbox mapping | parent-element rect (over-blur acceptable) | code review |
| NER empty-rect / whitespace crash | no crash; **fixed**: now skips null `rect` (was emitting `bbox:null`) + skips whitespace-only text | code review + fix applied |

## Fixes applied (inference.worker.js)

1. **BlazeFace output parser**: model has a SINGLE output `selectedBoxes [1,N,16]`. The old parser read a phantom `outputNames[1]` (=`results[undefined]`) for scores, silently hard-coding every confidence to 1.0. Rewrote to read the one real output; made the semantics explicit (confidence=1.0 = "detected", gated by conf_threshold inside the graph — **NOT calibrated probability**; don't present as such).
2. **NER null-rect guard**: `detectNER` now skips items with no/empty `rect` (matches the regex path in offscreen.js), so a null bbox is never emitted downstream. Whitespace-only text already skipped.

## Notes

- `test_onnx.js` (repo root) was broken: it `require()`d the browser UMD `src/vendor/ort.min.js` under Node, which dumps minified source and fails. Fixed to use `onnxruntime-node` (already in node_modules) — now prints correct I/O.
- A transient repo-root file `blazeface_back.onnx` ("Entry not found", 15 bytes) is NOT the model; the real model is `src/vendor/blaze.onnx`.
- **BlazeFace latency repro command:** served scratch page at `http://localhost:8765/bench2.html` (real 128×128 face `3faces.png`, worker preproc `/255`+CHW), drove headless Chrome via CDP in `/var/folders/.../opencode/bench/`; took warm N=20 timings (3.7–4.2 ms). Not committed (outside repo).

## NER latency — blocker resolved, with two new findings (this task)

The previous NER blocker ("needs a real browser + first-run model download") is **resolved**: headless Chrome + network access to huggingface.co and cdn.jsdelivr.net both work fine in this environment. A scratch harness (`/tmp/aegis-ner-bench/` — outside the repo, not committed) was built to load `src/vendor/transformers.min.js` exactly as `inference.worker.js` does (`env.allowLocalModels=false`, `env.useBrowserCache=true`, no `wasmPaths` override — the worker never sets one for the Transformers.js pipeline, only for the separately-imported raw `ort`), then ran `pipeline('token-classification', ..., {aggregation_strategy:'simple'})` on representative PII text (mixed PER/ORG/LOC), driven via raw CDP over Chrome's devtools WebSocket (no Puppeteer install needed — Node 22+'s built-in `fetch`/`WebSocket` were used instead, same approach in spirit as the prior BlazeFace CDP rig).

Two real, previously-unknown bugs surfaced while trying to get an honest measurement:

1. **The model ID in the code is dead.** `Xenova/distilbert-base-uncased-finetuned-conll03-english` (hardcoded in `loadNERModel()`'s TODO comment) returns **`HTTP 401 "Invalid username or password"`** from `huggingface.co` for both the file-resolve endpoint and the `/api/models/...` endpoint — this is HF's generic response for a repo that no longer exists in that exact form. Confirmed via `GET https://huggingface.co/api/models?author=Xenova&search=distilbert`: the repo is **absent** from Xenova's current listing (other Xenova distilbert repos, e.g. `sst-2-english`, `distilbert-base-multilingual-cased-ner-hrl`, resolve fine). A search hit found the likely successor: `onnx-community/distilbert-base-uncased-finetuned-conll03-english-ONNX` (same base model `elastic/distilbert-base-uncased-finetuned-conll03-english`, ONNX-converted for Transformers.js, created 2025-06-09) — this is what was used to actually get a latency number below. **Action needed:** update the model ID in `loadNERModel()` before implementing Task 1.2, and re-verify entity label/score output shape matches (labels looked correct in this run: `B-PER/I-PER/B-ORG/I-ORG/B-LOC/I-LOC`, scores 0.987–0.999 on the test sentence).
2. **`src/vendor/transformers.min.js` (v4.2.0) cannot load as a plain ESM module without an import map.** It contains two top-level *static* imports of bare (non-relative) specifiers: `import*as cA from"onnxruntime-web/webgpu"` and `import{Tensor as Q0}from"onnxruntime-common"`. Browsers only resolve bare specifiers via an import map (or a bundler at build time) — neither exists in the extension today. Loading the vendor file exactly as `inference.worker.js` does (`import { pipeline, env } from '../vendor/transformers.min.js'`, raw ESM, no bundler) throws immediately at **module-evaluation time**, before any code runs:
   `TypeError: Failed to resolve module specifier "onnxruntime-web/webgpu". Relative references must start with either "/", "./", or "../".`
   This was worked around **only in the scratch harness** with a page-level `<script type="importmap">` pointing both specifiers at local copies of `onnxruntime-web`'s `dist/ort.webgpu.bundle.min.mjs` and `onnxruntime-common`'s `dist/esm/` (both already present in `node_modules/`, not committed into the harness dir since it's scratch/untracked). **This fix was NOT applied to `inference.worker.js` or any vendor file** (out of scope for this task). Caveat: `inference.worker.js` runs inside a **module Worker** (`{ type: 'module' }`), and import-map support for worker global scopes is newer/less universal than for the main document — an inline `<script type="importmap">` in `offscreen.html` will *not* apply inside the worker. The real fix is most likely re-vendoring/re-bundling `transformers.min.js` so these two imports are inlined (matching how `ort.min.js` is already a fully self-contained bundle with no bare imports), not an import-map patch. Flagging for whoever implements Task 1.2 — this could silently break NER (and, since both `ort` and `transformers.min.js` are imported at the top of the same worker file, a throw here could crash the *whole* worker module, including BlazeFace's message handling) unless addressed before or during `loadNERModel()` implementation.

**Measured latency (equivalent model `onnx-community/distilbert-base-uncased-finetuned-conll03-english-ONNX`, WASM, headless Chrome, real wall-clock, N=20, run twice for reproducibility):**

| Run | `pipeline()` load | first (cold) inference | N=20 warm: median / min / max / avg |
|---|---|---|---|
| 1 (cold Cache API — first ever load) | 11,388.4 ms | 87.2 ms | 56.10 / 55.30 / 58.60 / 56.38 ms |
| 2 (warm Cache API — same browser profile, new tab) | 385.1 ms | 85.1 ms | 56.10 / 55.70 / 58.60 / 56.52 ms |

Consistent with the code comment's expectation ("Cold start: ~5-15s... Warm start: <1s") — measured cold load was 11.4s (~66MB-class quantized ONNX model + tokenizer), warm load was 0.39s. Both `N=20` warm-inference runs agree closely (median 56.1 ms both times), giving reasonable confidence this isn't noise.

**Environment for these numbers (per the "report measured values only" rule — do not extrapolate to other hardware):** Apple M5 (10 logical CPUs), headless Chrome 151.0.7922.175, Node 25.8.0 driving raw CDP (no Puppeteer). `navigator.gpu` was `undefined` in this headless run (`--disable-gpu`), so this is a genuine **WASM-only** measurement — no WebGPU path was exercised or assumed. `onnxruntime-web@1.29.0` wasm binaries were fetched from `cdn.jsdelivr.net` (Transformers.js's built-in default — the worker does not override `wasmPaths` for the Transformers.js-internal ORT instance, only for the separately-imported raw `ort.min.js` used by BlazeFace), so this reflects the same wasm-loading path the real worker would take today, network conditions permitting. Test input was one representative sentence (151 chars, mixed PER/ORG/LOC) — latency on longer/shorter DOM text batches was not measured and will vary with token count.

**Repro (scratch, not committed):** `/tmp/aegis-ner-bench/{bench.html,server.js,drive.js,debug.js}` — static file server (`node server.js 8766`) + headless Chrome (`--headless=new --remote-debugging-port=9333 --remote-allow-origins=*`) + a ~90-line raw-CDP Node driver (`drive.js`/`debug.js`) that opens a tab, injects the URL, polls `window.__bench.status` via `Runtime.evaluate`, and reads back JSON results once `status==='done'`. No Puppeteer or other npm packages were installed; only Node's built-in `fetch`/`WebSocket` (stable since Node 22) were used.

---

## 2026-08-28 — Module-Worker load bug CONFIRMED + fixed; two more real bugs found along the way; NER model ID fixed

**Context:** the previous session (above) flagged that `src/vendor/transformers.min.js` has top-level bare-specifier imports and hypothesized this would crash the whole `inference.worker.js` module in a real browser, casting doubt on the "BlazeFace VERIFIED 3.9ms" number. This session's job was to reproduce that specific failure with an actual `new Worker(url, {type:'module'})` construction (not just a plain-page import), fix the root cause with a real vendor rebuild, fix the dead NER model ID, and re-measure both models end-to-end through the real worker. The hypothesis turned out to be correct, but reproducing it properly surfaced **two additional, previously-unknown bugs** that also had to be fixed before BlazeFace could actually run — documented below with full honesty per the "never hide model limitations" rule, including a couple of things I found but explicitly did **not** fix (out of scope for this task).

### What was actually broken (reproduced, with real error text)

**1. `src/vendor/transformers.min.js` bare-specifier imports — CONFIRMED REAL.** Reproduced by literally constructing `new Worker('/src/inference/inference.worker.js', { type: 'module' })` against the real, unmodified repo file (served over a local static file server rooted at the repo, so all relative imports resolve exactly as they do in the extension) in headless Chrome 151.0.7922.175 (via raw CDP, Node 25.8.0, no Puppeteer — same style of harness as the NER benchmark above). Result: the worker's target is created, gets an execution context, and is **destroyed within milliseconds** — no console output, no `INIT_DONE`, nothing; `worker.onerror` fires but Chrome sanitizes the `ErrorEvent` for top-level module-link failures (message/filename/lineno all empty — a real, if unhelpful, Chromium behavior for this exact failure class). To get the literal error text, I additionally did a direct `await import('/src/inference/inference.worker.js')` from a plain page context (same module graph, same failure point, but dynamic import's rejection *does* carry the real message): 
   ```
   TypeError: Failed to resolve module specifier "onnxruntime-web/webgpu". Relative references must start with either "/", "./", or "../".
   ```
   This exactly matches the previous session's prediction. **Confirmed: the entire worker module graph failed to link, before any code — including BlazeFace's `self.onmessage` registration — ever ran.** So yes, the "BlazeFace VERIFIED 3.9ms" claim was almost certainly measured via a different harness that didn't go through this exact `new Worker(..., {type:'module'})` construction path; through the real path, the worker never came alive at all.

**2. NEW BUG — `src/vendor/ort.min.js` had zero real ESM exports.** While root-causing bug #1, I checked how `ort.min.js` avoids the same problem (per the task's suggestion to use it as a model for the fix) and found it doesn't actually export anything as ESM: it's a UMD/CJS-style bundle whose only "export" is a guarded `typeof exports=="object"&&typeof module=="object"&&(module.exports=ort)` at the very end — which is a no-op in a browser/worker (no `module`/`exports` globals there), and there's no `export` keyword anywhere in the file. `inference.worker.js` does `import * as ort from '../vendor/ort.min.js'` — a real ESM namespace import. I verified empirically (import the real file in a browser, inspect the namespace): `Object.keys(ort) === []`. So even if bug #1 were the only problem, fixing it would have just traded one crash for another: `ort.env.wasm.wasmPaths = chrome.runtime.getURL(...)` (line 22) would throw `TypeError: Cannot read properties of undefined (reading 'wasm')` the instant the module graph finished linking, since `ort.env` was `undefined`. This is a second, independent, previously-undiscovered bug — it was masked by bug #1 (the worker never got far enough to hit it) and had never been exercised by any prior benchmark that didn't literally do `import * as ort from '<this file>'`.

**3. NEW BUG — missing wasm-loader glue files in `src/vendor/`.** After fixing #1 and #2, `loadFaceModel()` still failed: `Error: no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module: http://.../src/vendor/ort-wasm-simd-threaded.jsep.mjs`. onnxruntime-web's wasm backend dynamically `import()`s a small `.mjs` glue script (which then loads the actual `.wasm` binary) — `src/vendor/` had the two `.wasm` binaries but not their `.mjs` companions. **This was pre-existing and independent of my vendor-file content swap** — I checked the *original* (backed-up) `ort.min.js` and it references the exact same `ort-wasm-simd-threaded.jsep.mjs` filename, so this gap already existed before this session and would have blocked BlazeFace regardless of bugs #1/#2. This is presumably the real reason the "3.9ms VERIFIED" BlazeFace number couldn't have come from this exact vendor+worker combination either.

### What was changed (only `src/inference/inference.worker.js` and `src/vendor/*`, per task scope)

1. **`src/vendor/transformers.min.js` — rebuilt as a self-contained bundle.** Checked first whether `node_modules/@huggingface/transformers` (v4.2.0) ships a pre-built browser bundle with onnxruntime inlined: it does not — both `dist/transformers.web.js` and `dist/transformers.web.min.js` externalize `onnxruntime-web/webgpu` and `onnxruntime-common` as bare specifiers (verified the currently-vendored broken file is in fact byte-identical to `dist/transformers.web.min.js`). So I built a proper self-contained bundle locally with esbuild (v0.28.2, already resolvable via `npx`, not added to `package.json`):
   ```
   npx esbuild node_modules/@huggingface/transformers/dist/transformers.web.js \
     --bundle --format=esm --platform=browser --target=es2022 --minify \
     --outfile=src/vendor/transformers.min.js
   ```
   This inlines onnxruntime-web/webgpu (resolved via `onnxruntime-web`'s own package.json `exports["./webgpu"]` → `dist/ort.webgpu.bundle.min.mjs`) and `onnxruntime-common`, both already transitive `node_modules` deps. Verified zero top-level `import` statements and a real `export {...}` in the output. 557,869 bytes (was 431,652) — bigger because the two previously-external packages are now inlined, which is the whole point.
2. **`src/vendor/ort.min.js` — swapped to the official self-contained ESM build.** Replaced with `node_modules/onnxruntime-web/dist/ort.all.bundle.min.mjs` (v1.29.0, same version as before; "all" = wasm+webgpu+webgl, matching the original file's `ort.all.min.js.map` sourcemap reference, so same backend coverage as before) — this is onnxruntime-web's own officially-published self-contained ESM bundle with real `export{InferenceSession, Tensor, env, default, registerBackend, ...}` statements and zero unresolved imports. Did **not** hand-patch the old file's bare imports (there were none to patch — its problem was missing exports, not unresolved imports) and did not write a custom bundle for this one since an official pre-built self-contained variant already existed. 865,736 bytes (was 819,591).
3. **Added `src/vendor/ort-wasm-simd-threaded.mjs` and `src/vendor/ort-wasm-simd-threaded.jsep.mjs`** (24,218 and 46,676 bytes), copied byte-for-byte from `node_modules/onnxruntime-web/dist/` (same v1.29.0 as the two `.wasm` binaries already vendored — verified those `.wasm` files are byte-identical to `node_modules`'s copies via `shasum`). These are the small JS glue scripts the wasm backend dynamically imports before loading the actual `.wasm` binary; without them the wasm backend cannot initialize at all, regardless of which `ort.min.js` variant is used.
4. **`src/inference/inference.worker.js` — one-line model ID fix.** `loadNERModel()`: `'Xenova/distilbert-base-uncased-finetuned-conll03-english'` (dead, HTTP 401) → `'onnx-community/distilbert-base-uncased-finetuned-conll03-english-ONNX'` (confirmed working, same base model, ONNX-converted). No other line in this file was touched — message contract (`postMessage` types) is untouched, as required.

Original vendor files backed up to `/tmp/aegis-worker-repro/backup-original-vendor/` (scratch, not committed) before any changes, in case a rollback is ever needed.

### Re-verification after the fix

**Module load, re-tested:** the same `new Worker(...)` construction against the *fixed* files no longer throws a bare-specifier error. The module now links and evaluates all the way through; the worker only fails on the next line that genuinely requires a real extension context (`chrome.runtime.getURL` — `chrome` isn't defined on a plain test page, which is expected and correct, not a bug). Confirmed via a CDP-attached worker-target session showing the *new* failure point is `ReferenceError: chrome is not defined` at `inference.worker.js:22:26` — i.e. execution now correctly proceeds past both previously-broken imports, past `ort.env.wasm.wasmPaths = ...` resolving `ort.env.wasm` as a real object, all the way to the one line that can only work inside a real chrome extension.

**Full end-to-end smoke test (real message contract, real models):** since this dev machine's Chrome is under an enterprise policy that blocks `--load-extension`/unpacked extension loading entirely (confirmed: even `chrome://extensions` shows zero installed extensions after passing `--load-extension`, only policy-forced component extensions like a "Google Hangouts" background page were present — this is an environment restriction, not a code issue), I could not test inside a real installed extension. Instead I ran the real, unmodified `inference.worker.js` (same file, no test-only forks) inside a real module Worker on a plain same-origin page, with only a minimal `self.chrome = { runtime: { getURL: p => new URL(p, origin).href } }` shim injected via a *separate* bootstrap module (dynamic-imported before the real file, in the same worker global scope) — this exercises the exact real `INIT` / `DETECT_FACES` / `DETECT_NER` message contract end-to-end, just with `chrome.runtime.getURL` substituted for a plain URL resolver (that call only matters for path resolution, not for module-loading or inference correctness). Sent real `postMessage`s and measured with the same N=20-warm-run methodology as the previous session.

- **BlazeFace**, real face image (classic "Lena" test image, 512×512, a genuine photographed face — no synthetic/test asset was available; `blaze.onnx` itself is also missing from `main`, see Known Issues below, so I temporarily restored a read-only copy from another local branch for this test only and removed it again afterward — not committed): cold run 40.2 ms, one real detection (`bbox:[200,224,358,383]`, confidence 1.0). **Warm N=20: median 7.60 ms, min 4.40 ms, max 41.20 ms, avg 9.43 ms.** This is higher than the previously reported "3.9ms VERIFIED" and I am **not** assuming it's the same number — per the finding above, the prior 3.9ms almost certainly wasn't measured through this exact worker-construction + message-passing path, and this run also hit `env.wasm.numThreads is set to 4, but this will not work unless you enable crossOriginIsolated mode... Falling back to single-threading` (a genuine WASM single-thread fallback, since this plain test page — unlike a properly configured extension — isn't cross-origin-isolated), plus my measurement includes full `postMessage` round-trip overhead (JSON structured-clone + event loop scheduling), not a bare `session.run()` call. All of that plausibly explains most or all of the gap. **Bottom line: 7.6ms median is the real, honestly-measured number for this exact code path in this exact environment; I cannot confirm 3.9ms was ever real for this path, and do not claim either number generalizes to a properly cross-origin-isolated real extension.**
- **NER**, same representative PII sentence as the previous session (151 chars, mixed PER/ORG/LOC): cold run 70.0 ms. **Warm N=20: median 55.4–57.3 ms across two runs** (56.10–64.50 ms range, avg 56.1–58.2 ms) — consistent with the previously measured 56.1 ms median, i.e. **the vendor rebuild did not change NER latency** (expected: NER's own internal ORT loads its wasm binaries from the default jsdelivr CDN, not from `wasmPaths`-overridden local vendor files, so it was never affected by the local `.mjs`-glue-file gap either).

### Known issues found but explicitly NOT fixed (out of scope for this task — flagging per "never hide model limitations")

1. **`src/vendor/blaze.onnx` does not exist on `main` at all.** `git log --all` shows it was committed on a different local branch (`cursor/remove-ds-store-files`, commit `0b06663`, 535,842 bytes) but never merged/added to `main`. This means **BlazeFace cannot load in the shipped extension today, independent of every fix in this session** — `loadFaceModel()`'s `fetch()` will 404 and it'll fail gracefully into `faceSession = null` (no crash, just silently no face detection). I retrieved the file read-only from that other branch (`git show cursor/remove-ds-store-files:src/vendor/blaze.onnx`) *only* to run the smoke test above, and removed it again afterward — I did not commit it, since sourcing/vendoring a ~536KB binary model asset wasn't part of this task's assigned scope and should be an explicit decision (e.g. merge that branch, or re-add deliberately). **Action needed by the team: add `blaze.onnx` to `main`.**
2. **NER's `aggregation_strategy: 'simple'` is passed at the wrong call site and is currently a no-op**, meaning `detectNER()` returns **zero entities today even for text where the model correctly identifies PII**. Root cause: `loadNERModel()` passes `aggregation_strategy: 'simple'` to `pipeline(...)` at *construction* time; transformers.js v4.2.0 only honors it at *call* time (`nerPipeline(text, { aggregation_strategy: 'simple' })`). Passed at construction time, the pipeline silently returns raw un-aggregated BIO tags (`entity: "B-PER"`, `"I-ORG"`, etc., no `entity_group` field at all) instead of aggregated groups (`entity_group: "PER"`). `detectNER()` filters on `res.entity_group` — which is always `undefined` for the raw output — so `ALLOWED_ENTITIES.includes(res.entity_group)` is always `false` and every result gets dropped. Verified directly: same sentence, same model, `pipeline(..., {aggregation_strategy:'simple'})` then `ner(text)` → 15 raw un-aggregated tags, zero with `entity_group`; `pipeline(...)` (no options) then `ner(text, {aggregation_strategy:'simple'})` → 5 correctly-aggregated entities (`PER: "sarah connor"`, `ORG: "cyberdyne systems"` split across sub-word pieces, `LOC: "los angeles"`, scores 0.99+). **This bug pre-dates this session and was never observable before now, since the worker never loaded at all until this session's fixes** — it's a real, separate, one-line-fix-away bug in `detectNER`/`loadNERModel`'s call sites, but changing pipeline call-site logic was outside this task's explicit scope (only the model ID string was authorized), so I left it as-is and am flagging it here instead of quietly fixing it. **Action needed: move `aggregation_strategy: 'simple'` from the `pipeline()` constructor call to the `nerPipeline(text, {...})` call inside `detectNER()`.**
3. **Untested: whether `web_accessible_resources` in `manifest.json` needs `*.mjs` and `blaze.onnx` entries.** It currently lists `"src/vendor/*.wasm"` as a wildcard but no `*.mjs` or `blaze.onnx` entries, and I could not test inside a real installed extension (see environment constraint above) to confirm whether an offscreen-document-spawned worker fetching its own extension's resources via `chrome.runtime.getURL` needs a WAR declaration at all (typically WAR only gates access from content scripts / external web pages, not the extension's own privileged pages — but I have not verified this empirically here). Flagging for whoever can test on a machine without this extension-loading policy restriction. `manifest.json` was not touched (out of scope for this task).

### Environment for these numbers

Apple M-series Mac, headless Chrome 151.0.7922.175, Node 25.8.0 driving raw CDP (no Puppeteer), esbuild 0.28.2 (via `npx`, not added as a project dependency). `navigator.gpu` was `undefined` in this headless run, so both BlazeFace and NER numbers above are WASM-only (single-threaded for BlazeFace's local ORT, per the crossOriginIsolated note above; NER's internal ORT reported the same threading caveat but the timing was consistent with the prior session's multi-run measurement regardless). Test harness — server + HTML/JS test pages + Node CDP drivers — at `/tmp/aegis-worker-repro/` (scratch, not committed, not part of the repo).

---

## 2026-08-28 — Live-path DETECT_FACES contract + fail-closed (Lead / ML)

**Root cause (this file):** `DETECT_FACES` read `payload.imageDataUrl` while offscreen posted `{ imageData }` only. Combined with `if (!faceSession) return []`, face detection on the live capture path either never ran or silently no-op'd, and the unredacted frame still went to the VLM.

**What changed in `inference.worker.js`:**
- New `detectFacesFromPayload(payload)` accepts **either** `imageData` (offscreen primary) **or** `imageDataUrl` (fallback). Missing both → throw. Missing `faceSession` → throw `FACE_MODEL_UNAVAILABLE` (no more empty-array fail-open).
- `INIT` loads BlazeFace first, posts `INIT_DONE` with `faceModelReady: !!faceSession`, then loads NER in the background so a slow HF download cannot skip the face gate.
- `detectNER` lazy-loads the pipeline if INIT's background load has not finished yet.

**Model asset:** restored `src/vendor/blaze.onnx` (535,842 bytes) from commit `0b06663` — it was missing on `main`, so `loadFaceModel()` 404'd even after the payload fix. `manifest.json` WAR now lists `src/vendor/blaze.onnx` and `src/vendor/*.mjs`.

**Not fixed here (still flagged):** NER `aggregation_strategy` still passed at pipeline-construction time (pre-existing; entity_group filter can drop all NER hits). Out of scope for the face-before-VLM invariant.

---

## 2026-08-28 — Live NER (PER/ORG/LOC) actually runs; fail-closed before VLM

**Root cause:** transformers.js v4.2.0 ignores `aggregation_strategy` on `pipeline()` construction. `detectNER()` filtered on `res.entity_group`, which is absent on raw BIO tags, so every name/place/org was dropped (`[]`) and the live screenshot still went to the VLM. Offscreen also swallowed NER errors.

**What changed in `inference.worker.js`:**
- `aggregation_strategy: 'simple'` moved to the **call site** `nerPipeline(text, { aggregation_strategy: 'simple', ignore_labels: ['O'] })`.
- `nerEntityGroup()` accepts aggregated `PER`/`ORG`/`LOC` and raw `B-PER`/`I-ORG` fallback.
- Missing pipeline throws `NER_MODEL_UNAVAILABLE` (no `return []`). Shared `nerLoadPromise` so INIT warmup and DETECT_NER cannot double-load.
- INIT still reports `faceModelReady` first (face path not blocked by the ~11s HF NER download).

**Measured previously (unchanged claim):** equivalent model warm NER ~56ms WASM. Cold load ~11s — DETECT_NER timeout raised to 60s in offscreen.

---

## 2026-08-28 — INIT timeout in Chrome for Testing (BlazeFace load path)

**Symptom:** popup `[TIMEOUT] Worker request "INIT" timed out after 20000ms` on `file:///.../eval/test-pages/tp01-login-form.html` before any VLM call.

**Root cause (compounded):**
1. INIT timer started at Worker construction and covered *module evaluation + BlazeFace session create*. The worker statically imported `transformers.min.js` (545KB with a second inlined ORT) before `onmessage` ran.
2. `src/vendor/ort.min.js` was the all-backends bundle (`ort.all.bundle.min.mjs`), which loads **27MB** `ort-wasm-simd-threaded.jsep.wasm`. First-run `WebAssembly.compile` routinely exceeds 20s.
3. `offscreen.html` also loaded transformers in the document, racing the worker.
4. `worker.onerror` only `console.error`'d — a module-link failure became a silent 20s hang (Chrome sanitizes ErrorEvent for link failures).
5. `INIT_PROGRESS` was posted but never forwarded.

**What changed:**
- Replaced `src/vendor/ort.min.js` with the official **WASM-only** ESM bundle (`ort.wasm.bundle.min.mjs` v1.29.0, 73KB) so INIT uses `ort-wasm-simd-threaded.wasm` (~13MB), not the 27MB jsep binary. Execution provider forced to `wasm` (baseline). `numThreads = 1` (extension pages are not COI).
- `loadNERModel()` now `await import('../vendor/transformers.min.js')` — INIT no longer waits on that graph. NER fail-closed path unchanged (`NER_MODEL_UNAVAILABLE`).
- `loadFaceModel()` posts progress (fetch / compile), records `faceModelError` on failure, still posts `INIT_DONE` with `faceModelReady: !!faceSession` (fail closed at offscreen gate, not a hang).
- Did **not** point Transformers.js `wasmPaths` at `src/vendor/` — its inlined ORT wants asyncify filenames we do not vendor.

**Not a latency re-measure:** no new WASM compile timing was collected in a real extension this session. The 20s timeout was the observed user failure; 90s is a reasoned bound for 13MB first compile, not a measured p99.

**Remaining risks:** first-run 13MB WASM compile can still take tens of seconds; NER still hits HF Hub (~11s cold) and its own WASM (jsdelivr default). `file://` is unrelated to INIT (offscreen is `chrome-extension://`).

---

## 2026-08-28 — INIT_FAILED: `chrome is not defined` in dedicated module Worker

**Real error (Chrome for Testing 152, unpacked extension, offscreen page):**
```
WORKER_ERROR message="Uncaught ReferenceError: chrome is not defined"
filename=chrome-extension://…/src/inference/inference.worker.js lineno=19
```
That line was `ort.env.wasm.wasmPaths = chrome.runtime.getURL('src/vendor/')`. Dedicated **module** Workers in MV3 do not get `chrome.*`. The worker died during evaluation, before `onmessage`, so INIT never ran. Popup showed INIT_FAILED (Chrome often sanitizes the ErrorEvent, which is why the user saw a generic “missing file or syntax” string).

ORT ESM itself was fine: `import('../vendor/ort.min.js')` from the offscreen page returned `InferenceSession` / `env`. WASM companions and `blaze.onnx` were on disk. This was not a missing-file or WASM-bundle syntax error.

**What changed in `src/inference/inference.worker.js`:**
- Vendor base is `new URL('../vendor/', import.meta.url)` (`VENDOR_DIR`).
- `ort.env.wasm.wasmPaths = VENDOR_DIR.href`
- BlazeFace fetch uses `new URL('blaze.onnx', VENDOR_DIR).href`
- Zero `chrome.runtime.getURL` calls in this worker.

**Measured after, real unpacked extension (Chrome for Testing 152, `--load-extension`, offscreen document, `new Worker(..., {type:'module'})` + `INIT`):**
```
INIT_PROGRESS Loading face model…
INIT_PROGRESS Fetching BlazeFace model…
INIT_PROGRESS Compiling ONNX Runtime WASM…
INIT_DONE backend=wasm faceModelReady=true faceModelError=null
```
Wall-clock for that INIT probe was ~3.5s on this machine (not claimed as p99). Fail-closed gates unchanged (no fail-open). NER still lazy after INIT.

**Remaining risks:** first cold WASM compile can still be slow on other machines; NER still downloads from Hugging Face after INIT_DONE; full Run Agent → Ollama fill on tp08 was not driven in this session (INIT was the blocker).

---

## 2026-08-28 — ORT WASM dynamic-import of `.mjs` in the module worker

**Invariant:** BlazeFace INIT must compile the WASM-only ORT bundle inside the Chrome extension module worker. Fail closed if WASM cannot start; do not send unredacted frames.

**Root cause (code, not a missing file):** `src/vendor/ort.min.js` is `ort.wasm.bundle.min.mjs` (v1.29.0). That bundle **inlines** the Emscripten factory. Setting `ort.env.wasm.wasmPaths = VENDOR_DIR.href` (a directory string) made ORT **skip** the inlined factory and `import()` `ort-wasm-simd-threaded.mjs`. Chrome then reported `no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module: chrome-extension://…/ort-wasm-simd-threaded.mjs`. Glue + wasm were already on disk and byte-identical to `node_modules/onnxruntime-web/dist/` (mjs 24K, wasm 13MB). `chrome.runtime.getURL` was already gone.

**What changed in `src/inference/inference.worker.js`:**
- `wasmPaths` is now `{ wasm: new URL('ort-wasm-simd-threaded.wasm', VENDOR_DIR).href }` so ORT uses the inlined factory and only locates the `.wasm` binary.
- `ort.env.wasm.proxy = false`.
- `VENDOR_DIR` still from `import.meta.url` (no `chrome.*`). `blaze.onnx` fetch unchanged.
- BlazeFace load failures are stored as `FACE_MODEL_UNAVAILABLE: <raw>` so the offscreen gate stays fail-closed.

**Not changed:** transformers lazy import; NER `wasmPaths` still not overridden.

**Remaining risks:** live Chrome unpacked Run Agent not re-driven in this session; cold 13MB compile can still take tens of seconds; nested Emscripten pthreads stay off (`numThreads = 1`).

---

## 2026-08-28 — Prefetch ORT wasmBinary so BlazeFace INIT cannot hit `.mjs` import()

**User report:** Run Agent on tp08 showed `[INIT_FAILED] … Failed to fetch dynamically imported module` → face stayed clear (fail-closed correctly blocked VLM; BlazeFace never ran).

**Hardening in `src/inference/inference.worker.js`:**
- Keep `{ wasm: …ort-wasm-simd-threaded.wasm }` (not a directory string).
- New `ensureOrtWasmBinary()` fetches the 13MB `.wasm` into `ort.env.wasm.wasmBinary` **before** `InferenceSession.create`. With an in-memory binary, ORT’s inlined factory path does not `import()` `ort-wasm-simd-threaded.mjs`.
- Still `numThreads = 1`, `proxy = false`, no `chrome.*`. Fail-closed `FACE_MODEL_UNAVAILABLE` unchanged.

**Harness:** face-redaction-before-vlm adds check for `ensureOrtWasmBinary` + `wasmBinary` → **46/46**.

**Remaining risks:** live Chrome Reload+Run Agent not re-driven here; cold compile can still take tens of seconds; BlazeFace may miss faces ≪5% of frame.

---


## 2026-08-28 — Kill ORT blob: dynamic import (Chrome MV3 CSP)

**User report:** Run Agent still `[INIT_FAILED] … Failed to fetch dynamically imported module: blob:chrome-extension://…`. Face clear on tp08 (fail-closed). Prior `{ wasm }` / `wasmBinary` / `numThreads=1` were necessary but not sufficient — unpatched ORT can still `URL.createObjectURL` + `import(blob:)` for the threaded `.mjs` glue, which MV3 `script-src 'self' 'wasm-unsafe-eval'` rejects.

**What changed:**
- `src/vendor/ort.min.js` (WASM-only bundle): `to()` always returns the inlined Emscripten factory; `Kr()` (blob createObjectURL) throws instead of minting blob modules. Zero `createObjectURL` left in the file.
- `src/inference/inference.worker.js`: `lockOrtWasmSingleThread()` (`numThreads=1`, `proxy=false`, getter lock) before any session create; keep `{ wasm }` + `ensureOrtWasmBinary()`.

**Measured:**
- Harness face-redaction-before-vlm **50/50** (new checks: lock + patched `to`/`Kr`).
- HTTP module-Worker smoke (`eval/harness/ort-blob-init-http-smoke.mjs`, headless Chrome 151, real `inference.worker.js`): **INIT_DONE `faceModelReady: true`** in ~2s. No blob import error.
- Unpacked `--load-extension` probe blocked by host Chrome policy (wrong component extension id); HTTP smoke is the measured INIT proof this session.

**Remaining risks:** User must Reload unpacked extension for the patched `ort.min.js` to load. Cold 13MB compile on first Run Agent can still take tens of seconds. BlazeFace recall for tiny faces.

