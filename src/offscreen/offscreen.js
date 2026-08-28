// Offscreen Document — Runs inference and mask rendering (has Canvas/DOM access)
// Phase: Task 1.2 — inference.worker.js is now wired via postMessage bridge.
// Models are still stubbed in the worker; face/NER results will be empty
// until Task 1.3 loads BlazeFace and DistilBERT NER.

const canvas = document.getElementById("mask-canvas");
const ctx = canvas.getContext("2d");

// ── Inference Worker Setup ────────────────────────────────────────
// The worker is a classic (non-module) Web Worker.
// offscreen.js is loaded as type="module" (see offscreen.html), but the
// Worker itself is spawned with default options (classic) because
// inference.worker.js does not use ES module import syntax yet.

let inferenceWorker = null;

// pendingRequests maps an expected response message type to its
// { resolve, reject } pair. Only one pending request per type at a time
// because the pipeline is sequential (faces, then NER).
const pendingRequests = {};

function handleWorkerMessage(e) {
  const { type, ...data } = e.data;

  if (type === "INIT_DONE") {
    console.log("[Aegis Offscreen] Worker ready, backend:", data.backend);
    if (pendingRequests["INIT_DONE"]) {
      pendingRequests["INIT_DONE"].resolve(data);
      delete pendingRequests["INIT_DONE"];
    }
    return;
  }

  if (pendingRequests[type]) {
    pendingRequests[type].resolve(data);
    delete pendingRequests[type];
  }
}

function getWorker() {
  if (!inferenceWorker) {
    const workerUrl = chrome.runtime.getURL("src/inference/inference.worker.js");
    // type: 'module' is required because inference.worker.js uses ES module
    // import statements for ORT and Transformers.js v4 (which is ESM-only).
    inferenceWorker = new Worker(workerUrl, { type: 'module' });
    inferenceWorker.onmessage = handleWorkerMessage;
    inferenceWorker.onerror = (e) =>
      console.error("[SIH26171 Offscreen] Worker error:", e.message, e);
  }
  return inferenceWorker;
}

// workerRequest sends a typed message to the worker and returns a Promise
// that resolves when the corresponding response message type arrives.
// responseType: the message type the worker will post back.
// timeoutMs: reject if no response arrives within this window.
function workerRequest(type, payload = {}, responseType, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    pendingRequests[responseType] = { resolve, reject };
    getWorker().postMessage({ type, payload });

    const timer = setTimeout(() => {
      if (pendingRequests[responseType]) {
        delete pendingRequests[responseType];
        reject(new Error(`Worker request "${type}" timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    // Wrap resolve so we can clear the timer on success.
    const originalResolve = pendingRequests[responseType].resolve;
    pendingRequests[responseType].resolve = (value) => {
      clearTimeout(timer);
      originalResolve(value);
    };
  });
}

// Ensure the worker is spawned and INIT_DONE received before the first
// SANITIZE call processes any inference requests.
// Returns a Promise that resolves once the worker reports its backend.
//
// Order of operations (no race):
//   1. workerRequest registers pendingRequests['INIT_DONE'] resolver.
//   2. workerRequest calls getWorker().postMessage({type:'INIT'}).
//   3. getWorker() spawns the Worker, sets onmessage, then posts INIT.
//   4. Worker processes INIT, posts INIT_DONE.
//   5. handleWorkerMessage fires, resolver is found, Promise resolves.
let workerInitPromise = null;
function ensureWorkerReady() {
  if (!workerInitPromise) {
    workerInitPromise = workerRequest("INIT", {}, "INIT_DONE", 10000).catch((err) => {
      // If INIT times out, reset so the next SANITIZE call retries.
      workerInitPromise = null;
      throw err;
    });
  }
  return workerInitPromise;
}

// ── Message Listener ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SANITIZE") {
    handleSanitize(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // async
  }
});

// ── DPR Scaling Helper ────────────────────────────────────────────
//
// chrome.tabs.captureVisibleTab() returns an image at PHYSICAL pixel
// resolution: width = viewportCSSwidth × DPR.
// getBoundingClientRect() returns CSS pixels.
// Every coord drawn on the canvas must be multiplied by DPR before use.

function scaleToDPR(rect, dpr) {
  return {
    x: rect.x * dpr,
    y: rect.y * dpr,
    width: rect.width * dpr,
    height: rect.height * dpr,
  };
}

// ── Sanitize Pipeline ─────────────────────────────────────────────

async function handleSanitize({ screenshot, domScanResults }) {
  // Ensure the inference worker is ready before running any inference.
  // This is a no-op after the first SANITIZE call.
  await ensureWorkerReady();

  // 1. Load screenshot into canvas
  const img = await loadImage(screenshot);
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  // DPR reported by the content script's window.devicePixelRatio.
  // Defaults to 1 so DPR=1 displays are unaffected.
  const dpr = domScanResults.dpr || 1;

  const maskedRegions = [];

  // 2. Mask sensitive DOM fields (solid black fill)
  if (domScanResults.fields) {
    for (const field of domScanResults.fields) {
      const MASK_TYPES = ["password_input", "sensitive_input", "contenteditable_pii"];
      if (MASK_TYPES.includes(field.type)) {
        // Scale CSS pixel rect → physical image pixel rect
        const { x, y, width, height } = scaleToDPR(field.rect, dpr);
        ctx.fillStyle = "black";
        ctx.fillRect(x, y, width, height);
        maskedRegions.push({ type: field.type, bbox: [x, y, x + width, y + height] });
      }
    }
  }

  // 3. Face detection via inference worker (returns [] until Task 1.3)
  // BlazeFace outputs are already in image-pixel space, no DPR scaling needed.
  const faceDetections = await detectFaces(screenshot);
  for (const face of faceDetections) {
    const [x1, y1, x2, y2] = face.bbox;
    applyPixelation(ctx, x1, y1, x2 - x1, y2 - y1);
    maskedRegions.push({ type: "face", bbox: [x1, y1, x2, y2], confidence: face.confidence });
  }

  // 4. PII text detection via inference worker (regex active; NER returns [] until Task 1.3)
  // visibleText rects are CSS pixels — must scale to image pixels.
  const piiDetections = await detectTextPII(domScanResults.visibleText || []);
  for (const pii of piiDetections) {
    if (pii.bbox) {
      const { x, y, width, height } = scaleToDPR(pii.bbox, dpr);
      applyPixelation(ctx, x, y, width, height);
      maskedRegions.push({
        type: "pii",
        entity: pii.entity_type,
        bbox: [x, y, x + width, y + height],
        confidence: pii.confidence,
      });
    }
  }

  // 5. Export sanitized image
  const sanitizedImage = canvas.toDataURL("image/png");

  return { sanitizedImage, maskedRegions, dpr };
}

// ── Helpers ───────────────────────────────────────────────────────

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function applyPixelation(ctx, x, y, w, h, blockSize = 12) {
  if (w <= 0 || h <= 0) return;

  // Read the pixels in the region once, then write back as solid-color blocks.
  // This avoids the self-copy issue with ctx.filter = "blur" and works reliably
  // across all browsers without edge artifacts.
  x = Math.round(x); y = Math.round(y);
  w = Math.round(w); h = Math.round(h);

  // Clamp to canvas bounds
  const cx = Math.max(0, x), cy = Math.max(0, y);
  const cw = Math.min(w, ctx.canvas.width - cx);
  const ch = Math.min(h, ctx.canvas.height - cy);
  if (cw <= 0 || ch <= 0) return;

  const imageData = ctx.getImageData(cx, cy, cw, ch);
  const data = imageData.data;

  for (let by = 0; by < ch; by += blockSize) {
    for (let bx = 0; bx < cw; bx += blockSize) {
      // Average color of this block
      let r = 0, g = 0, b = 0, count = 0;
      const bh = Math.min(blockSize, ch - by);
      const bw = Math.min(blockSize, cw - bx);
      for (let py = by; py < by + bh; py++) {
        for (let px = bx; px < bx + bw; px++) {
          const i = (py * cw + px) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2];
          count++;
        }
      }
      r = Math.round(r / count);
      g = Math.round(g / count);
      b = Math.round(b / count);

      // Fill block with averaged colour
      for (let py = by; py < by + bh; py++) {
        for (let px = bx; px < bx + bw; px++) {
          const i = (py * cw + px) * 4;
          data[i] = r; data[i + 1] = g; data[i + 2] = b; // alpha unchanged
        }
      }
    }
  }

  ctx.putImageData(imageData, cx, cy);
}

// ── Face Detection — worker bridge ────────────────────────────────
// Sends the screenshot's ImageData to the inference worker.
// Returns Array<{ bbox: [x1,y1,x2,y2], confidence: number }>.
// Returns [] on error (worker still initializing, model not loaded yet).

async function detectFaces(screenshotDataUrl) {
  try {
    // Render screenshot to a temporary canvas to extract ImageData.
    const img = await loadImage(screenshotDataUrl);
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = img.width;
    tmpCanvas.height = img.height;
    const tmpCtx = tmpCanvas.getContext("2d");
    tmpCtx.drawImage(img, 0, 0);
    const imageData = tmpCtx.getImageData(0, 0, img.width, img.height);

    const result = await workerRequest("DETECT_FACES", { imageData }, "FACES_DETECTED");
    return result.faces || [];
  } catch (e) {
    console.warn("[Aegis Offscreen] detectFaces failed:", e.message);
    return [];
  }
}

// ── Text PII Detection — regex layer + worker NER bridge ──────────
// Stage A (regex): deterministic, synchronous, runs here in the offscreen
//   document. Catches SSN, email, phone, Indian mobile, Aadhaar, PAN.
// Stage B (NER): sends text to worker; returns [] until Task 1.3.
// Results from both stages are merged and returned.

async function detectTextPII(visibleTexts) {
  // ── Stage A: Regex (structured PII) ──────────────────────────────
  const detections = [];

  const patterns = [
    { regex: /\b\d{3}-\d{2}-\d{4}\b/g,                                       entity: "SSN" },
    { regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,         entity: "EMAIL" },
    { regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,    entity: "PHONE" },
    { regex: /\b[6-9]\d{9}\b/g,                                               entity: "IN_MOBILE" },
    { regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g,                                   entity: "AADHAAR" },
    { regex: /\b[A-Z]{5}\d{4}[A-Z]\b/g,                                      entity: "PAN" },
  ];

  for (const item of visibleTexts) {
    if (!item.rect) continue;
    for (const { regex, entity } of patterns) {
      for (const match of item.text.matchAll(regex)) {
        detections.push({
          text: match[0],
          entity_type: entity,
          start: match.index,
          end: match.index + match[0].length,
          bbox: item.rect,
          confidence: 1.0,
          source: "regex",
        });
      }
    }
  }

  // ── Stage B: NER via worker (stub — returns [] until Task 1.3) ───
  try {
    const result = await workerRequest("DETECT_NER", { texts: visibleTexts }, "NER_DETECTED");
    const nerEntities = result.entities || [];
    for (const entity of nerEntities) {
      detections.push({ ...entity, source: "ner" });
    }
  } catch (e) {
    console.warn("[Aegis Offscreen] detectTextPII NER failed:", e.message);
    // Regex results are still returned below.
  }

  return detections;
}

console.log("[Aegis] Offscreen document loaded");
