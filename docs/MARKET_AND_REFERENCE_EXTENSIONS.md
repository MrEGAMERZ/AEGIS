# Market & Reference Extensions — Aegis (SIH26171)

Research date: **2026-08-31**. Scope: Chrome MV3 browser agents, form fillers, privacy redaction, and on-device ML in extensions — distilled into build lessons for Aegis’s four-problem stack (**Local Eye → Privacy Shield → Brain → Hand**).

---

## Closest products & repos

| # | Name | URL | What it does | Similarity to Aegis | License (if known) |
|---|------|-----|--------------|---------------------|----------------------|
| 1 | **Crab-Agent** | [github.com/Hert4/crab-agent-extension](https://github.com/Hert4/crab-agent-extension) | MV3 side-panel agent: screenshot + DOM/a11y tree → LLM → click/type/scroll loop; Ollama + cloud providers; workflows & memory | **High** — closest open MV3 “computer use” loop; **no** on-device redaction before screenshot leaves device | MIT |
| 2 | **Claude in Chrome** | [chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn](https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn) · [claude.com/claude-for-chrome](https://claude.com/claude-for-chrome) | Commercial screenshot/DOM agent in side panel; pre-approved actions; Claude Code integration | **High** — same observe→act UX; **anti-pattern** for Aegis: raw screen context to cloud | Proprietary (Anthropic) |
| 3 | **Clearform Redact** | [github.com/Clearform-Labs/Redact](https://github.com/Clearform-Labs/Redact) · [redact.clearformlabs.com](https://redact.clearformlabs.com/) | MV3 paste interceptor: MiniLM token-classifier (ONNX INT8 ~23 MB) + regex in Web Worker; zero network | **High** for Privacy Shield text path; text-only, no vision/agent loop | PolyForm Noncommercial 1.0.0 |
| 4 | **Superfill.ai** | [github.com/superfill-ai/superfill.ai](https://github.com/superfill-ai/superfill.ai) · [superfill.ai](https://www.superfill.ai/) | MV3 (WXT) memory + AI form fill; CDP agent loop with **annotated screenshots** to vision models | **High** for form-fill + vision; ships raw screenshots to LLM (no local redaction) | MIT (BYOK/self-hosted features) |
| 5 | **Blankit** | [github.com/SVirat/blankit](https://github.com/SVirat/blankit) | Local-first PII scrubber for ChatGPT/Claude/Gemini: UI + **network fetch/XHR intercept** before send | **Med–High** for Privacy Shield philosophy; text/chat boundary, not screen capture | Open source (license not pinned in README) |
| 6 | **coprepaste** | [github.com/AlecDusheck/coprepaste](https://github.com/AlecDusheck/coprepaste) | Copies visible tab text with OpenAI `privacy-filter` ONNX in **offscreen doc**; first-run model fetch from R2 | **Med** — strong MV3 ORT/offscreen pattern; **anti-pattern**: 800 MB remote model bootstrap | Check repo |
| 7 | **dassi** | [Chrome Web Store](https://chromewebstore.google.com/detail/dassi-ai-agent-for-chrome/bjcngahpcjeililljmfegmlanlpgibdi) | Marketed side-panel agent: reads page, fills forms, multi-tab workflows; BYOK or bundled access | **Med** — agent UX reference; cloud perception assumed | Proprietary |
| 8 | **FillApp** | [Chrome Web Store](https://chromewebstore.google.com/detail/fillapp-ai-form-filler-da/mdoaagdccddnbjncalegjfemhnlijgbo) | Fill mode + **Agent mode** with visible on-screen actions; claims in-browser session, no credential sharing | **Med** — form-fill demo competitor; privacy claims unverified vs Aegis fail-closed gates | Proprietary |
| 9 | **Gecko Agent** | [github.com/Gecko51/gecko-agent](https://github.com/Gecko51/gecko-agent) | Side-panel OpenRouter agent with 9 DOM automation tools, agentic loop (≤40 steps), LinkedIn/Airtable focus | **Med** — Hand/Brain patterns via DOM tools, not vision-first redaction | Check repo |
| 10 | **Maska** | [github.com/Susskind2/Maska](https://github.com/Susskind2/Maska) | Zero-server image redaction: MediaPipe face detection, Fabric.js canvas, blur before export | **Med** for Local Eye face masking UX; standalone popup, not `captureVisibleTab` agent | Check repo |
| 11 | **Sensitive Blur Screenshot** | [github.com/TandaHQ/sensitive-blur-screenshot](https://github.com/TandaHQ/sensitive-blur-screenshot) | Temporarily CSS-blurs DOM (regex + `.sensitive` class), `captureVisibleTab`, restore DOM | **Med** — clever screenshot privacy without ML; weaker on faces/photos not in DOM text | Check repo |
| 12 | **Gemma 4 Browser Assistant** | [github.com/nico-martin/gemma4-browser-extension](https://github.com/nico-martin/gemma4-browser-extension) | Hugging Face reference: Transformers.js in **background SW**, side panel chat, content script page bridge | **Med** for on-device ML packaging; runs generative model locally, not redaction+VLM split | Check repo |
| 13 | **PrivacyScrubber** | [Chrome Web Store](https://chromewebstore.google.com/detail/privacyscrubber-%E2%80%94-pii-red/pimoejgefeilajmmbpghifdmhdlkgjol) | Right-click text scrub with typed tokens `[NAME_1]`; 100% local, “airplane mode test” marketing | **Med** for Privacy Shield text + judge-facing privacy proof; no vision/agent | MIT (per store listing) |
| 14 | **Stagehand / browser-use** | [github.com/browserbase/stagehand](https://github.com/browserbase/stagehand) · [github.com/browser-use/browser-use](https://github.com/browser-use/browser-use) | Playwright-based agents: hybrid `act()`/`extract()` or fully autonomous loops; screenshot + a11y hybrid modes | **Low–Med** — architecture textbook, not MV3; Sentinel benchmark shows DOM-first beats raw screenshot token cost | MIT (both) |
| 15 | **shield-vision** (library) | [npmjs.com/package/shield-vision](https://www.npmjs.com/package/shield-vision) | Client-side BlazeFace + optional plate masking on canvas before upload; WebGPU→WebGL→WASM backend pick | **Med** for Local Eye mask rendering; npm library, not extension | Check npm |

**Whitespace (validated):** No shipping commercial agent (Anthropic, OpenAI, Google Mariner-class) advertises **on-device visual redaction before cloud VLM inference**. Closest prior art is **text-only** local scrubbers (Redact, Blankit, PrivacyScrubber) or **post-capture** blur tools (Maska, Sensitive Blur Screenshot), not a unified capture→sanitize→act pipeline.

---

## What to copy

### Architecture & MV3 patterns

- **Thin service worker, fat offscreen doc** — coprepaste, Clearform Redact, Hugging Face ORT guidance, and Aegis’s own `ensureOffscreen()` pattern: SW orchestrates; DOM/canvas/WASM live in one offscreen document with `reasons: ['WORKERS']` or `DOM_PARSER`. Never load ONNX in the SW (no Workers, suspension kills in-memory models).
- **Single offscreen registry** — Dev.to / mevir pattern: one offscreen page hosts a keyed pipeline map (`face`, `ner`, `mask`) because Chrome allows **only one** offscreen document per extension.
- **Module worker + bundled WASM paths** — Set `env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('/')`, `numThreads = 1`, ship `.wasm`/`.mjs` in `web_accessible_resources`; avoid jsdelivr at runtime (transformers.js #1248).
- **Model vendoring & quantization** — Clearform Redact: INT8 ONNX **23.4 MB** bundled under `chrome-extension://`; cache via extension-origin Cache API. Aegis target: offline NER + ORT like Redact, not coprepaste’s 800 MB first-run download.
- **Fail-closed privacy gates** — Blankit’s dual layer (UI + network intercept) inspires defense in depth; Aegis should keep `assertReadyForVlm()` ordering and receipt counts (`faces`, `piiSpans`, `passwordFields`) visible like PrivacyScrubber’s “airplane mode test.”

### Agent loop & UX

- **Side panel as control plane** — Crab-Agent, Claude in Chrome, dassi, FillApp: persistent chat + status while agent acts on page. Aegis popup/side panel should show sanitized preview, step receipt, and explicit confirm before submit/purchase-class actions.
- **Screenshot + structure hybrid** — Crab-Agent and Stagehand hybrid mode: send **sanitized image** plus **a11y/DOM field list** (Aegis `pageStructure`) to cut tokens and improve click reliability vs screenshot-only.
- **Permission modes** — Crab-Agent Ask/Auto/Strict maps cleanly to Aegis demo vs production.
- **HiDPI coordinate contract** — Commercial agents learned the hard way (Aegis 4.2): document whether VLM coords are physical or CSS pixels and test on Retina; include `imageSize` + `devicePixelRatio` in payload.
- **Error taxonomy** — FillApp “every action visible”; Aegis should surface `VLM_BAD_RESPONSE`, `FACE_REDACTION_REQUIRED`, not generic `[UNKNOWN]`.

### Packaging & distribution

- **Lean `dist/` artifact** — Ship judges a **15 MB** unpacked folder, not monorepo root (654 MB). Gemma4 extension and WXT projects (Superfill, Redact) separate dev tree from store bundle.
- **WXT/Vite + `@crxjs/vite-plugin`** — Crab-Agent, Superfill, Redact use modern MV3 bundling; worth adopting if Aegis outgrows manual `build-dist.sh`.
- **“Verify in DevTools” privacy marketing** — SafePrompt `connect-src 'none'`, PrivacyScrubber Network tab = 0 requests, Redact “no telemetry SDK” — copy for SIH judges.

---

## What NOT to copy

| Anti-pattern | Seen in | Why avoid for Aegis |
|--------------|---------|---------------------|
| **Raw full-tab screenshots to cloud VLM** | Claude in Chrome, Crab-Agent, Superfill CDP agent, dassi | Core differentiator is sanitize-first; sending raw frames voids SIH privacy scoring |
| **Runtime model download from CDN/HF on critical path** | coprepaste (R2), Aegis current NER gate (~89 MB HF+jsdelivr), transformers.js default | Fail-closed gate + no venue Wi‑Fi = dead demo; vendor models in package |
| **Cloud OCR of ID/screen for “privacy”** | Some form fillers imply server parsing | Contradicts FR-05; ID must stay extract-and-discard local per `docs/new features.md` |
| **Service worker inference** | Early transformers.js samples | SW suspend ~30s; no DOM; ORT threaded WASM CSP failures |
| **Blob URL workers without sandbox iframe** | transformers.js PR #462 notes | MV3 CSP blocks ORT multithreading unless sandboxed — prefer `numThreads=1` + WebGPU path later |
| **DOM-only agents without vision** | Sentinel, early Stagehand DOM mode | Misses canvas/video/custom UI; Aegis needs Local Eye — but **prefer DOM+a11y assist** to reduce VLM tokens |
| **Over-broad permissions upfront** | `<all_urls>`, `debugger`, broad `scripting` without justification | Claude uses `debugger` for control — high trust bar; Aegis should document minimal set (`activeTab`, `offscreen`, `storage`) |
| **Silent telemetry / opaque privacy** | Many Chrome Web Store “AI agents” | Judges will ask; open receipt + harness beats marketing copy |
| **Prompt injection surface** | All screenshot agents (Claude safety guide) | Sanitized image still carries layout hints; warn users on untrusted sites; optional strict mode |

---

## MV3 build checklist (distilled from real projects)

### Manifest & permissions

- [ ] `manifest_version: 3`, `background.service_worker` (module type if using `import`)
- [ ] `"permissions": ["offscreen", "storage", "activeTab", "scripting", "tabs"]` — trim to minimum
- [ ] `"host_permissions"` only where needed (`<all_urls>` if capture on arbitrary forms)
- [ ] CSP: `"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"` (required for ORT WASM)
- [ ] `web_accessible_resources` for all `.wasm`, `.onnx`, worker entrypoints served to offscreen/worker contexts

### Service worker lifecycle

- [ ] Persist task state in `chrome.storage.session` / `local` — SW is ephemeral
- [ ] `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })` (Chrome 116+) before `createDocument`
- [ ] Guard concurrent `createDocument` with a promise lock (mevir `creatingOffscreen` pattern)
- [ ] Re-inject content scripts after SW restart / tab navigation (`reinjectContentScriptsBestEffort`)

### Offscreen document

- [ ] Single offscreen URL; reasons match use (`WORKERS`, `DOM_PARSER`, `BLOB`)
- [ ] Message protocol with `target: 'offscreen'` discriminator
- [ ] Keep offscreen warm during agent loop; close when idle to save RAM (trade latency)
- [ ] Canvas mask render in offscreen, return `data:` URL or `ImageBitmap` to SW

### Capture & act

- [ ] `chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: N })` from user gesture or active task
- [ ] Content script: `elementFromPoint`, native input setter for React/Vue, `closest('button,a,input')` fallback
- [ ] Scale click coords by `devicePixelRatio` when VLM returns physical pixels
- [ ] `MutationObserver` for dynamic forms (FR-02)

### On-device ML

- [ ] Inference in **module Web Worker** inside offscreen (not SW)
- [ ] `env.allowLocalModels = true`, `env.useBrowserCache = true`, models under `src/vendor/` or `public/models/`
- [ ] `env.backends.onnx.wasm.numThreads = 1` unless sandbox iframe multithreading proven
- [ ] Quantize: BlazeFace small, NER INT8; budget **≤50 MB** extension for SIH resource criterion
- [ ] Letterbox/resize preserving aspect ratio for face detect (avoid squash-to-128×128 miss)

### VLM & privacy boundary

- [ ] Hard gate: no `fetch(vlmEndpoint)` until `facePassComplete && nerPassComplete`
- [ ] Payload: `sanitizedImage` + redacted `pageStructure` — omit raw URL/title if policy requires
- [ ] Classify HTTP/JSON errors; never send raw screenshot on retry
- [ ] Session API key in memory only (`STORAGE_CONTRACT.md`)

### Build & store

- [ ] Production bundle excludes `node_modules`, dev tools, eval harness
- [ ] Verify all manifest paths resolve from `dist/` (19/19 style check)
- [ ] Chrome Web Store disclosure: “on-device redaction; sanitized images sent to user-configured VLM endpoint”
- [ ] Document offline/airplane-mode path for judges

### Testing

- [ ] Harness: privacy payload, face-before-VLM, execute-action HiDPI, sanitize-action
- [ ] Manual E2E on eval pages (TP08) with before/after screenshots
- [ ] Cold vs warm latency table for pitch

---

## Implications for Aegis’s four problems

### Problem 1 — Local Eye (capture + on-device vision)

- **Copy** Superfill/CDP annotated screenshots conceptually, but implement via `captureVisibleTab` + DOM scan (no `debugger` permission). Use shield-vision / Maska lessons: BlazeFace on **letterboxed** full viewport, not naive 128×128 squash.
- **Copy** TandaHQ pattern for password fields: DOM rects are cheap and high-precision — vision is supplement, not sole source.
- **Avoid** Crab-Agent’s raw screenshot-to-LLM default; Local Eye output must stay local until Privacy Shield completes.
- **Risk:** MediaPipe/WebGPU paths (Maska) are faster but second stack; stick ONNX+ORT for one runtime until demo stable.

### Problem 2 — Privacy Shield (redact before transmit)

- **Copy** Clearform Redact packaging (bundled INT8, worker inference, zero network) and Blankit’s fail-closed mindset. PrivacyScrubber’s typed tokens `[NAME_1]` are a good optional export format for audit logs.
- **Copy** multi-layer merge: regex (<1 ms) → NER → DOM password black-fill → face blur (Aegis FR-02–05 already aligned).
- **Avoid** coprepaste remote 800 MB model bootstrap — P0 blocker for SIH venue Wi‑Fi.
- **Avoid** text-only scrubbers as “complete” privacy story — faces in photos and canvas UI need vision layer.

### Problem 3 — Brain Connection (sanitized VLM)

- **Copy** Stagehand/Sentinel insight: structured DOM + selective screenshot beats full-frame every step for tokens/latency — Aegis already sends `pageStructure`; keep field labels redacted.
- **Copy** Crab-Agent multi-provider + Ollama local endpoint story for judges who fear cloud.
- **Avoid** form-fill-only system prompts (Aegis 4.3 regression) — Brain must handle summarize/navigate tasks.
- **Avoid** echoing fixed example coordinates in prompts; include `imageSize` bounds checking in `sanitizeAction()`.

### Problem 4 — The Hand (execute actions)

- **Copy** Crab-Agent / Gecko tool surface: click, type, scroll, keys, with visible step log in side panel.
- **Copy** FormPilot/Superfill native setter tricks for SPA form fields.
- **Copy** HiDPI fix permanently in harness + manual Retina checklist (browser-use agents often miss this).
- **Avoid** blind coordinate-only clicks when DOM selector available — hybrid click (coords + `closest` interactive ancestor) is more reliable than pure computer-use on forms.

---

## Sources consulted

- Chrome Web Store & product pages: Claude, dassi, FillApp, PrivacyScrubber  
- GitHub: Crab-Agent, Clearform Redact, Blankit, coprepaste, Superfill.ai, Gecko Agent, Maska, TandaHQ/sensitive-blur-screenshot, nico-martin/gemma4-browser-extension, browser-use, Stagehand  
- Hugging Face: [Transformers.js in Chrome Extension](https://huggingface.co/blog/transformersjs-chrome-extension)  
- DEV: [Offscreen doc for Transformers.js](https://dev.to/sathiyasenpai/why-i-moved-my-transformersjs-pipeline-out-of-the-chrome-mv3-service-worker-and-into-an-offscreen-1kk4)  
- Chrome docs: [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)  
- Internal: `docs/02_ARCHITECTURE.md`, `docs/Aegis_Deep_Structured_Analysis.md` §4, `engineers/Lead/work_done.md` (four-problem definition)
