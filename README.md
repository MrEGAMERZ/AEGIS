<p align="center">
  <img src="docs/assets/banner.svg" width="720" alt="AEGIS — the screen leaves last">
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

Named after the mythical Greek shield of protection, AEGIS is a fundamentally new type of Chrome extension. It flips the AI paradigm on its head: **The screen leaves last.** 

---

## Chapter 1: The Core Innovation

AEGIS is built on a very simple promise: What the AI doesn't need to see, it *won't* see. 

Instead of treating privacy as an afterthought, we shoved a fierce, lightweight vision stack directly *inside* Chrome itself. Before any AI model is ever consulted, AEGIS steps in. Faces are blurred using lightning-fast machine learning. Passwords and IDs are painted over with impenetrable black boxes. Names, organizations, and sensitive text are redacted instantly.

What the AI eventually receives is a completely sanitized, anonymous sketch of the layout: *"There is a password field here."* Not the password itself. Same magical auto-filling. Same helpful agent. Completely different contract of trust.

### The Features
* **Privacy Scan:** A purely local, instant snapshot that shows you *exactly* what the AI is permitted to see. No servers involved.
* **Fill Form:** A two-step powerhouse. First, it maps your locally-saved profile to form labels (no AI needed). Second, it uses a local AI to intelligently fill whatever is left, based strictly on sanitized data.
* **Run Agent:** An autonomous loop that navigates and completes tasks—armed only with the redacted layout, ensuring your secrets never leave the device.
* **The Profile Vault:** Drop a PDF locally. AEGIS extracts the text, stripping out Aadhaar, PAN, and other IDs before it even thinks about processing the rest.

---

## Chapter 2: Forging the Machine (How We Built It)

Building an AI agent inside a browser is notoriously messy. We had to rethink the architecture from the ground up to ensure absolute security while maintaining blazing speed. 

We split the labor into four highly specialized troops:

1. **The Content Script (The Ground Floor):** This script lives on the web page. It aggressively scans the Document Object Model (DOM) for obvious traps—`type="password"`, `autocomplete="cc-number"`, and explicit labels like "PAN" or "Aadhaar". It’s cheap, deterministic, and paints over secrets with solid black boxes instantly. No AI required here.
2. **The Inference Worker (The Brain in the Shadows):** We spun up a hidden offscreen document hosting a Web Worker. Here, we run [BlazeFace](https://github.com/tensorflow/tfjs-models/tree/master/blazeface) (compiled to a tiny ~400 KB ONNX file) and a DistilBERT model for Named Entity Recognition (NER) via Transformers.js. They scan for human faces and nuanced PII in the text, painting blurs onto a hidden canvas.
3. **The Orchestrator:** The Chrome service worker securely coordinates the dance between the DOM script and the Inference Worker, ensuring a "fail-closed" mechanism. If a redaction fails, the process halts. Your data never leaks.
4. **The Gateway Server:** Chrome extensions natively struggle to talk to local AI runners (like Ollama) due to CORS restrictions (a hard **403** error). We engineered a sleek Node gateway on `localhost:8000`. It sanitizes payloads, intercepts API calls, and securely shuttles only the redacted data to our chosen local model (`qwen2.5vl:7b`).

---

## Chapter 3: Breaking the Speed Limit

You might wonder: *If we are doing all this local redaction, doesn't it slow down the experience?*

Historically, extensions dealing with rich media relied on clunky plugins like Flash, or they offloaded all the heavy lifting to distant server farms, resulting in high latency and network bottlenecks. AEGIS rivals—and often beats—these legacy paradigms.

**How do we generate answers so quickly?**
* **WebAssembly (WASM):** Our heavy ML models (BlazeFace and DistilBERT) are compiled down to WebAssembly. They run at near-native speeds right in your browser memory.
* **WebGPU Acceleration:** If your browser supports it, AEGIS seamlessly taps into your local GPU hardware.
* **Zero-Network Privacy:** Because redaction happens locally, we eliminate the massive network payload of sending 4K raw screenshots over the internet. The local Ollama server only receives optimized, necessary data over localhost. 

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
- `src/popup/` — The sleek user interface.
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
