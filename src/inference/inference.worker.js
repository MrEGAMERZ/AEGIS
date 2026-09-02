// Inference Worker — Dedicated Web Worker for ONNX Runtime Web inference
// Runs BlazeFace ONNX (faces) and DistilBERT NER (text PII)
//
// ARCHITECTURE NOTE:
// This worker is created with { type: 'module' } from offscreen.js.
// ORT (WASM-only bundle) is imported statically so BlazeFace INIT can run
// without waiting on Transformers.js. Transformers.js is dynamic-imported
// in loadNERModel() after INIT_DONE.

// ── Imports ────────────────────────────────────────────────────────

// ORT WASM-only bundle (src/vendor/ort.min.js). Static import so BlazeFace
// INIT does not wait on Transformers.js (545KB + a second inlined ORT).
import * as ort from '../vendor/ort.min.js';

// Dedicated module Workers in Chrome MV3 do NOT have `chrome.*` (confirmed
// Chrome 152: `Uncaught ReferenceError: chrome is not defined` at the old
// chrome.runtime.getURL line, which killed the worker before onmessage).
// Resolve vendor files from this module's URL instead.
const VENDOR_DIR = new URL('../vendor/', import.meta.url);

// NER weights are vendored so the fail-closed gate never depends on a network.
// MODELS_DIR is what Transformers.js treats as `localModelPath`; it resolves
// `${localModelPath}/${NER_MODEL_ID}/…`.
const MODELS_DIR = new URL('models/', VENDOR_DIR);
const NER_MODEL_ID = 'distilbert-ner';

// The vendored file is onnxruntime-web's WASM-only ESM bundle
// (ort.wasm.bundle.min.mjs) with a Chrome-MV3 patch: `to()` always returns
// the inlined Emscripten factory and `Kr()` (blob→import) is disabled.
// Unpatched ORT can `URL.createObjectURL` + `import(blob:…)` for the
// threaded .mjs glue; MV3 extension CSP rejects that
// ("Failed to fetch dynamically imported module: blob:chrome-extension://…").
//
// Config contract before any InferenceSession.create:
//   1. numThreads = 1 (no pthread / nested module Workers)
//   2. proxy = false (no proxy Worker; also needs `document`)
//   3. wasmPaths = { wasm } only — never a directory string, never .mjs
//   4. wasmBinary prefetched (in-memory .wasm; locateFile is a no-op)
function lockOrtWasmSingleThread() {
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.proxy = false;
  // Prevent So() / callers from bumping threads if a later import resets env.
  try {
    Object.defineProperty(ort.env.wasm, 'numThreads', {
      configurable: true,
      enumerable: true,
      get: () => 1,
      set: () => { /* ignore — MV3 must stay single-thread */ },
    });
  } catch {
    ort.env.wasm.numThreads = 1;
  }
}
lockOrtWasmSingleThread();
ort.env.wasm.wasmPaths = {
  wasm: new URL('ort-wasm-simd-threaded.wasm', VENDOR_DIR).href,
};

let ortWasmBinaryPromise = null;
async function ensureOrtWasmBinary() {
  if (ort.env.wasm.wasmBinary) return;
  if (ortWasmBinaryPromise) return ortWasmBinaryPromise;
  ortWasmBinaryPromise = (async () => {
    const url = new URL('ort-wasm-simd-threaded.wasm', VENDOR_DIR).href;
    self.postMessage({ type: 'INIT_PROGRESS', status: 'Fetching ONNX Runtime WASM binary…' });
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `FACE_MODEL_UNAVAILABLE: ort-wasm-simd-threaded.wasm HTTP ${response.status} (${response.statusText}) at ${url}`
      );
    }
    ort.env.wasm.wasmBinary = await response.arrayBuffer();
    lockOrtWasmSingleThread();
    // Re-assert object-form paths after binary load (locateFile fallback).
    ort.env.wasm.wasmPaths = {
      wasm: url,
    };
  })().catch((err) => {
    ortWasmBinaryPromise = null;
    throw err;
  });
  return ortWasmBinaryPromise;
}

// Transformers.js is loaded lazily in loadNERModel() so a slow or failed
// NER module graph cannot block INIT / BlazeFace.

// ── State ──────────────────────────────────────────────────────────
let faceSession = null;
let faceModelError = null;
let nerPipeline = null;
let backend = 'wasm';

// WASM is the baseline (FR/architecture). The vendored ORT file is the
// wasm-only bundle; do not request webgpu here — a failed EP would skip
// BlazeFace even though WASM would have worked.
async function selectBackend() {
  backend = 'wasm';
}

// ── Model Loading ─────────────────────────────────────────────────

async function loadFaceModel() {
  faceModelError = null;
  try {
    // Load the 13MB WASM binary up-front so InferenceSession.create uses the
    // inlined factory + in-memory binary (no dynamic import of .mjs glue).
    await ensureOrtWasmBinary();

    const url = new URL('blaze.onnx', VENDOR_DIR).href;
    self.postMessage({ type: 'INIT_PROGRESS', status: 'Fetching BlazeFace model…' });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(
        `FACE_MODEL_UNAVAILABLE: blaze.onnx HTTP ${response.status} (${response.statusText}) at ${url}`
      );
    }
    const modelBuffer = await response.arrayBuffer();

    self.postMessage({
      type: 'INIT_PROGRESS',
      status: 'Compiling ONNX Runtime WASM (first run can take up to a minute)…',
    });
    faceSession = await ort.InferenceSession.create(modelBuffer, {
      executionProviders: ['wasm'],
    });
    console.log('[SIH26171] BlazeFace loaded, inputs:', faceSession.inputNames);
  } catch (err) {
    console.error('[SIH26171] Failed to load BlazeFace:', err);
    faceSession = null;
    const raw = String(err && err.message ? err.message : err);
    faceModelError = raw.includes('FACE_MODEL_UNAVAILABLE')
      ? raw
      : `FACE_MODEL_UNAVAILABLE: ${raw}`;
  }
}

// transformers.js v4.2.0 honors aggregation_strategy at CALL time only.
// Do not pass it to pipeline() construction — that is a documented no-op
// and previously made detectNER drop every PER/ORG/LOC (no entity_group).
let nerLoadPromise = null;

// Path-only localModelPath for Transformers.js.
// MODELS_DIR.href is http(s):// under the smoke server (and would also be a
// full URL in some hosts). Transformers.js Xb() skips the allowLocalModels
// probe for http(s) paths; with allowRemoteModels=false that reports
// tokenizer_config.json as missing, pipeline() is built with tokenizer=null,
// and DETECT_NER throws "this.tokenizer is not a function".
// Pathname (/src/vendor/models/) is probed via fetch and resolves against the
// worker origin — works for chrome-extension:// and loopback smoke.
function localModelsPathname() {
  const path = MODELS_DIR.pathname || '/src/vendor/models/';
  return path.endsWith('/') ? path : `${path}/`;
}

// Transformers.js v4 PreTrainedTokenizer extends Callable. If tokenizer is
// null (bad localModelPath) or a plain object with `_call`, wrap or fail closed.
function ensureCallableTokenizer(pipelineInstance) {
  const tok = pipelineInstance && pipelineInstance.tokenizer;
  if (!tok) {
    throw new Error(
      'NER_MODEL_UNAVAILABLE: tokenizer missing after pipeline load (check localModelPath)'
    );
  }

  const invoke = (text, options) => {
    if (typeof tok === 'function') {
      try {
        return tok(text, options);
      } catch (err) {
        if (!String(err.message || err).includes('not a function')) throw err;
      }
    }
    if (typeof tok._call === 'function') return tok._call(text, options);
    const proto = Object.getPrototypeOf(tok);
    if (proto && typeof proto._call === 'function') return proto._call.call(tok, text, options);
    throw new Error(
      `NER_MODEL_UNAVAILABLE: tokenizer not callable (type=${typeof tok}, ctor=${tok.constructor && tok.constructor.name})`
    );
  };

  const decode =
    typeof tok.decode === 'function'
      ? tok.decode.bind(tok)
      : (() => {
          const d = Object.getPrototypeOf(tok)?.decode;
          return typeof d === 'function' ? (...args) => d.call(tok, ...args) : null;
        })();

  /** @type {any} */
  const wrapper = (text, options) => invoke(text, options);
  if (decode) wrapper.decode = decode;
  if (typeof tok.batch_decode === 'function') wrapper.batch_decode = tok.batch_decode.bind(tok);
  if (typeof tok.apply_chat_template === 'function') {
    wrapper.apply_chat_template = tok.apply_chat_template.bind(tok);
  }
  if (tok.config) wrapper.config = tok.config;
  pipelineInstance.tokenizer = wrapper;
}

async function loadNERModel() {
  if (nerPipeline) return nerPipeline;
  if (nerLoadPromise) return nerLoadPromise;
  nerLoadPromise = (async () => {
    // Dynamic import: keeps INIT off the Transformers.js + inlined-ORT graph.
    const { pipeline, env: transformersEnv } = await import('../vendor/transformers.min.js');

    // ── Offline contract ──────────────────────────────────────────
    // NER is a FAIL-CLOSED gate: if it cannot run, no VLM call happens.
    // Previously this pulled ~67MB of weights from huggingface.co plus
    // ~22MB of WASM from cdn.jsdelivr.net on first run, so a venue with no
    // network meant a dead demo. Everything is now vendored, and remote
    // resolution is turned OFF so a network attempt is impossible rather
    // than merely unlikely.
    transformersEnv.allowLocalModels = true;
    transformersEnv.allowRemoteModels = false;
    transformersEnv.localModelPath = localModelsPathname();
    transformersEnv.useBrowserCache = false;
    transformersEnv.useFSCache = false;
    // Do not blob-cache the ORT .mjs factory — MV3 CSP rejects import(blob:).
    transformersEnv.useWasmCache = false;

    const wasm = transformersEnv.backends?.onnx?.wasm;
    if (wasm) {
      wasm.numThreads = 1;
      wasm.proxy = false;
      // transformers.min.js is rebuilt with onnxruntime-web/wasm (NOT webgpu/
      // asyncify). Overwrite wasmPaths before the first pipeline() so jsdelivr
      // is never contacted. { wasm } ONLY — same contract as BlazeFace above.
      wasm.wasmPaths = {
        wasm: new URL('ort-wasm-simd-threaded.wasm', VENDOR_DIR).href,
      };
      // Reuse BlazeFace's in-memory binary so NER does not re-fetch/re-compile.
      if (ort.env.wasm.wasmBinary) wasm.wasmBinary = ort.env.wasm.wasmBinary;
    }

    // Local id resolves to src/vendor/models/distilbert-ner/. dtype is stated
    // explicitly so the loader asks for onnx/model_quantized.onnx — the exact
    // file vendored — instead of picking a default we did not ship.
    nerPipeline = await pipeline('token-classification', NER_MODEL_ID, {
      device: backend === 'webgpu' ? 'webgpu' : 'wasm',
      dtype: 'q8',
    });
    ensureCallableTokenizer(nerPipeline);
    console.log('[SIH26171] DistilBERT NER loaded (local, offline).');
    return nerPipeline;
  })().catch((err) => {
    nerPipeline = null;
    nerLoadPromise = null;
    console.error('[SIH26171] Failed to load NER model:', err);
    throw err;
  });
  return nerLoadPromise;
}

// ── Face Detection (BlazeFace) ────────────────────────────────────
// Output: [{bbox:[x1,y1,x2,y2], confidence}] in original image pixel coords
//
// Live-path contract: DETECT_FACES payload MUST include `imageData`
// (offscreen canvas ImageData) and/or `imageDataUrl` (capture data URL).
// Missing model or missing frame → throw FACE_MODEL_UNAVAILABLE / contract
// error. Never silently return [] — that used to send raw faces to the VLM.
//
// VERIFIED MODEL SPEC (garavv/blazeface-onnx, vendored src/vendor/blaze.onnx):
//   - Inputs : image (float32 [1,3,128,128]), conf_threshold, max_detections,
//              iou_threshold  ← feed names confirmed against the real model.
//   - Outputs: selectedBoxes (float32 [1,N,16]) — SINGLE output. NMS, anchor
//              decoding and score thresholding are BUILT INTO the graph
//              (confirmed: dynamic N = number of detections after NMS).
//   - Preprocessing: resize to 128×128, /255.0 normalize, HWC→CHW.
//     (This is /255, NOT the classic BlazeFace /127.5-1; confirmed correct.)
//   - The 16 values per box = [ymin,xmin,ymax,xmax, 6×landmark(x,y)].
//     No confidence score is emitted; presence is gated by conf_threshold
//     inside the graph, so confidence is reported as 1.0 (= "detected").
//     It is NOT calibrated confidence — do not present it as such.
//
// Preprocessing pipeline (letterbox — preserves aspect ratio):
//   1. Draw dataUrl to OffscreenCanvas at original dims
//   2. Letterbox into 128×128 (scale-to-fit + black padding; no squash)
//   3. getImageData → Uint8ClampedArray [RGBA, RGBA, ...]
//   4. Extract R,G,B, normalize: val = pixel / 255.0
//   5. Transpose HWC→CHW: Float32Array shape [1, 3, 128, 128]
//   6. session.run({ image, conf_threshold, max_detections, iou_threshold })
//   7. Parse single output selectedBoxes [1,N,16] → bbox [ymin,xmin,ymax,xmax]
//   8. Map boxes from letterboxed 128×128 space back to original capture coords
//
// Previously the frame was squashed to 128×128, shrinking a sidebar photo on
// TP08 to ~12 px and yielding zero detections on full-viewport captures.

function letterboxTo128(sourceDrawable, origW, origH) {
  const targetW = 128;
  const targetH = 128;
  const scale = Math.min(targetW / origW, targetH / origH);
  const scaledW = origW * scale;
  const scaledH = origH * scale;
  const offsetX = (targetW - scaledW) / 2;
  const offsetY = (targetH - scaledH) / 2;

  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);
  ctx.drawImage(sourceDrawable, offsetX, offsetY, scaledW, scaledH);

  return { canvas, targetW, targetH, scale, offsetX, offsetY };
}

function mapBlazeFaceBoxToOrig(ymin, xmin, ymax, xmax, targetW, targetH, scale, offsetX, offsetY, origW, origH) {
  const x1 = Math.round((xmin * targetW - offsetX) / scale);
  const y1 = Math.round((ymin * targetH - offsetY) / scale);
  const x2 = Math.round((xmax * targetW - offsetX) / scale);
  const y2 = Math.round((ymax * targetH - offsetY) / scale);
  return [
    Math.max(0, Math.min(origW, x1)),
    Math.max(0, Math.min(origH, y1)),
    Math.max(0, Math.min(origW, x2)),
    Math.max(0, Math.min(origH, y2)),
  ];
}

function iouBox(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (inter <= 0) return 0;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  return inter / (areaA + areaB - inter + 1e-6);
}

function nmsFaces(faces, iouThresh = 0.4) {
  const sorted = faces
    .filter((f) => f.bbox[2] > f.bbox[0] + 2 && f.bbox[3] > f.bbox[1] + 2)
    .sort((a, b) => (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
      - (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]));
  const kept = [];
  for (const face of sorted) {
    if (kept.every((k) => iouBox(k.bbox, face.bbox) < iouThresh)) {
      kept.push(face);
    }
  }
  return kept;
}

async function runBlazeFaceOnDrawable(sourceDrawable, srcW, srcH, originX, originY, fullW, fullH) {
  const {
    canvas,
    targetW,
    targetH,
    scale,
    offsetX,
    offsetY,
  } = letterboxTo128(sourceDrawable, srcW, srcH);
  const imgData = canvas.getContext('2d').getImageData(0, 0, targetW, targetH);
  const data = imgData.data;

  const float32Data = new Float32Array(3 * targetW * targetH);
  for (let i = 0; i < targetW * targetH; i++) {
    float32Data[i] = data[i * 4] / 255.0;
    float32Data[targetW * targetH + i] = data[i * 4 + 1] / 255.0;
    float32Data[2 * targetW * targetH + i] = data[i * 4 + 2] / 255.0;
  }

  const feeds = {
    image: new ort.Tensor('float32', float32Data, [1, 3, targetH, targetW]),
    conf_threshold: new ort.Tensor('float32', Float32Array.from([0.5]), [1]),
    max_detections: new ort.Tensor('int64', BigInt64Array.from([BigInt(25)]), [1]),
    iou_threshold: new ort.Tensor('float32', Float32Array.from([0.3]), [1]),
  };

  const results = await faceSession.run(feeds);
  const boxesTensor = results[faceSession.outputNames[0]];
  const boxes = boxesTensor.data;
  const numFaces = boxesTensor.dims.length === 3
    ? boxesTensor.dims[1]
    : boxesTensor.dims.length === 2 ? boxesTensor.dims[0] : (boxes.length / 16);

  const faces = [];
  for (let i = 0; i < numFaces; i++) {
    const ymin = boxes[i * 16 + 0];
    const xmin = boxes[i * 16 + 1];
    const ymax = boxes[i * 16 + 2];
    const xmax = boxes[i * 16 + 3];
    const [lx1, ly1, lx2, ly2] = mapBlazeFaceBoxToOrig(
      ymin, xmin, ymax, xmax,
      targetW, targetH, scale, offsetX, offsetY, srcW, srcH
    );
    faces.push({
      bbox: [
        Math.max(0, Math.min(fullW, lx1 + originX)),
        Math.max(0, Math.min(fullH, ly1 + originY)),
        Math.max(0, Math.min(fullW, lx2 + originX)),
        Math.max(0, Math.min(fullH, ly2 + originY)),
      ],
      confidence: 1.0,
    });
  }
  return faces;
}

// Fail CLOSED: never return [] just because the model is missing — that
// previously let unredacted live frames reach the VLM. Callers must treat
// FACE_MODEL_UNAVAILABLE as a hard error and refuse the VLM call.
//
// Full-frame letterbox alone still shrinks a TP08 sidebar photo to a few
// pixels on Retina captures. Also run overlapping ~512px tiles so faces that
// occupy ≪5% of the viewport remain detectable, then NMS-merge.
async function detectFacesFromPayload(payload) {
  if (!faceSession) {
    throw new Error('FACE_MODEL_UNAVAILABLE');
  }

  let sourceDrawable;
  let origW;
  let origH;

  if (payload && payload.imageData) {
    const imageData = payload.imageData;
    origW = imageData.width;
    origH = imageData.height;
    const src = new OffscreenCanvas(origW, origH);
    src.getContext('2d').putImageData(imageData, 0, 0);
    sourceDrawable = src;
  } else if (payload && payload.imageDataUrl) {
    const response = await fetch(payload.imageDataUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch frame for face detection: ${response.status}`);
    }
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    origW = bitmap.width;
    origH = bitmap.height;
    sourceDrawable = bitmap;
  } else {
    throw new Error('DETECT_FACES requires imageData or imageDataUrl');
  }

  const all = [];
  all.push(...await runBlazeFaceOnDrawable(sourceDrawable, origW, origH, 0, 0, origW, origH));

  const tileSize = Math.min(512, origW, origH);
  if (tileSize >= 160 && (origW > tileSize * 1.2 || origH > tileSize * 1.2)) {
    const stride = Math.max(128, Math.floor(tileSize * 0.5));
    const tileCanvas = new OffscreenCanvas(tileSize, tileSize);
    const tileCtx = tileCanvas.getContext('2d');
    let tileCount = 0;
    const maxTiles = 24;
    for (let y = 0; y < origH && tileCount < maxTiles; y += stride) {
      for (let x = 0; x < origW && tileCount < maxTiles; x += stride) {
        const w = Math.min(tileSize, origW - x);
        const h = Math.min(tileSize, origH - y);
        if (w < 96 || h < 96) continue;
        tileCtx.clearRect(0, 0, tileSize, tileSize);
        tileCtx.fillStyle = '#000000';
        tileCtx.fillRect(0, 0, tileSize, tileSize);
        tileCtx.drawImage(sourceDrawable, x, y, w, h, 0, 0, w, h);
        all.push(...await runBlazeFaceOnDrawable(tileCanvas, tileSize, tileSize, x, y, origW, origH));
        tileCount += 1;
        if (x + w >= origW) break;
      }
      if (y + Math.min(tileSize, origH - y) >= origH) break;
    }
  }

  return nmsFaces(all);
}

// ── NER Detection (DistilBERT) ─────────────────────────────────────
// Input: [{text, rect}] visible text nodes
// Output: [{text, entity_type, start, end, bbox, confidence}]
//
// Known limitation: entity bbox maps to the full parent element rect,
// not the exact character-level pixel position. Over-blur is acceptable
// (safer than under-blur for privacy).

// CoNLL-03 labels after aggregation: PER / ORG / LOC.
// Raw BIO fallback: B-PER / I-ORG / etc. (if aggregation is omitted).
function nerEntityGroup(res) {
  if (!res || typeof res !== 'object') return null;
  const raw = res.entity_group || res.entity;
  if (!raw) return null;
  const s = String(raw).toUpperCase().replace(/^(B-|I-)/, '');
  if (s === 'PER' || s === 'ORG' || s === 'LOC') return s;
  return null;
}

async function detectNER(texts) {
  if (!nerPipeline) {
    await loadNERModel();
  }
  if (!nerPipeline) {
    throw new Error('NER_MODEL_UNAVAILABLE');
  }
  ensureCallableTokenizer(nerPipeline);

  const entities = [];
  const items = Array.isArray(texts) ? texts : [];

  for (const item of items) {
    if (!item.text || !item.text.trim()) continue;
    if (!item.rect) continue; // no measurable bbox → skip (matches regex path)

    // aggregation_strategy MUST be passed at call time (transformers.js v4.2.0)
    const results = await nerPipeline(item.text, {
      aggregation_strategy: 'simple',
      ignore_labels: ['O'],
    });

    for (const res of results) {
      const group = nerEntityGroup(res);
      if (!group || !(res.score > 0.8)) continue;
      const word = String(res.word || '').trim();
      if (!word || word.startsWith('##')) continue;
      entities.push({
        text: word,
        entity_type: group,
        start: res.start,
        end: res.end,
        bbox: item.rect,
        confidence: res.score,
      });
    }
  }

  return entities;
}

// ── Message Handler ───────────────────────────────────────────────

self.onmessage = async (e) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'INIT': {
        await selectBackend();
        lockOrtWasmSingleThread();

        // Face model is on the VLM critical path — load it first and
        // report readiness so the offscreen gate can fail closed.
        // NER is not required before a VLM call; load it in the background
        // so a slow HF download cannot skip or delay face redaction.
        self.postMessage({ type: 'INIT_PROGRESS', status: 'Loading face model…', backend, id });
        await loadFaceModel();
        self.postMessage({
          type: 'INIT_DONE',
          backend,
          faceModelReady: !!faceSession,
          faceModelError,
          nerModelReady: !!nerPipeline,
          id,
        });
        // Warm the NER weights after faces are ready so DETECT_NER is not a
        // cold 11s download on the first SANITIZE. Fail-closed happens on
        // DETECT_NER if this load fails (detectNER throws NER_MODEL_UNAVAILABLE).
        loadNERModel().catch((err) => {
          console.error('[SIH26171] Background NER load failed:', err);
        });
        break;
      }

      case 'DETECT_FACES': {
        const faces = await detectFacesFromPayload(payload);
        self.postMessage({ type: 'FACES_DETECTED', faces, faceModelReady: true, id });
        break;
      }

      case 'DETECT_NER': {
        const entities = await detectNER(payload && payload.texts);
        self.postMessage({
          type: 'NER_DETECTED',
          entities,
          nerModelReady: true,
          id,
        });
        break;
      }

      default:
        self.postMessage({ type: 'ERROR', error: `Unknown message type: ${type}`, id });
    }
  } catch (err) {
    // Report error without crashing the worker — it stays alive for future
    // messages. `stack` is additive and consumers may ignore it, but without it
    // a bare message like "Unexpected token ')'" is undiagnosable.
    self.postMessage({
      type: 'ERROR',
      error: err.message,
      stack: err.stack || null,
      originalType: type,
      id,
    });
  }
};

console.log('[SIH26171] Inference worker loaded (module), ORT:', ort.env?.versions?.common ?? 'unknown');
