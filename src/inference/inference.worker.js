// Inference Worker — Dedicated Web Worker for ONNX Runtime Web inference
// Runs BlazeFace ONNX (faces) and DistilBERT NER (text PII)
//
// ARCHITECTURE NOTE:
// This worker is created with { type: 'module' } from offscreen.js.
// This is required because @huggingface/transformers v4.x is ESM-only.
//
// ORT is loaded via dynamic import (ESM) from the local vendor copy.
// Transformers.js is imported at the top of this module.
//
// WASM path configuration happens before any InferenceSession is created.

// ── Imports ────────────────────────────────────────────────────────

// Dynamic import for ORT — we need to set wasmPaths before the module resolves
// its own internal fetch calls. We do this via the env object immediately after import.
import * as ort from '../vendor/ort.min.js';

// Configure ORT WASM binary locations to our vendored copies.
// Must happen before any InferenceSession.create() call.
// chrome.runtime.getURL is available in module workers inside extensions.
ort.env.wasm.wasmPaths = chrome.runtime.getURL('src/vendor/');

// Transformers.js — ESM import (works in module worker)
// Models are fetched from HF Hub and cached via Cache API on first load.
import { pipeline, env as transformersEnv } from '../vendor/transformers.min.js';

// Configure Transformers.js to use HF Hub (not local model files)
// Models are cached in Cache API after first download.
transformersEnv.allowLocalModels = false;
transformersEnv.useBrowserCache = true;

// ── State ──────────────────────────────────────────────────────────
let faceSession = null;
let nerPipeline = null;
let backend = 'wasm';

// ── Backend Selection ─────────────────────────────────────────────
async function selectBackend() {
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        backend = 'webgpu';
        return;
      }
    } catch {
      // WebGPU unavailable — fall through to wasm
    }
  }
  backend = 'wasm';
}

// ── Model Loading ─────────────────────────────────────────────────

async function loadFaceModel() {
  // TODO (Task 1.2 — ML Engineer): Implement BlazeFace ONNX loading.
  //
  // Steps:
  //   1. Fetch model from: https://huggingface.co/garavv/blazeface-onnx/resolve/main/blazeface_back.onnx
  //   2. Cache response in Cache API: caches.open('blazeface-v1')
  //   3. Create session:
  //      faceSession = await ort.InferenceSession.create(modelArrayBuffer, {
  //        executionProviders: [backend],
  //      });
  //   4. Log input/output names for preprocessing verification.
  //
  // When faceSession === null, detectFaces() returns [] and the pipeline
  // continues without face masking. This is a safe fallback.
  faceSession = null;
}

async function loadNERModel() {
  // TODO (Task 1.2 — ML Engineer): Implement NER model loading.
  //
  // Steps:
  //   nerPipeline = await pipeline(
  //     'token-classification',
  //     'Xenova/distilbert-base-uncased-finetuned-conll03-english',
  //     { aggregation_strategy: 'simple', device: backend === 'webgpu' ? 'webgpu' : 'wasm' }
  //   );
  //
  // Cold start: ~5-15s (downloads ~66MB, then caches via Cache API).
  // Warm start: <1s (reads from Cache API).
  // When nerPipeline === null, detectNER() returns [] and regex-only PII detection runs.
  nerPipeline = null;
}

// ── Face Detection (BlazeFace) ────────────────────────────────────
// Output: [{bbox:[x1,y1,x2,y2], confidence}] in original image pixel coords
//
// BlazeFace preprocessing pipeline (for Task 1.2):
//   1. Draw dataUrl to OffscreenCanvas at original dims
//   2. Downscale to 128×128 OffscreenCanvas
//   3. getImageData → Uint8ClampedArray [RGBA, RGBA, ...]
//   4. Extract R,G,B, normalize: val = (pixel / 127.5) - 1.0
//   5. Transpose HWC→CHW: Float32Array shape [1, 3, 128, 128]
//   6. session.run({ input: tensor }) — verify input name against model
//   7. Decode anchors, sigmoid scores, filter >0.5, NMS
//   8. Scale boxes from 128×128 space back to original image dims
//
// Known limitation: BlazeFace reliably detects faces occupying >5% of image area.
// Smaller faces (e.g. in browser video call thumbnails) may be missed.

async function detectFaces(imageDataUrl) {
  if (!faceSession) return [];
  // Full implementation in Task 1.2
  return [];
}

// ── NER Detection (DistilBERT) ─────────────────────────────────────
// Input: [{text, rect}] visible text nodes
// Output: [{text, entity_type, start, end, bbox, confidence}]
//
// Known limitation: entity bbox maps to the full parent element rect,
// not the exact character-level pixel position. Over-blur is acceptable
// (safer than under-blur for privacy).

async function detectNER(texts) {
  if (!nerPipeline) return [];
  // Full implementation in Task 1.2
  return [];
}

// ── Message Handler ───────────────────────────────────────────────

self.onmessage = async (e) => {
  const { type, payload, id } = e.data;

  try {
    switch (type) {
      case 'INIT': {
        await selectBackend();
        ort.env.wasm.numThreads = navigator.hardwareConcurrency
          ? Math.min(navigator.hardwareConcurrency, 4)
          : 2;

        self.postMessage({ type: 'INIT_PROGRESS', status: 'Loading models...', backend, id });

        await Promise.all([loadFaceModel(), loadNERModel()]);

        self.postMessage({ type: 'INIT_DONE', backend, id });
        break;
      }

      case 'DETECT_FACES': {
        const faces = await detectFaces(payload.imageDataUrl);
        self.postMessage({ type: 'FACES_DETECTED', faces, id });
        break;
      }

      case 'DETECT_NER': {
        const entities = await detectNER(payload.texts);
        self.postMessage({ type: 'NER_DETECTED', entities, id });
        break;
      }

      default:
        self.postMessage({ type: 'ERROR', error: `Unknown message type: ${type}`, id });
    }
  } catch (err) {
    // Report error without crashing the worker — it stays alive for future messages
    self.postMessage({ type: 'ERROR', error: err.message, originalType: type, id });
  }
};

console.log('[SIH26171] Inference worker loaded (module), ORT:', ort.env?.versions?.common ?? 'unknown');
