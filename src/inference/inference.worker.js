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
// transformers.js v4 Callable tokenizers should be functions, but some bundled
// builds return a plain object with `_call`. Wrap so pipeline._call can tokenize.
function ensureCallableTokenizer(pipelineInstance) {
  const tok = pipelineInstance && pipelineInstance.tokenizer;
  if (!tok || typeof tok === 'function') return;
  if (typeof tok._call === 'function') {
    pipelineInstance.tokenizer = (text, options) => tok._call(text, options);
  }
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
    transformersEnv.localModelPath = MODELS_DIR.href;
    transformersEnv.useBrowserCache = false;
    transformersEnv.useFSCache = false;

    const wasm = transformersEnv.backends?.onnx?.wasm;
    if (wasm) {
      wasm.numThreads = 1;
      wasm.proxy = false;
      // At module-eval time transformers.min.js assigns a jsdelivr wasmPaths
      // default, but only when wasmPaths is unset, and it does not fetch then.
      // Overwriting it before the first pipeline() call means the CDN URL is
      // never requested.
      //
      // { wasm } ONLY — adding .mjs here makes ORT skip its embedded factory
      // and fall through to URL.createObjectURL + import(blob:), which MV3 CSP
      // rejects. Same contract as lockOrtWasmSingleThread above.
      //
      // transformers.min.js is bundled against the same ORT 1.29.0 wasm build
      // BlazeFace uses, so this points at the one vendored binary rather than
      // shipping a second 13MB copy.
      wasm.wasmPaths = {
        wasm: new URL('ort-wasm-simd-threaded.wasm', VENDOR_DIR).href,
      };
      // Already in memory from face INIT — reuse it so NER does not refetch
      // and recompile the same 13MB binary.
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
// Preprocessing pipeline:
//   1. Draw dataUrl to OffscreenCanvas at original dims
//   2. Downscale to 128×128 OffscreenCanvas (no squash, aspect assumed ok)
//   3. getImageData → Uint8ClampedArray [RGBA, RGBA, ...]
//   4. Extract R,G,B, normalize: val = pixel / 255.0
//   5. Transpose HWC→CHW: Float32Array shape [1, 3, 128, 128]
//   6. session.run({ image, conf_threshold, max_detections, iou_threshold })
//   7. Parse single output selectedBoxes [1,N,16] → bbox [ymin,xmin,ymax,xmax]
//   8. Scale boxes from 128×128 space back to original image dims
//
// Known limitation: BlazeFace reliably detects faces occupying >5% of image area.
// Smaller faces (e.g. in browser video call thumbnails) may be missed.

// Fail CLOSED: never return [] just because the model is missing — that
// previously let unredacted live frames reach the VLM. Callers must treat
// FACE_MODEL_UNAVAILABLE as a hard error and refuse the VLM call.
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

  const targetW = 128;
  const targetH = 128;
  const canvas = new OffscreenCanvas(targetW, targetH);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(sourceDrawable, 0, 0, targetW, targetH);
  const imgData = ctx.getImageData(0, 0, targetW, targetH);
  const data = imgData.data;

  const float32Data = new Float32Array(3 * targetW * targetH);
  for (let i = 0; i < targetW * targetH; i++) {
    const r = data[i * 4] / 255.0;
    const g = data[i * 4 + 1] / 255.0;
    const b = data[i * 4 + 2] / 255.0;
    float32Data[i] = r;
    float32Data[targetW * targetH + i] = g;
    float32Data[2 * targetW * targetH + i] = b;
  }

  const inputTensor = new ort.Tensor('float32', float32Data, [1, 3, targetH, targetW]);
  const confThreshold = new ort.Tensor('float32', Float32Array.from([0.5]), [1]);
  const maxDetections = new ort.Tensor('int64', BigInt64Array.from([BigInt(25)]), [1]);
  const iouThreshold = new ort.Tensor('float32', Float32Array.from([0.3]), [1]);

  const feeds = {
    image: inputTensor,
    conf_threshold: confThreshold,
    max_detections: maxDetections,
    iou_threshold: iouThreshold,
  };

  const results = await faceSession.run(feeds);
  const boxesTensor = results[faceSession.outputNames[0]];
  const boxes = boxesTensor.data;

  const faces = [];
  const numFaces = boxesTensor.dims.length === 3
    ? boxesTensor.dims[1]
    : boxesTensor.dims.length === 2 ? boxesTensor.dims[0] : (boxes.length / 16);

  for (let i = 0; i < numFaces; i++) {
    const ymin = boxes[i * 16 + 0];
    const xmin = boxes[i * 16 + 1];
    const ymax = boxes[i * 16 + 2];
    const xmax = boxes[i * 16 + 3];

    const x1 = Math.round(xmin * origW);
    const y1 = Math.round(ymin * origH);
    const x2 = Math.round(xmax * origW);
    const y2 = Math.round(ymax * origH);

    faces.push({
      bbox: [x1, y1, x2, y2],
      confidence: 1.0,
    });
  }

  return faces;
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
