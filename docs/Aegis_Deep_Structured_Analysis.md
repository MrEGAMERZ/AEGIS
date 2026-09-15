# 🎯 AEGIS — Deep Structured Analysis
### On-device Visual Perception for Light-weight Browser Agents
**Organization:** Indian Space Research Organisation (ISRO) | **Department:** Department of Space | **Category:** Software | **Theme:** Miscellaneous

---

## 1. 🔎 Pain Points & Core Understanding

**Exact problem:** Today's AI browser agents (Anthropic Computer Use, OpenAI Operator/Atlas, Google Project Mariner) need to "see" the screen to act on it — but the dominant architecture sends **full screenshots to a cloud server** for interpretation, meaning everything on your screen (passwords, faces in video calls, personal data in forms) is transmitted, regardless of sensitivity. The PS asks you to build the missing privacy layer: a local, in-browser vision model that reads the screen, redacts anything sensitive *before* it ever leaves the device, and only sends the cloud LLM/VLM a sanitized version.

**Why does this problem exist (root causes):**
- 🖥️ Full agentic reasoning (planning, complex decision-making) needs a large model — genuinely too heavy to run entirely on a user's laptop today, so cloud dependency is somewhat unavoidable for the "smart" part.
- 📸 The simplest engineering path for screen-understanding is "just screenshot everything and send it" — which is exactly what current leading agents do; privacy-by-design was not the starting architecture.
- ⚙️ Client-side inference tooling (WebGPU, ONNX Runtime Web, Transformers.js) has only recently matured enough to make meaningful on-device vision models practical in a browser — this is a genuinely new capability window, not something that was easily buildable a couple years ago.

**Primary stakeholders:**
| Stakeholder | Stake |
|---|---|
| 👤 Everyday browser-agent users | Want agent convenience without exposing screen contents wholesale to a third party |
| 🏢 Enterprises adopting agentic browsers | Compliance/data-governance concerns block adoption of cloud-screenshot-based agents for sensitive workflows |
| 🇮🇳 ISRO / Indian government context | Sovereignty/data-residency motivation — reducing what leaves the device aligns with broader data-sovereignty priorities |

**Current challenges/inefficiencies:**
- 🔓 Real, documented reviewer concern: one 2026 review of a leading browser agent explicitly called the experience **"privacy-concerning"**, noting uncertainty about how much of a user's digital life gets exposed through full-screen agent access.
- 🛡️ Security researchers have also demonstrated that agentic browsers are vulnerable to **prompt injection via malicious pages** — a related but distinct risk from data exposure, worth being aware of even though it's not this PS's primary ask.
- ⚖️ No major shipping product currently does real-time, on-device, pre-transmission redaction — this is a genuine, unsolved architecture gap, not a solved problem you're re-implementing.

---

## 2. ⚙️ Feasibility of Execution

**Can a prototype be built in hackathon time? ✅ Yes — the required client-side tooling is mature and well-documented; scope discipline is the main risk, not missing technology.**

**Technical requirements:**

| Layer | Tooling |
|---|---|
| Local vision inference | 🧩 **Transformers.js** (Hugging Face) — browser-native, mirrors the Python `transformers` API, supports vision/object-detection/segmentation tasks out of the box |
| Execution backend | ⚡ **ONNX Runtime Web** — runs via WebAssembly (universal compatibility) or **WebGPU** (5–10x faster where supported); always ship a WASM fallback since WebGPU support still varies by browser/OS/GPU |
| Model choice | 🪶 A lightweight, quantized ViT or object-detection model (quantized models are the practical default for in-browser use — full-precision models are too heavy) |
| Redaction mechanism | 🎭 Local bounding-box detection + blur/black-out rendering, or DOM-tag-based field masking for form inputs (e.g., detecting `type="password"` fields programmatically, independent of visual detection) |
| Server-side | ☁️ Any open-source/open-weight VLM (the PS explicitly allows cloud-hosted versions of open models during the hackathon) receiving only sanitized input |

**Blockers to plan around:**
- ⚠️ **WebGPU support is inconsistent** across browsers/OS/GPU combinations — budget real testing time, and always have the WASM fallback path working first, optimizing to WebGPU second.
- ⚠️ **Latency vs. accuracy trade-off is explicit in the brief** (and directly weighted in evaluation) — a slow-but-accurate model or a fast-but-leaky model both fail on evaluation criteria; this needs deliberate tuning, not a "pick one" decision.
- ⚠️ Getting genuinely reliable PII/sensitive-element detection (not just faces/passwords, but general PII in arbitrary web content) is a real, nontrivial CV/NLP problem — don't underestimate this as "just run an object detector."

**Realistic, evaluator-impressing MVP:**
A working Chrome extension that: runs a quantized vision model locally (via Transformers.js + ONNX Runtime Web, WebGPU where available), demonstrably blurs faces and blacks out password fields and at least one other PII category live on a real webpage, sends only the sanitized screen representation to a cloud VLM, and receives back an executable action (e.g., "click submit") that the extension then performs — end-to-end, on one clearly defined task (e.g., filling a form without ever transmitting the entered PII).

---

## 3. 🌍 Impact & Relevance

**Who benefits:**
- 👤 Any user of AI browser agents who wants automation without full-screen data exposure to a third-party server.
- 🏢 Enterprises/regulated industries (banking, healthcare, government) currently unable to adopt cloud-screenshot-based agents due to compliance constraints.
- 🇮🇳 Broader Indian data-sovereignty priorities — reducing what must leave a device aligns with the same thinking behind DPDP-era compliance work.

**Real-world impact:**
- 🔐 **Privacy/trust:** Directly addresses a documented, real concern — reviewers of today's leading browser agents already flag privacy discomfort as the main hesitation to adoption.
- 🏢 **Economic/enterprise:** Could unlock agentic browser adoption in regulated sectors currently blocked by data-exposure concerns — a genuine enabling technology, not just a nice-to-have feature.
- 🌐 **Scalable beyond hackathon:** This is architecture/infrastructure, not a one-off app — the redaction-before-transmission pattern is reusable across any agentic browser product, and could plausibly become a foundational privacy layer that other agent builders adopt or license.

**Why evaluators (ISRO, no less) would find this important:** ISRO's involvement signals interest in genuinely novel systems engineering, not application-layer work — this PS sits at the frontier of client-side ML and privacy-by-design architecture, exactly the kind of "build something that doesn't exist yet" problem that stands out from typical GenAI-wrapper submissions.

---

## 4. 💡 Scope of Innovation (Existing Solutions)

### 🏆 Competitor / Existing Solution Landscape

| Player | Approach | Privacy Model |
|---|---|---|
| **Anthropic Computer Use / Claude in Chrome** | Screenshot-based VLM perception, sent to cloud | 🚫 Full screen sent to server; a 2026 review explicitly called this "privacy-concerning" |
| **OpenAI Operator / ChatGPT Atlas** | Similar screenshot/DOM-based cloud perception | 🚫 Same full-exposure model |
| **Google Project Mariner** | Cloud-based screen understanding (83.5% WebVoyager benchmark) | 🚫 Same category — no on-device redaction layer |
| **Browser Use, MultiOn, Stagehand** (open-source/commercial agent frameworks) | DOM-parsing or screenshot-based automation | 🚫 None implement local pre-transmission sanitization as a core feature |
| **"Local-first" agentic browsers (Genspark, Sigma, Firefox AI Mode)** | Reduce telemetry generally | 🟡 Closer in spirit, but not the same as active, dynamic PII redaction of visual screen content before any cloud call |
| **AnonymizedGPT (open-source experiment, 2024)** | Fine-tuned BERT NER model running client-side (WASM) to filter private info before sending to ChatGPT | ✅ Closest prior art — but text-only (NER-based), not visual/screen-based, and an incomplete/interrupted experiment, not a shipped product |

### 🕳️ The Whitespace
**No major shipping product — Anthropic, OpenAI, or Google — currently does real-time, on-device visual redaction before sending screen content to a cloud agent.** The closest prior art (AnonymizedGPT) is text-only and unfinished. This PS is asking you to build something genuinely ahead of what any current commercial agent does — a rare, real whitespace, not an already-solved problem dressed up as novel.

### 🚀 What to Add / Stand Out Technically
- 🎯 **Multi-modal redaction** — combine visual detection (faces, on-screen sensitive imagery) with DOM-aware detection (password fields, form input types) for more reliable coverage than vision alone.
- ⚡ **WebGPU-accelerated local inference** with a clean WASM fallback — technically demonstrates real engineering rigor around the browser ML stack, not just calling an API.
- 📊 **Explicit latency/accuracy trade-off tuning**, visibly presented (e.g., a benchmark showing your model's speed/accuracy at different quantization levels) — directly answers the PS's own stated evaluation criteria.
- 🔐 **A clear redaction taxonomy** (faces, passwords, PII text, other sensitive UI elements) rather than a single generic "blur everything" approach.

---

## 5. 🧩 Clarity of Problem Statement

**What's explicitly being asked for (per the official brief — and note the given evaluation weights):**
1. Client-side vision model running in-browser (Chrome/Firefox extension) — **25% of score is "accuracy of visual context from screen"**
2. Privacy-preserving filter — local redaction of sensitive elements — **20% for PII detection recall/precision + 20% for redaction precision**
3. Server-side integration with an open-source/open-weight LLM/VLM, returning actionable commands
4. An end-to-end demonstrated task
5. **20% of score is client-side resource utilization**, **15% is end-to-end latency**

**Where teams misinterpret this:**
- ❌ Building a good vision model but weak redaction — the brief and scoring **weight redaction (PII detection + redaction precision = 40% combined) as heavily as raw visual accuracy (25%)** — many teams will over-invest in visual accuracy and under-invest in redaction quality.
- ❌ Ignoring **resource utilization** (20% of score!) — a model that's accurate but consumes excessive client-side memory/CPU fails on an explicitly graded criterion.
- ❌ Building a server-side-heavy solution that does minimal real local processing — the entire point is genuine client-side inference, not a thin extension that mostly proxies to the server.
- ❌ Treating "redaction" as just blurring faces — the brief explicitly also wants passwords, PII, and other sensitive elements, a broader scope than face-blurring alone.

**How to frame your solution:** Structure your pitch and demo **exactly around the five stated evaluation criteria**, showing a number or clear evidence for each (visual accuracy, PII recall/precision, redaction precision, resource usage, latency) — this demonstrates direct, deliberate alignment rather than a generic "look what we built" demo.

---

## 6. 🎯 Evaluator's Perspective

**Likely judging lens (this PS unusually provides explicit weights — use them):**
- 🎯 Visual accuracy (25%) — does the local model correctly understand screen state?
- 🔍 PII detection recall/precision (20%) — does it *find* sensitive elements reliably?
- 🎭 Redaction precision (20%) — does it redact *correctly* (not over- or under-redacting)?
- ⚙️ Client-side resource utilization (20%) — is it actually lightweight, as the PS title demands?
- ⏱️ End-to-end latency (15%) — is the full loop fast enough to be usable?

**🚩 Red flags evaluators will look for:**
- A demo that's clearly running a heavy model that would never work on a real constrained client device.
- Redaction that's hard-coded/rule-based for the demo scenario only, not generalizing to new sensitive-element types.
- No real measurement/benchmarking shown for any of the five graded criteria — vague claims instead of numbers.
- A "local" model that's actually doing most of its work server-side, undermining the entire premise of the PS.

---

## 7. 👥 Strategy for Team Fit & Execution

**Skills needed:**
- 🧠 Client-side ML — comfort with Transformers.js, ONNX Runtime Web, model quantization/optimization
- 🖥️ Browser extension development (Chrome/Firefox extension APIs, DOM manipulation)
- 🔐 CV/detection — object detection for faces and sensitive visual elements
- ☁️ Backend/API — server-side VLM integration
- 📊 Benchmarking discipline — since scoring is explicitly metric-based, someone needs to own measuring and reporting all five criteria

**Ideal team ratio:** Skews toward client-side/systems engineering strength — this is less "train a great model" and more "make a good-enough model run fast and light in a browser," which is a genuinely different skill emphasis than typical GenAI hackathon builds.

**Step-by-step approach before building:**
1. 📖 Read the five evaluation criteria closely and design your architecture around **all five from day one**, not just accuracy.
2. 🧪 Pick and test a small, ONNX-compatible, quantized vision model early — validate it actually runs acceptably via Transformers.js/ONNX Runtime Web before committing further.
3. 🎭 Build the redaction taxonomy first (what counts as sensitive: faces, passwords, PII text, what else) — this scopes your detection requirements clearly.
4. ⚡ Get the WASM fallback working before optimizing for WebGPU — ensures a working baseline regardless of browser/hardware.
5. 📊 Instrument your pipeline to measure latency and resource usage from the start, not as an afterthought — you need real numbers for the demo.
6. 🔗 Wire up server-side VLM integration last, once local perception+redaction is solid.

---

## 8. 🤖 AI-Buildability Split (20/80)

**The 20% AI can build fast:**
- Boilerplate Chrome extension scaffold
- Wiring a pretrained Transformers.js vision/object-detection pipeline
- A first-draft blur/redaction rendering function
- Basic server-side API wrapper around an open-weight VLM

**The 80% requiring real judgment:**
- ⚖️ **The latency/accuracy trade-off the brief explicitly calls out** — choosing model size, quantization level, and WebGPU vs. WASM strategy is a genuine engineering judgment call with real consequences on your score, not something AI picks correctly by default.
- 🎭 **Redaction taxonomy and precision tuning** — deciding what counts as "sensitive," avoiding both under-redaction (privacy leak) and over-redaction (breaks the agent's ability to understand the screen) is a careful design problem.
- ⚙️ **Actual client-side resource optimization** — making a model genuinely lightweight (not just claiming it is) requires real profiling and tuning work.
- 🔐 **DOM-based sanitization logic** (e.g., detecting password fields programmatically) — needs real understanding of browser APIs and security-relevant HTML attributes, not generic boilerplate.

**Risk of leaning only on AI output:** A team that wires together a Transformers.js pipeline without understanding quantization/latency trade-offs will likely produce something that's either too slow (fails the 15% latency criterion) or too resource-heavy (fails the 20% resource criterion) — and won't be able to explain *why* under questioning, which is exactly the kind of gap a technically sharp judge (this is ISRO) will probe.

**🎯 One structural change a judge could ask for on the spot:**
> "Show me this working on a completely different website you haven't tested against — does your redaction still catch the sensitive fields?"

Could your team make this live? **Only if your redaction logic generalizes** (e.g., genuinely detecting `type="password"` fields and visually distinct PII patterns) rather than being tuned/hard-coded to your specific demo page. This is a very likely on-the-spot test given how concretely "generalization" maps to the PS's own stated precision/recall criteria.

---

## 9. 📊 Data & Resource Availability

| Resource | Status | Access |
|---|---|---|
| Transformers.js | ✅ Public, actively maintained (Hugging Face) | `@huggingface/transformers` npm package |
| ONNX Runtime Web | ✅ Public, well-documented | Microsoft-maintained, WASM/WebGPU/WebNN/WebGL backends |
| Pretrained vision/object-detection models | ✅ Many pre-converted, ONNX-compatible models tagged on Hugging Face Hub | Ready to use, no training required |
| PII/face detection datasets (for evaluation/testing) | 🟡 Open-source datasets exist (general face-detection datasets, synthetic form-data test pages) | You'll likely need to construct your own test webpages with known PII placements for reliable precision/recall measurement |
| Task datasets for evaluation | 🟡 Explicitly stated in the brief: **"Use cases for evaluation will be provided during finale"** | You don't know the exact final test scenarios — build for generalization, not a narrow hard-coded case |

**What happens if the ideal setup isn't achievable?**
- If WebGPU proves unreliable across your test devices/browsers, **lead with the WASM path as your primary demo** — it's slower but works everywhere, which is safer than a flashy but fragile WebGPU-only demo.

**Realistic backup plan:**
- Build a small set of your own test webpages (a fake login form, a fake profile page with a photo, a fake payment form) with deliberately placed PII, faces, and password fields — this gives you controllable, known-ground-truth data to measure your own precision/recall honestly, which matters given the brief's explicit "use cases provided at finale" — you need to demonstrate generalization on data you built yourself, not just polish for a single known scenario.

---

## 10. 🎤 Judge Q&A Stress-Test

### ❓ Q1: "Show me your model's actual latency and memory usage numbers — not an estimate, real measured data."
**Weakest point — this is directly and heavily weighted in the brief (20% resource, 15% latency) and easy to fake vaguely.**
✅ **Strong answer:** "On [your test device], our quantized model runs at [X]ms average latency via WebGPU, [Y]ms via WASM fallback, using [Z]MB peak memory — measured using [your instrumentation method], averaged over [N] test screens."
🔁 **Follow-up:** "How does that change on a lower-end device?" — have at least a rough answer, since "lightweight" implies broad device compatibility.

### ❓ Q2: "Your redaction worked well on your demo page — what happens on a page you haven't tested, with a different layout?"
✅ **Strong answer:** "We tested generalization against [N] webpages we built ourselves with varied layouts and PII placement — our recall was [X]% and precision [Y]% across that set, not just our primary demo page." (Run this test before the event, know the real number.)
🔁 **Follow-up:** "What's a failure case you found?" — have an honest one ready; admitting a known limitation is more credible than claiming perfection.

### ❓ Q3: "The problem statement says redaction should be 'dynamic' — what does that actually mean in your implementation, versus a static rule set?"
✅ **Strong answer:** "Our detection re-runs on screen-state changes (not just page load), so newly appearing sensitive elements — like a password field that appears after a 'login' click — are still caught, rather than only redacting what was present at initial page load."
🔁 **Follow-up:** "Show me that happening live." — be ready to demo dynamic content specifically, not just a static page.

### ❓ Q4: "How does the server know how to interpret your sanitized/redacted context correctly, given it never sees the real data?"
✅ **Strong answer:** "We designed our sanitization scheme so the server receives structural information — e.g., 'a text input field exists here, currently masked' — rather than blank space, so the VLM can still reason about layout and intent (like 'this is a login form') without ever seeing the actual sensitive content."
🔁 **Follow-up:** "What happens if the task genuinely requires reading redacted content to complete correctly?" — be honest about this real trade-off; a thoughtful answer (e.g., some tasks are explicitly out of scope, or require local-only completion) is stronger than pretending there's no trade-off.

### ❓ Q5: "This whole system still trusts the server not to log or misuse the sanitized data it does receive — how is that fundamentally different from just trusting the server with everything?"
✅ **Strong answer:** "It's not perfect trust elimination — it's meaningfully reduced exposure. Even sanitized structural data is far less sensitive than raw screenshots containing passwords, faces, and PII text. We're minimizing the blast radius of a server-side breach or misuse, not claiming zero server trust is required."
🔁 **Follow-up:** "Is there a scenario where even your sanitized data could be sensitive?" — engage honestly; e.g., page structure/URL metadata could still leak some information, and acknowledging that shows real technical maturity rather than overclaiming privacy guarantees.

---

## 🏁 Final Verdict

# 🟢 GREEN LIGHT

**Biggest reason:** This is a genuine engineering whitespace — no major shipping browser agent (Anthropic, OpenAI, Google) currently does real-time, on-device visual redaction before cloud transmission, and the closest prior art (AnonymizedGPT) is an incomplete, text-only experiment. The tooling to build this is mature and well-documented (Transformers.js, ONNX Runtime Web, WebGPU), the evaluation criteria are unusually explicit (giving you a clear scoring target to build directly against), and the underlying privacy concern is real and already publicly acknowledged by reviewers of today's leading agents. The main risk isn't "does this exist already" or "is this buildable" — it's execution discipline across all five weighted criteria simultaneously, especially the resource/latency constraints many teams will under-prioritize in favor of chasing raw accuracy.

---

## 7. FUTURE SCOPE & COMPETITIVE DIFFERENTIATION (For Pitch Deck)

While the MVP focuses strictly on the core privacy redaction pipeline (BlazeFace + DistilBERT), the long-term vision for AEGIS includes several advanced capabilities designed specifically for the ISRO/SIH context. These should be highlighted in the pitch to demonstrate foresight regarding compliance and user experience.

### 7.1 Progressive "Lazy" Profile Setup (RAG)
Instead of forcing users to fill out a master profile upfront, AEGIS will build a user profile incrementally. When encountering an unknown form field, it asks once, saves the answer locally, and uses Retrieval-Augmented Generation (RAG) to generate plausible answers for future forms. This gives the agent "smart memory" without relying on cloud synchronization.

### 7.2 "Extract-and-Discard" Document Parsing
To accelerate profile setup safely, users will be able to upload Government IDs (PAN, Driving Licence, Aadhaar) or resumes. 
- **The Compliance Rule:** AEGIS will run OCR locally in the browser to extract safe, non-identifying fields (Name, DOB).
- It will **immediately discard** the sensitive ID number and document photo.
- This strict "extract-and-discard" architecture directly respects regulations like the Aadhaar Act, 2016, proving to judges that the system is designed for real-world legal compliance, not just a technical proof-of-concept.

### 7.3 Specific Use Case Targeting
The ultimate vehicle for this technology is a "Privacy-Preserving Form-Fill Agent" tailored for high-friction scenarios: college admissions, government service portals, and banking KYC, where users are most hesitant to use server-side AI agents due to the sensitivity of the required data.
