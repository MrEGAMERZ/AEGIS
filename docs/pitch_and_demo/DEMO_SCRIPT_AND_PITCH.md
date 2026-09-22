# AEGIS: Core Innovation & Video Demo Script

## Part 1: The Narrative Pivot (Restructuring the Core Innovation)

**Stop saying:** *"We built SARA, an LLM."* 
Judges know building a multimodal LLM from scratch costs millions and requires GPU clusters. If you say you built the LLM, they will assume you are either lying or just using an API wrapper, which completely destroys your credibility.

**Start saying:** *"We built a Zero-Trust AI Orchestration Engine natively in the browser."*

Your core innovation is **not** the AI model itself. Your innovation is the **impenetrable engineering sandbox** you built *around* the AI model. Off-the-shelf VLMs (like Qwen or GPT-4o) are amazing, but they are structurally dangerous because they require a raw picture of your screen. 

The hard engineering feat—the thing that is *really difficult* for anyone to replicate—is successfully running a multi-layered machine learning stack (WASM) *inside a browser extension* to intercept, redact, and orchestrate complex agent loops in real-time without breaking the DOM or leaking data.

### The 3 Pillars of Your "Technical Moat" (Why it's hard to build):
1. **In-Browser Edge ML (WASM + ONNX):** We didn't use a cloud API for privacy. We compiled DistilBERT (for text) and BlazeFace (for vision) to WebAssembly. Running ML locally inside a Chrome Offscreen Document without freezing the browser is serious, heavy-duty engineering.
2. **Cryptographic-Style Provenance Engine:** AI agents hallucinate. If an agent invents a fake SSN, it's a disaster. We engineered a "Fail-Closed" pipeline. When the VLM generates a JSON action to type data, our extension mathematically cross-references that exact string against the user's local vault. If the VLM invented the data, our engine physically blocks the DOM execution.
3. **The 15-Step Self-Correcting Vision Loop:** Standard agents fire and forget. We engineered an autonomous loop. The agent parses the screen, executes a DOM click, waits, takes a *new* screenshot, and verifies its own work. If it writes code that fails to compile, it actually "sees" the red error text on the screen and rewrites the code.

---

## Part 2: The Hackathon Submission Video Demo

**Target Length:** 2.5 to 3 minutes.
**Tone:** Fast-paced, technical, but focused on the real-world impact.
**Setup:** Have the local gateway running (`node index.js`), Ollama running, and Chrome loaded with the `tp08-kitchen-sink-registration.html` test page.

### 0:00 - 0:30 | The Hook & The Problem
* **Visual:** Speaker looking at the camera, then cut to a standard AI agent recording a screen full of personal data.
* **Script:** *"To use modern AI browser agents, we are forced into a dangerous trade: we must let them record our entire screen. Unmasked passwords, Aadhaar numbers, and faces are scooped up and beamed to the cloud. We refused to accept that. So we built AEGIS: a zero-trust AI orchestration engine running entirely in your browser."*

### 0:30 - 1:00 | Feature 1: The "Redact-Before-Transmit" Edge Pipeline
* **Visual:** Open the `tp08` registration test page. It has a dummy face image, a password field, and an SSN field. Click "Privacy Scan". Watch the screen instantly paint black boxes over the face and sensitive fields.
* **Script:** *"Our core innovation is the Redact-Before-Transmit pipeline. Instead of relying on the cloud, we engineered an Edge ML worker inside the Chrome extension. Using WebAssembly, we run BlazeFace and DistilBERT locally. In milliseconds, it detects and paints solid black boxes over faces and PII. By the time the screenshot reaches the reasoning VLM, the sensitive data simply doesn't exist."*

### 1:00 - 1:30 | Feature 2: The Local Brain & Privacy Wall
* **Visual:** Open the AEGIS extension popup. Show the GDPR Privacy Consent Wall. Click Accept. Drag and drop a dummy PDF (like a resume) into the vault.
* **Script:** *"But how does the AI fill out forms if we hide the data? We built an on-device Memory Vault. Guarded by a strict consent wall, users drop documents locally. AEGIS parses PDFs entirely offline. It acts as a local brain—giving the AI context without ever exposing the raw documents to the internet."*

### 1:30 - 2:15 | Feature 3: Strict Provenance & Autonomous Loop
* **Visual:** Type "Fill out my registration form and write a quick sorting algorithm in the compiler below" into the agent chat. Watch the agent autonomously fill the form, then type code into the text editor.
* **Script:** *"This is where our Fail-Closed execution engine takes over. When the VLM decides what to type, AEGIS intercepts the payload. It strictly cross-references the data against the local vault. If the AI hallucinates or invents a fake SSN, the engine blocks the action instantly. Furthermore, we built a 15-step autonomous loop. It doesn't just inject code blindly—it takes new screenshots, reads the screen for compiler errors, and fixes its own mistakes visually."*

### 2:15 - 2:30 | The Closer (Enterprise Readiness)
* **Visual:** Show the AEGIS logo, GitHub repo, or architecture diagram.
* **Script:** *"Building this required bridging complex Chrome Extension APIs, WebAssembly ML, and localized LLM gateways. AEGIS isn't just a hackathon wrapper; it is an enterprise-ready architecture that proves we don't have to sacrifice privacy at the altar of AI convenience. The screen leaves last, and it leaves clean."*
