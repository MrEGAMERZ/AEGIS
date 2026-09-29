<p align="center">
  <img src="src/icons/icon128.png" alt="AEGIS Logo" width="128" height="128">
</p>

<p align="center">
  <strong>Smart India Hackathon 2026 · SIH26171 · ISRO · Chrome extension, v0.1.0</strong>
</p>

---

## Prologue: The Problem with Pixels

Picture this: You are applying for a critical national scholarship, or perhaps filling out a healthcare registration form. To save time, you ask a modern AI browser agent to help fill it out. The agent complies—it types out your name, address, and history in seconds. It feels like magic. 

But behind the curtain, a silent, unsettling transaction has just occurred. To understand the page, that agent photographed your entire browser tab. The applicant's face in the sidebar, your unmasked password, your Aadhaar number—all of it was scooped up into a massive payload and beamed to a remote server. 

Most browser agents operate on this exact premise. They demand everything, and we just blindly hand it over. 

We got tired of making that trade. So, we built **AEGIS**.

Named after the mythical Greek shield of protection, AEGIS is a fundamentally new type of Chrome extension. It flips the AI paradigm on its head: **The screen leaves last, and it leaves clean.** 

---

## Chapter 1: The Core Innovation & Novelty

Our primary innovation lies in our **"Redact-Before-Transmit" AI Pipeline**. Instead of trusting the cloud to protect your data, we shoved a fierce, lightweight machine learning stack *directly inside the browser*. 

### 1. Edge-Native ML Sanitization (WASM + ONNX)
Before any reasoning AI is consulted, AEGIS steps in locally. We run **BlazeFace** (for face detection) and **DistilBERT** (for Named Entity Recognition) completely offline via WebAssembly (WASM). Faces are blurred, passwords and IDs are painted over with impenetrable black boxes, and sensitive text is redacted instantly. The LLM only receives a sanitized, anonymous sketch of the layout. **0 bytes of unredacted PII ever leave your device.**

### 2. Anti-Hallucination Execution Engine (Strict Provenance)
LLMs hallucinate, and an AI inventing a fake Social Security Number is a critical failure. We engineered a cryptographically-inspired action validator. When the AI attempts to type data into a form, our execution engine cross-references the requested value against your explicitly approved local profile. If the AI invented the data, the engine forcefully blocks the action (**Fail-Closed Architecture**).

### 3. The On-Device Memory Vault (Local Brain)
How does the AI know what to type without leaking your context? We built a local Document Vault (RAG-lite). You can upload PDFs or text files; AEGIS parses them entirely on-device using PDF.js. Guarded by a strict **GDPR-style Privacy Consent Wall**, this data acts as a "local brain" that never touches the internet. 

### 4. Self-Correcting Vision Loop
AEGIS features a robust 15-step autonomous agent loop. It doesn't just blindly inject code or click buttons. It executes native DOM actions, waits, takes a *new* sanitized screenshot, and evaluates the outcome. If it writes code that produces a compiler syntax error, the AI sees the error on the screen, self-corrects, and loops until the task succeeds.

---

## Chapter 2: Forging the Machine (Architecture)

Building an AI agent inside a browser is notoriously messy. We had to rethink the architecture to ensure absolute security while maintaining blazing speed:

1. **The Content Script (The Ground Floor):** Aggressively scans the DOM for obvious traps (`type="password"`, `autocomplete="cc-number"`, "Aadhaar"). It paints over secrets with solid black boxes deterministically.
2. **The Inference Worker (The Edge AI):** A hidden offscreen document hosting a Web Worker. Here we run BlazeFace and DistilBERT via `Transformers.js` to catch nuances the DOM misses, painting blurs onto a hidden canvas.
3. **The Orchestrator:** The Chrome service worker coordinates the strict provenance rules and the self-correcting agent loop.
4. **The Gateway Server:** Chrome extensions struggle to talk to local AI runners (like Ollama) due to CORS restrictions. We engineered a sleek Node gateway on `localhost:8000` to securely shuttle only redacted payloads to our local model (`qwen2.5vl:7b`).

---

## Chapter 3: Breaking the Speed Limit

You might wonder: *If we are doing all this local redaction, doesn't it slow down the experience?*

* **WebAssembly (WASM):** Our heavy ML models compile down to WASM, running at near-native speeds right in your browser memory.
* **Zero-Network Privacy:** Because redaction happens locally, we eliminate the massive network payload of sending 4K raw screenshots over the internet. The local Ollama server only receives optimized, redacted data over localhost. 

The result? The speed and fluidity you expect from a state-of-the-art agent, with the security profile of a fortified vault. 

---

## Chapter 4: Running the Magic

Want to see it in action? You just need Chrome (109+) and a few minutes.

### 1. Build the Shield
We don't load the massive source repo into Chrome. We compile a lean, battle-ready build (about 81 MB, packed with the NER models).
```bash
bash scripts/build-dist.sh
```

### 2. Equip the Extension
1. Go to `chrome://extensions` in your browser.
2. Toggle **Developer mode** on.
3. Click **Load unpacked** and select the `dist/` folder.
4. *Crucial Step:* On the extension card, click Details and enable **Allow access to file URLs** so it can scan local test pages.

### 3. Ignite the Server-Side
To unlock the true power of the `Fill Form` and `Run Agent` features, wake up the local AI gateway.
```bash
# 1. Pull the model (One-time, ~4.7GB)
ollama pull qwen2.5vl:7b     
ollama serve

# 2. Start the AEGIS Gateway
cd server && node index.js   
```
Verify the connection by running: `curl -sS http://localhost:8000/health`. If `upstreamReachable` is true, you are ready. 

Navigate to our test page at [`eval/test-pages/tp08-kitchen-sink-registration.html`](eval/test-pages/tp08-kitchen-sink-registration.html) and hit **Privacy Scan**. Watch as the agent protects your data in real-time.

---

## Chapter 5: The Architect's Map

We’ve built this repository to be explored. Here is where the pieces live:
- `src/background/` — The commander. Orchestrates capture, handles model routing, and manages the secure vault.
- `src/content/` — The boots on the ground. Interacts with the DOM, lays down redaction overlays, and fills text.
- `src/offscreen/` — The hidden laboratory. Masks images via canvas and handles secure PDF extraction.
- `src/inference/` — The Web Worker running WASM-powered BlazeFace and DistilBERT.
- `src/popup/` — The sleek user interface with explicit privacy consent controls.
- `server/` — The Node gateway safely bridging Chrome to Ollama.
- `docs/` — The full library of technical specs, architecture diagrams, and testing guides.

### Deep Dives
- **[The Map of Every Doc](docs/00_INDEX.md)**
- **[Full Architecture](docs/02_ARCHITECTURE.md)**
- **[Why These Models?](docs/03_TECH_STACK_MODELS.md)**
- **[Privacy Document Upload Specs](docs/PRIVACY_DOC_UPLOAD.md)**
- **[Plain-Language Tech Explainer](docs/06_TECH_EXPLAINER.md)**

---

## Epilogue: A New Standard

Every agent on the market today asks you to surrender your screen to save a few minutes of typing. We refused to accept that as the standard. 

AEGIS proves that we don't need to sacrifice privacy at the altar of convenience. We can build intelligent, lightning-fast agents that understand the world, without compromising the individual. 

Welcome to the future of browsing. The screen leaves last.
