// Offscreen Document — Runs inference and mask rendering (has Canvas/DOM access)
// Face redaction is a hard gate: SANITIZE throws if BlazeFace is unavailable
// while face detection is enabled, so background.js never calls the VLM with
// an unredacted live frame.

import { extractDocumentText, detectFormat } from "./document-extract.js";

const canvas = document.getElementById("mask-canvas");
const ctx = canvas.getContext("2d");

// ── Inference Worker Setup ────────────────────────────────────────
// Module worker: inference.worker.js is spawned with { type: "module" }.

let inferenceWorker = null;

// pendingRequests maps an expected response message type to its
// { resolve, reject } pair. Only one pending request per type at a time
// because the pipeline is sequential (faces, then NER).
const pendingRequests = {};

const WORKER_ERROR_TO_PENDING = {
  INIT: "INIT_DONE",
  DETECT_FACES: "FACES_DETECTED",
  DETECT_NER: "NER_DETECTED",
};

function rejectAllPending(err) {
  for (const key of Object.keys(pendingRequests)) {
    const pending = pendingRequests[key];
    if (pending && typeof pending.reject === "function") {
      pending.reject(err);
    }
  }
}

function forwardProgress(data) {
  chrome.runtime.sendMessage({
    type: "INIT_PROGRESS",
    status: data.status || "Loading on-device models…",
    backend: data.backend,
  }).catch(() => {});
}

function handleWorkerMessage(e) {
  const { type, ...data } = e.data;

  if (type === "INIT_PROGRESS") {
    console.log("[Aegis Offscreen]", data.status || "INIT_PROGRESS");
    forwardProgress(data);
    return;
  }

  if (type === "ERROR") {
    const pendingType = WORKER_ERROR_TO_PENDING[data.originalType];
    if (pendingType && pendingRequests[pendingType]) {
      pendingRequests[pendingType].reject(new Error(data.error || "Worker error"));
    }
    return;
  }

  if (type === "INIT_DONE") {
    console.log("[Aegis Offscreen] Worker ready, backend:", data.backend,
      "faceModelReady:", data.faceModelReady, "nerModelReady:", data.nerModelReady);
    chrome.runtime.sendMessage({
      type: "INIT_DONE",
      backend: data.backend,
      faceModelReady: data.faceModelReady,
      faceModelError: data.faceModelError,
      nerModelReady: data.nerModelReady,
      nerModelError: data.nerModelError,
    }).catch(() => {});
    if (pendingRequests["INIT_DONE"]) {
      pendingRequests["INIT_DONE"].resolve(data);
    }
    return;
  }

  if (pendingRequests[type]) {
    pendingRequests[type].resolve(data);
  }
}

function describeWorkerError(e) {
  const message = (e && e.message) || (e && e.error && e.error.message) || "";
  const filename = (e && e.filename) || "";
  const lineno = (e && e.lineno) || 0;
  if (message || filename) {
    return `Inference worker failed to load: ${message || "script error"} (${filename || "inference.worker.js"}:${lineno || "?"})`;
  }
  return (
    "Inference worker failed to load (module link/eval error with no message). " +
    "Open chrome://extensions → this extension → Errors. A dedicated module " +
    "Worker has no chrome.* API — vendor paths must use import.meta.url, not " +
    "chrome.runtime.getURL. Then reload the extension and this tab."
  );
}

function getWorker() {
  if (!inferenceWorker) {
    const workerUrl = chrome.runtime.getURL("src/inference/inference.worker.js");
    // type: 'module' is required because inference.worker.js uses ES module
    // import statements for ORT (Transformers.js is imported lazily).
    inferenceWorker = new Worker(workerUrl, { type: "module" });
    inferenceWorker.onmessage = handleWorkerMessage;
    inferenceWorker.onerror = (e) => {
      const err = new Error(describeWorkerError(e));
      console.error("[Aegis Offscreen] Worker error:", err.message, e);
      rejectAllPending(err);
      try { inferenceWorker.terminate(); } catch { /* already dead */ }
      inferenceWorker = null;
    };
    inferenceWorker.onmessageerror = () => {
      const err = new Error("Inference worker message deserialize failed");
      rejectAllPending(err);
    };
  }
  return inferenceWorker;
}

// workerRequest sends a typed message to the worker and returns a Promise
// that resolves when the corresponding response message type arrives.
// responseType: the message type the worker will post back.
// timeoutMs: reject if no response arrives within this window.
function workerRequest(type, payload = {}, responseType, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequests[responseType]) {
        delete pendingRequests[responseType];
        reject(new Error(
          type === "INIT"
            ? `Worker request "INIT" timed out after ${timeoutMs}ms. BlazeFace WASM did not finish compiling. Reload the extension at chrome://extensions, then click Run Agent again (first load can take up to a minute).`
            : `Worker request "${type}" timed out after ${timeoutMs}ms`
        ));
      }
    }, timeoutMs);

    pendingRequests[responseType] = {
      resolve: (value) => {
        clearTimeout(timer);
        delete pendingRequests[responseType];
        resolve(value);
      },
      reject: (err) => {
        clearTimeout(timer);
        delete pendingRequests[responseType];
        reject(err);
      },
    };
    getWorker().postMessage({ type, payload });
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
    // Cold WASM compile of ort-wasm-simd-threaded.wasm (~13MB) can exceed 20s
    // on first Load-unpacked. Progress is posted as INIT_PROGRESS.
    workerInitPromise = workerRequest("INIT", {}, "INIT_DONE", 120000).catch((err) => {
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

  if (msg.type === "WARM_WORKER") {
    ensureWorkerReady()
      .then((data) =>
        sendResponse({
          ok: true,
          faceModelReady: data.faceModelReady === true,
          nerModelReady: data.nerModelReady === true,
          backend: data.backend,
        })
      )
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "EXTRACT_DOCUMENT_TEXT") {
    // On-device document → text. The heavy parsers (pdf.js / pako) are
    // imported lazily inside extractDocumentText — never here.
    extractDocumentText(msg.file)
      .then((result) => sendResponse({ text: result.text, format: result.format }))
      .catch((err) =>
        sendResponse({
          text: "",
          format: msg.file ? detectFormat(msg.file.name, msg.file.mimeType) || "text" : "text",
          error: err.message,
        })
      );
    return true;
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

async function handleSanitize({ screenshot, domScanResults, faceDetection, piiDetection }) {
  // Ensure the inference worker is ready before running any inference.
  // This is a no-op after the first SANITIZE call.
  const init = await ensureWorkerReady();
  const faceDetectionEnabled = faceDetection !== false;
  const piiDetectionEnabled = piiDetection !== false;

  // 1. Load screenshot into canvas
  const img = await loadImage(screenshot);
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  // DPR reported by the content script's window.devicePixelRatio.
  // Defaults to 1 so DPR=1 displays are unaffected.
  const dpr = (domScanResults && domScanResults.dpr) || 1;

  const maskedRegions = [];

  function maskRect(rect, type, padRatio = 0) {
    if (!rect) return;
    const scaled = scaleToDPR(rect, dpr);
    const painted = applyBlackMask(ctx, scaled.x, scaled.y, scaled.width, scaled.height, padRatio);
    if (!painted) return;
    maskedRegions.push({
      type,
      bbox: [painted.x, painted.y, painted.x + painted.w, painted.y + painted.h],
    });
  }

  // 2. Mask sensitive DOM fields (solid black fill)
  if (domScanResults && domScanResults.fields) {
    for (const field of domScanResults.fields) {
      const MASK_TYPES = ["password_input", "sensitive_input", "contenteditable_pii"];
      if (MASK_TYPES.includes(field.type)) {
        maskRect(field.rect, field.type);
      }
    }
  }

  // Filled name/email/phone boxes are not password fields, but the value is
  // still PII. Black the control; do not send the value string anywhere.
  if (domScanResults && Array.isArray(domScanResults.fillableFields)) {
    for (const field of domScanResults.fillableFields) {
      if (field && field.hasValue) maskRect(field.rect, "filled_input");
    }
  }

  if (domScanResults && Array.isArray(domScanResults.photos)) {
    for (const photo of domScanResults.photos) {
      maskRect(photo.rect, "photo");
    }
  }

  // 3. Face detection — HARD GATE. When enabled (default), BlazeFace MUST
  // run and paint a black box before this function returns a sanitized image.
  // Fail closed if the model is missing or inference throws: never hand a
  // live frame to background.js for a VLM call.
  let facePassComplete = false;
  if (faceDetectionEnabled) {
    if (!init || init.faceModelReady !== true) {
      const detail = init && init.faceModelError ? ` (${init.faceModelError})` : "";
      throw new Error(
        "FACE_MODEL_UNAVAILABLE: BlazeFace did not load; refusing to send unredacted frames to the VLM" + detail
      );
    }
    const faceDetections = await detectFaces(screenshot);
    for (const face of faceDetections) {
      const [x1, y1, x2, y2] = face.bbox;
      const painted = applyBlackMask(ctx, x1, y1, x2 - x1, y2 - y1, 0.45);
      if (painted) {
        maskedRegions.push({
          type: "face",
          bbox: [painted.x, painted.y, painted.x + painted.w, painted.y + painted.h],
          confidence: face.confidence,
        });
      }
    }
    facePassComplete = true;
  } else {
    // User explicitly disabled face detection in the popup.
    facePassComplete = true;
  }

  // 4. PII text detection — HARD GATE for names/places/orgs (NER) plus
  // regex structured PII. When enabled (default), DistilBERT MUST run
  // before this function returns a sanitized image. Fail closed if the
  // model is missing or inference throws.
  let nerPassComplete = false;
  let nerEntities = [];
  const piiDetections = [];
  if (piiDetectionEnabled) {
    const detected = await detectTextPII((domScanResults && domScanResults.visibleText) || []);
    for (const pii of detected) {
      piiDetections.push(pii);
      if (pii.bbox) {
        const scaled = scaleToDPR(pii.bbox, dpr);
        const painted = applyBlackMask(ctx, scaled.x, scaled.y, scaled.width, scaled.height);
        if (painted) {
          maskedRegions.push({
            type: "pii",
            entity: pii.entity_type,
            bbox: [painted.x, painted.y, painted.x + painted.w, painted.y + painted.h],
            confidence: pii.confidence,
          });
        }
      }
      if (pii.source === "ner") {
        nerEntities.push({
          text: pii.text,
          entity_type: pii.entity_type,
        });
      }
    }
    nerPassComplete = true;
  } else {
    nerPassComplete = true;
  }

  // 5. Export sanitized image — only after face + NER passes have completed
  const sanitizedImage = canvas.toDataURL("image/png");
  const previewImage = canvasToPreviewDataUrl(canvas);

  return {
    sanitizedImage,
    previewImage,
    maskedRegions,
    dpr,
    facePassComplete,
    faceDetectionEnabled,
    faceModelReady: !!(init && init.faceModelReady),
    nerPassComplete,
    piiDetectionEnabled,
    nerEntities,
  };
}

// ── Helpers ───────────────────────────────────────────────────────

const PREVIEW_MAX_WIDTH = 720;

function canvasToPreviewDataUrl(sourceCanvas) {
  try {
    let out = sourceCanvas;
    if (sourceCanvas.width > PREVIEW_MAX_WIDTH) {
      const scale = PREVIEW_MAX_WIDTH / sourceCanvas.width;
      const tmp = document.createElement("canvas");
      tmp.width = PREVIEW_MAX_WIDTH;
      tmp.height = Math.max(1, Math.round(sourceCanvas.height * scale));
      tmp.getContext("2d").drawImage(sourceCanvas, 0, 0, tmp.width, tmp.height);
      out = tmp;
    }
    return out.toDataURL("image/jpeg", 0.72);
  } catch {
    return sourceCanvas.toDataURL("image/png");
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function applyBlackMask(ctx, x, y, w, h, padRatio = 0) {
  if (w <= 0 || h <= 0) return null;
  if (padRatio > 0) {
    const px = w * padRatio;
    const py = h * padRatio;
    x -= px;
    y -= py;
    w += 2 * px;
    h += 2 * py;
  }
  x = Math.round(x);
  y = Math.round(y);
  w = Math.round(w);
  h = Math.round(h);
  const cx = Math.max(0, x);
  const cy = Math.max(0, y);
  const cw = Math.min(w, ctx.canvas.width - cx);
  const ch = Math.min(h, ctx.canvas.height - cy);
  if (cw <= 0 || ch <= 0) return null;
  ctx.fillStyle = "#000000";
  ctx.fillRect(cx, cy, cw, ch);
  return { x: cx, y: cy, w: cw, h: ch };
}

// ── Face Detection — worker bridge ────────────────────────────────
// Sends ImageData + the original capture data URL to the inference worker.
// Returns Array<{ bbox: [x1,y1,x2,y2], confidence: number }>.
// Throws on error (model missing, worker ERROR, timeout) — fail closed.

async function detectFaces(screenshotDataUrl) {
  // Send BOTH the original capture data URL (worker fallback) AND ImageData
  // (what this document already decoded). Worker accepts either. Do NOT
  // swallow errors — a failed face pass must fail the SANITIZE request so
  // background.js never calls the VLM with a raw live frame.
  const img = await loadImage(screenshotDataUrl);
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = img.width;
  tmpCanvas.height = img.height;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.drawImage(img, 0, 0);
  const imageData = tmpCtx.getImageData(0, 0, img.width, img.height);

  const result = await workerRequest(
    "DETECT_FACES",
    { imageData, imageDataUrl: screenshotDataUrl },
    "FACES_DETECTED"
  );
  if (result.error) {
    throw new Error(result.error);
  }
  return result.faces || [];
}

// ── Text PII Detection — regex layer + worker NER bridge ──────────
// Stage A (regex): deterministic, synchronous. SSN/email/phone/Aadhaar/PAN.
// Stage B (NER): DistilBERT PER/ORG/LOC on live visible text. Fail closed —
// a missing model or worker ERROR must fail SANITIZE so background.js never
// calls the VLM with unredacted names/places/orgs.

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

  // First-load NER can take ~11s (HF download). Do not inherit the 10s default.
  const result = await workerRequest(
    "DETECT_NER",
    { texts: visibleTexts },
    "NER_DETECTED",
    60000
  );
  if (result.error) {
    throw new Error(result.error);
  }
  const nerEntities = result.entities || [];
  for (const entity of nerEntities) {
    detections.push({ ...entity, source: "ner" });
  }

  return detections;
}

console.log("[Aegis] Offscreen document loaded");
