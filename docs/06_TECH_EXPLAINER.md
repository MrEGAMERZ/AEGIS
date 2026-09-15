# 🧠 Plain-Language Tech Explainer — AEGIS

> Read this before touching any code. Every library we use is here, explained simply.

---

## The Big Picture First

Our project does one thing:

> **Before your screen data goes to an AI server, a small AI running inside your browser looks at the screen, blacks out your passwords and faces, and only then sends the cleaned version to the server.**

To do that, we need:
1. Something to **capture your screen** inside the browser
2. Something to **run AI models** inside the browser (without internet)
3. An **AI model** that detects faces
4. An **AI model** that detects PII text (names, phone numbers, etc.)
5. Something to **draw black boxes / blur** over the sensitive parts
6. A **server** that receives the cleaned image and tells the browser what to do next

Each library below serves exactly one of these needs.

---

## 1. Chrome Extension (Manifest V3)

### What is it?
A Chrome Extension is a small program that runs **inside your Chrome browser** and can see and interact with web pages. You've used extensions before — ad blockers, dark mode tools, Grammarly. That's what this is.

### What does it do in our project?
It's the container for our entire system. Without it, we can't:
- Capture your screen
- Inject code into a web page
- Show a popup UI
- Run AI models inside the browser

### Key parts of our extension:
| Part | Simple Name | What it does |
|---|---|---|
| `manifest.json` | The ID card | Tells Chrome: what this extension is, what permissions it needs |
| `background.js` | The manager | Runs silently in the background, orchestrates everything |
| `content.js` | The spy | Gets injected into every webpage you visit, reads the DOM |
| `offscreen.js` | The lab | A hidden page where we do AI inference and image editing |
| `popup.html` | The control panel | What you see when you click the extension icon |

### How to verify it works:
1. Open Chrome → go to `chrome://extensions`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked" → select the `SIH26` folder
4. You should see the extension appear in the list without errors

---

## 2. ONNX Runtime Web

### What is it?
**ONNX** (Open Neural Network Exchange) is a standard file format for AI models — like `.mp3` is a format for music, `.onnx` is a format for AI models. Any AI model can be converted to `.onnx` format.

**ONNX Runtime** is a program that can *run* these `.onnx` model files.

**ONNX Runtime Web** is the same thing, but specifically built to run **inside a browser** (using WebAssembly or WebGPU — more on those below).

### What does it do in our project?
We use it to run our face detection model (BlazeFace) directly inside the browser, with no internet connection needed. The model file lives in the extension. ONNX Runtime Web loads it and runs it on every screenshot we take.

### Analogy:
ONNX Runtime Web is like VLC Media Player. VLC can play `.mp4`, `.avi`, `.mkv` files. ONNX Runtime Web can "play" (run) `.onnx` model files. It doesn't care what model is inside — it just runs it.

### How to verify it works:
We'll add a simple test that loads the runtime and prints its version to the console. If you see a version number in the DevTools console, it works.

```javascript
import * as ort from 'onnxruntime-web';
console.log(ort.env.versions); // should print version info
```

---

## 3. WebAssembly (WASM)

### What is it?
Normally, browsers can only run **JavaScript**. WebAssembly (WASM) is a second language that browsers can run — and it runs **much faster** than JavaScript for heavy computation like AI inference.

It's not something you write yourself. It's a compilation target — you write code in C++, Rust, etc., and it gets compiled *into* WASM, which the browser can then run at near-native speed.

### What does it do in our project?
ONNX Runtime Web uses WASM to run AI models fast inside the browser. When we load BlazeFace ONNX, ONNX Runtime Web internally uses WASM to do the math.

### Analogy:
JavaScript is like a manual transmission car — fine for normal driving. WASM is like a racing gearbox — same car, but the engine performs better for high-intensity tasks.

### Why does this matter?
Running an AI model involves millions of floating point math operations. JavaScript is too slow for this. WASM makes it feasible.

### How to verify it works:
If ONNX Runtime Web loads and runs without errors, WASM is working. You don't interact with WASM directly.

---

## 4. WebGPU

### What is it?
WebGPU is a new browser API (like a set of tools) that lets JavaScript talk directly to your computer's **GPU (graphics card)**. GPUs are thousands of times faster than CPUs for the kind of math AI models do.

### What does it do in our project?
If the user's browser supports WebGPU, ONNX Runtime Web can use the GPU instead of WASM — making our AI inference 3–8× faster. If WebGPU isn't available (older browser, certain OS), we fall back to WASM.

### Analogy:
WASM is like doing multiplication on paper. WebGPU is like using a calculator. Same answer, much faster.

### Current reality check:
WebGPU works in Chrome 113+ on most modern desktops. It does NOT work in Firefox yet (as of 2026). We always build WASM first, WebGPU second — because WASM is universal and WebGPU is a bonus.

### How to verify it works:
```javascript
const adapter = await navigator.gpu?.requestAdapter();
console.log(adapter ? 'WebGPU available' : 'WebGPU not available');
```
Run this in Chrome DevTools console on any page.

---

## 5. BlazeFace ONNX

### What is it?
BlazeFace is a **face detection AI model** originally made by Google for MediaPipe. It's specifically designed to be tiny and fast — the model file is only ~400KB (for comparison, a typical AI model is hundreds of MB).

The `.onnx` version is BlazeFace converted into ONNX format so ONNX Runtime Web can run it in the browser.

### What does it do in our project?
It takes a screenshot, finds all the faces in it, and returns bounding boxes — rectangles with coordinates telling us exactly where each face is on screen. We then blur those rectangles.

### How it works (simplified):
1. We resize the screenshot to 128×128 pixels (small, because BlazeFace is built for that size)
2. BlazeFace looks at the 128×128 image and outputs: "face found at coordinates [x1, y1, x2, y2] with 94% confidence"
3. We scale those coordinates back up to the original screenshot size
4. We blur that region on the canvas

### What it can't do (important limitation):
BlazeFace's short-range model only reliably detects faces that take up at least 20% of the image. Small faces in the corner of a video call thumbnail may be missed. We need to document this limitation honestly.

### The ONNX file we use:
`https://huggingface.co/garavv/blazeface-onnx` — a public model on Hugging Face

### How to verify it works:
We'll build a simple test page (not an extension) that:
1. Loads an image of a face
2. Runs BlazeFace on it
3. Draws a red box around the detected face
If you see the box, it works.

---

## 6. Transformers.js

### What is it?
**Transformers** is a Python library made by Hugging Face — it lets you use thousands of pre-trained AI models. You've probably heard of BERT, GPT, etc. Those are "transformer" models.

**Transformers.js** is the same thing, but for JavaScript/browser environments. It lets you run the same Hugging Face models directly in the browser — no Python, no server needed.

### What does it do in our project?
We use it to run a **Named Entity Recognition (NER)** model. NER is an AI that reads text and labels each word — "John" is a PERSON, "Mumbai" is a LOCATION, "Aadhaar" followed by numbers is an ID. We then blur/mask those labeled regions on screen.

### Analogy:
Transformers.js is like having a tiny version of ChatGPT running inside your browser. Not as smart as the full version, but fast, private, and free.

### How it loads models:
Transformers.js automatically downloads model files from Hugging Face the first time you use them, and caches them in the browser. After the first load (~30 seconds for a 66MB model), it loads instantly from cache.

### The model we use:
`Xenova/distilbert-base-uncased-finetuned-conll03-english` — a 66MB NER model that detects PERSON, LOCATION, ORGANIZATION entities in text.

### How to verify it works:
```javascript
import { pipeline } from '@huggingface/transformers';
const ner = await pipeline('token-classification', 'Xenova/distilbert-base-uncased-finetuned-conll03-english');
const result = await ner('My name is Rehan and I live in Delhi');
console.log(result);
// Should output: [{word: "Rehan", entity: "B-PER"}, {word: "Delhi", entity: "B-LOC"}, ...]
```

---

## 7. Ollama

### What is it?
Ollama is a program you install on your computer that lets you run large AI language models (like LLaMA, Qwen, Mistral) **locally**, on your own machine, without needing internet or paying for an API.

You run it like a local server: `ollama serve`. Then you can talk to it via HTTP at `http://localhost:11434`.

### What does it do in our project?
It's running your Qwen 3 8B model locally. When our browser extension has finished sanitizing the screenshot, it sends the sanitized image to Ollama, and Ollama's model tells the extension what action to take next (e.g., "click the login button at position 350, 210").

### Your current setup (from `opencode.json`):
- Ollama is running at `http://localhost:11434/v1`
- Model loaded: `qwen3:8b`

### The problem (important):
`qwen3:8b` is a **text-only** model. It cannot process images. To receive and understand our sanitized screenshot, you need a **Vision-Language Model (VLM)** — a model that accepts both text AND images.

### How to check what models you have:
```bash
ollama list
```
If you see something like `llava`, `qwen2-vl`, `qwen3-vl`, `moondream`, or `bakllava` — you have a vision model. If you only see `qwen3:8b` — you need to pull one.

```bash
ollama pull llava        # 4.7GB — good default
# OR
ollama pull moondream    # 1.8GB — lighter, less capable
```

### How to verify Ollama is running:
```bash
curl http://localhost:11434/api/tags
```
If you get a JSON list of models, Ollama is running.

---

## 8. Qwen-VL / LLaVA (the Vision-Language Model)

### What is it?
A Vision-Language Model (VLM) is an AI that can **look at an image AND read text** together and respond intelligently. It's like GPT-4 Vision — it understands both.

**Qwen-VL** (from Alibaba) and **LLaVA** (open source) are both VLMs. They can receive a screenshot and a question like "what should I click to submit this form?" and return coordinates.

### What does it do in our project?
After our browser extension sanitizes the screenshot (faces blurred, passwords blacked out), it sends:
- The sanitized image
- A description of the page structure (what fields exist, what's masked)
- The user's task ("fill in the email field with my address")

The VLM looks at all of this and returns a JSON action like:
```json
{"action": "click", "x": 350, "y": 210}
```
Our extension then executes that action on the real webpage.

### Why we need a VLM and not just a regular LLM:
A regular LLM (text-only) cannot understand a screenshot. It would need us to describe the entire page in text, which defeats the purpose. A VLM can see the sanitized image and reason about the visual layout.

---

## 9. Canvas API

### What is it?
The Canvas API is a built-in browser feature (no library needed) that lets you draw and edit images in JavaScript. It works like a digital painting program — you can draw shapes, apply filters, copy/paste regions of images.

### What does it do in our project?
After we get the bounding boxes from BlazeFace (where are the faces?) and from DOM scan (where are the password fields?), we use the Canvas API to:
1. Draw the original screenshot onto a canvas
2. Apply `filter: blur(12px)` over the face regions
3. Draw solid black rectangles over password fields
4. Export the result as a new image (`canvas.toDataURL()`)

This happens entirely in the browser. The original screenshot never leaves the device.

### Analogy:
The Canvas API is like Photoshop, but inside the browser, controlled by code.

### How to verify it works:
The Canvas API is built into every modern browser. No installation needed. If the browser runs JavaScript, Canvas works.

---

## 10. Web Workers

### What is it?
Normally, JavaScript in a browser runs on a single thread — meaning one thing at a time. If you run a slow operation (like AI inference), it **freezes the entire browser tab** until it finishes.

A Web Worker is a separate background thread. You can run heavy code there without freezing the UI.

### What does it do in our project?
We run BlazeFace and NER inference inside a Web Worker. This means:
- The browser extension UI stays responsive
- The user doesn't see a frozen screen while AI inference runs
- ONNX Runtime Web runs in the worker thread

### Analogy:
Think of your browser tab as a restaurant kitchen with one chef (single thread). If the chef is cutting 100 vegetables (AI inference), no other orders can be made. A Web Worker is a second chef — the main chef stays free to take orders while the second one does the heavy prep.

---

## The Full Stack, All Together

```
YOU CLICK THE EXTENSION ICON
         │
         ▼
POPUP (popup.html)          ← you type your task here
         │
         ▼
BACKGROUND (background.js)  ← the manager
    │
    ├──► captures screenshot with Chrome API
    │
    ├──► asks content.js: "scan the DOM for password fields"
    │         content.js reads the webpage DOM
    │         returns: [{field: password, position: x,y,w,h}]
    │
    ├──► sends screenshot to offscreen.js
    │         offscreen.js has the Canvas
    │         offscreen.js sends image to Web Worker
    │                   Web Worker runs ONNX Runtime Web
    │                   loads BlazeFace ONNX → detects faces
    │                   loads DistilBERT NER via Transformers.js → detects PII text
    │                   returns: [{face at x,y}, {name "Rehan" at x,y}]
    │         offscreen.js draws on Canvas:
    │                   blurs face regions
    │                   blacks out password field regions
    │                   blurs PII text regions
    │         returns: sanitized image (base64)
    │
    ├──► sends sanitized image + page structure to Ollama (localhost:11434)
    │         Ollama runs qwen2-vl or llava
    │         VLM looks at sanitized image
    │         VLM returns: {"action": "click", "x": 350, "y": 210}
    │
    └──► tells content.js: "click at 350, 210"
              content.js clicks that point on the real webpage
              ✅ DONE — form submitted without password ever leaving device
```

---

## Quick Reference: What to install/verify right now

| Tool | Where | How to verify |
|---|---|---|
| Ollama | Your machine | `curl http://localhost:11434/api/tags` |
| Vision model | Inside Ollama | `ollama list` → look for llava/qwen2-vl |
| Chrome | Browser | Already have it |
| Extension loaded | `chrome://extensions` | Load unpacked → AEGIS folder |
| ONNX Runtime Web | Loaded by code | Will verify once inference.worker.js is built |
| Transformers.js | Loaded by code | Will verify once NER pipeline is built |

