/**
 * Aegis — Live face redaction MUST complete before any VLM call
 * eval/harness/face-redaction-before-vlm.test.js
 *
 * INVARIANT
 * ---------
 * On live tab capture, faces are detected and pixelated locally BEFORE the
 * sanitized frame (or any derived payload) is sent to the VLM. Fail closed
 * if BlazeFace is unavailable — never send a raw live frame.
 *
 * This file loads the REAL `src/background/background.js` into a sandboxed
 * Node VM (same pattern as sanitize-action.test.js) and asserts
 * `assertReadyForVlm()` — the last gate immediately before `fetch(vlmEndpoint)`.
 * It also checks the offscreen/worker source contract so the payload-field
 * mismatch that previously skipped face detection cannot regress.
 *
 * USAGE
 * -----
 *   node eval/harness/face-redaction-before-vlm.test.js
 *
 * DEPENDENCIES: none (Node core: fs, path, vm).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const BACKGROUND_PATH = path.join(ROOT, "src", "background", "background.js");
const OFFSCREEN_PATH = path.join(ROOT, "src", "offscreen", "offscreen.js");
const WORKER_PATH = path.join(ROOT, "src", "inference", "inference.worker.js");
const MANIFEST_PATH = path.join(ROOT, "manifest.json");
const ONNX_PATH = path.join(ROOT, "src", "vendor", "blaze.onnx");

const backgroundSrc = fs.readFileSync(BACKGROUND_PATH, "utf8");
const offscreenSrc = fs.readFileSync(OFFSCREEN_PATH, "utf8");
const workerSrc = fs.readFileSync(WORKER_PATH, "utf8");
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));

const sandbox = {
  chrome: {
    runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: { local: { set: async () => {} } },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  backgroundSrc + "\n;globalThis.__EXPORTS__ = { assertReadyForVlm, classifyError };",
  sandbox,
  { filename: BACKGROUND_PATH }
);
const { assertReadyForVlm, classifyError } = sandbox.__EXPORTS__;

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

function throwsMatching(fn, needle) {
  try {
    fn();
    return false;
  } catch (err) {
    return String(err.message || err).includes(needle);
  }
}

console.log("Live face-redaction-before-VLM invariant\n");

// ── 1. Gate function: fail closed ─────────────────────────────────
console.log("assertReadyForVlm() fail-closed behavior");

check(
  "rejects null sanitization result",
  throwsMatching(() => assertReadyForVlm(null, { faceDetection: true }), "FACE_REDACTION_REQUIRED")
);

check(
  "rejects missing sanitizedImage",
  throwsMatching(
    () => assertReadyForVlm({ facePassComplete: true }, { faceDetection: true }),
    "FACE_REDACTION_REQUIRED"
  )
);

check(
  "rejects non-image payload",
  throwsMatching(
    () => assertReadyForVlm(
      { sanitizedImage: "http://evil.example/frame.png", facePassComplete: true },
      { faceDetection: true }
    ),
    "FACE_REDACTION_REQUIRED"
  )
);

check(
  "rejects facePassComplete !== true when face detection is enabled",
  throwsMatching(
    () => assertReadyForVlm(
      { sanitizedImage: "data:image/png;base64,AAA", facePassComplete: false },
      { faceDetection: true }
    ),
    "face redaction did not complete"
  )
);

check(
  "rejects omitted facePassComplete when face detection is enabled",
  throwsMatching(
    () => assertReadyForVlm(
      { sanitizedImage: "data:image/png;base64,AAA" },
      { faceDetection: true }
    ),
    "face redaction did not complete"
  )
);

check(
  "propagates offscreen error instead of calling VLM",
  throwsMatching(
    () => assertReadyForVlm(
      { error: "FACE_MODEL_UNAVAILABLE: BlazeFace did not load", sanitizedImage: "data:image/png;base64,AAA" },
      { faceDetection: true }
    ),
    "FACE_MODEL_UNAVAILABLE"
  )
);

const okResponse = {
  sanitizedImage: "data:image/png;base64,iVBORw0KGgo=",
  facePassComplete: true,
  nerPassComplete: true,
  maskedRegions: [{ type: "face", bbox: [1, 2, 3, 4] }],
};

check(
  "allows VLM only after a completed face pass",
  (() => {
    assertReadyForVlm(okResponse, { faceDetection: true });
    return true;
  })()
);

check(
  "allows VLM when user disabled face detection even without facePassComplete",
  (() => {
    assertReadyForVlm(
      { sanitizedImage: "data:image/png;base64,iVBORw0KGgo=", nerPassComplete: true },
      { faceDetection: false }
    );
    return true;
  })()
);

check(
  "classifyError maps FACE_MODEL_UNAVAILABLE to FACE_REDACTION_REQUIRED",
  classifyError({ message: "FACE_MODEL_UNAVAILABLE: BlazeFace did not load" }) === "FACE_REDACTION_REQUIRED"
);

check(
  "classifyError maps FACE_REDACTION_REQUIRED message",
  classifyError({ message: "FACE_REDACTION_REQUIRED: face redaction did not complete before VLM" }) === "FACE_REDACTION_REQUIRED"
);

// ── 2. Source order: gate before fetch, sanitized image only ──────
console.log("\nPipeline source-order contract");

const gateCallIdx = backgroundSrc.indexOf("assertReadyForVlm(sanitizeResponse");
const fetchIdx = backgroundSrc.indexOf("await fetch(vlmEndpoint");
const captureIdx = backgroundSrc.indexOf("chrome.tabs.captureVisibleTab");
const sanitizeMsgIdx = backgroundSrc.indexOf('type: "SANITIZE"');

check("handleCaptureAndSanitize captures the live tab", captureIdx !== -1);
check("SANITIZE message is sent after capture", sanitizeMsgIdx > captureIdx && sanitizeMsgIdx !== -1);
check("assertReadyForVlm is called on the live path", gateCallIdx !== -1);
check("VLM fetch exists", fetchIdx !== -1);
check(
  "assertReadyForVlm runs BEFORE fetch(vlmEndpoint)",
  gateCallIdx !== -1 && fetchIdx !== -1 && gateCallIdx < fetchIdx,
  `gate@${gateCallIdx} fetch@${fetchIdx}`
);
check(
  "SANITIZE runs BEFORE fetch(vlmEndpoint)",
  sanitizeMsgIdx !== -1 && fetchIdx !== -1 && sanitizeMsgIdx < fetchIdx
);

const vlmPayloadSlice = backgroundSrc.slice(
  backgroundSrc.indexOf("const vlmPayload"),
  fetchIdx === -1 ? backgroundSrc.length : fetchIdx
);
check(
  "VLM image_url uses sanitizeResponse.sanitizedImage (not the raw capture)",
  vlmPayloadSlice.includes("sanitizeResponse.sanitizedImage") &&
    !vlmPayloadSlice.includes("screenshotDataUrl")
);

check(
  "SANITIZE message forwards faceDetection flag",
  backgroundSrc.includes("faceDetection: faceDetectionEnabled")
);

// ── 3. Worker/offscreen payload contract (the original bug) ───────
console.log("\nWorker ↔ offscreen DETECT_FACES contract");

check(
  "worker DETECT_FACES reads payload.imageData (offscreen primary)",
  workerSrc.includes("payload.imageData")
);
check(
  "worker DETECT_FACES reads payload.imageDataUrl (fallback)",
  workerSrc.includes("payload.imageDataUrl")
);
check(
  "worker throws FACE_MODEL_UNAVAILABLE when the session is missing",
  workerSrc.includes("FACE_MODEL_UNAVAILABLE") &&
    /if\s*\(\s*!faceSession\s*\)[\s\S]{0,80}FACE_MODEL_UNAVAILABLE/.test(workerSrc)
);
check(
  "worker no longer silently returns [] on a missing face session in detectFacesFromPayload",
  !/async function detectFacesFromPayload[\s\S]*?if\s*\(\s*!faceSession\s*\)\s*return\s*\[\s*\]/.test(workerSrc)
);
check(
  "offscreen sends imageData on DETECT_FACES",
  /DETECT_FACES[\s\S]{0,200}imageData/.test(offscreenSrc)
);
check(
  "offscreen sends imageDataUrl on DETECT_FACES (worker fallback)",
  /imageDataUrl:\s*screenshotDataUrl/.test(offscreenSrc)
);
check(
  "offscreen detectFaces does not swallow errors with return []",
  !/async function detectFaces\([\s\S]*?catch[\s\S]*?return\s*\[\s*\]/.test(offscreenSrc)
);
check(
  "offscreen sets facePassComplete only after the face pass",
  offscreenSrc.includes("facePassComplete = true") &&
    offscreenSrc.includes("facePassComplete")
);
check(
  "offscreen fails closed when faceModelReady is false",
  offscreenSrc.includes("FACE_MODEL_UNAVAILABLE") &&
    offscreenSrc.includes("init.faceModelReady !== true")
);
check(
  "offscreen maps worker ERROR on DETECT_FACES back to the pending request",
  offscreenSrc.includes("DETECT_FACES: \"FACES_DETECTED\"") ||
    offscreenSrc.includes("DETECT_FACES: 'FACES_DETECTED'")
);

// ── 4. Model asset + WAR so the live path can actually load BlazeFace ─
console.log("\nBlazeFace model availability");

check(
  "src/vendor/blaze.onnx exists on disk",
  fs.existsSync(ONNX_PATH) && fs.statSync(ONNX_PATH).size > 100000,
  fs.existsSync(ONNX_PATH) ? `size=${fs.statSync(ONNX_PATH).size}` : "missing"
);
check(
  "worker fetches src/vendor/blaze.onnx",
  workerSrc.includes("src/vendor/blaze.onnx")
);

const war = (manifest.web_accessible_resources || [])
  .flatMap((entry) => entry.resources || []);
check(
  "manifest lists blaze.onnx as a web-accessible resource",
  war.includes("src/vendor/blaze.onnx")
);

console.log("\nINIT path (must not hang 20s on cold WASM)");
check(
  "INIT timeout is at least 60s (cold WASM compile)",
  /workerRequest\(\s*["']INIT["'][\s\S]{0,60}["']INIT_DONE["']\s*,\s*(9\d{4}|[6-8]\d{4}|1[12]\d{4})/.test(offscreenSrc)
);
check(
  "offscreen forwards INIT_PROGRESS to the popup",
  offscreenSrc.includes("INIT_PROGRESS") && offscreenSrc.includes('type: "INIT_PROGRESS"')
);
check(
  "worker onerror rejects pending INIT instead of only logging",
  offscreenSrc.includes("rejectAllPending") && offscreenSrc.includes("describeWorkerError")
);
check(
  "worker does not statically import transformers.min.js (lazy after INIT)",
  !/^\s*import\s+\{[^}]*pipeline[^}]*\}\s+from\s+['"]\.\.\/vendor\/transformers\.min\.js['"]/m.test(workerSrc) &&
    workerSrc.includes("await import('../vendor/transformers.min.js')")
);
check(
  "CSP allows wasm-unsafe-eval on extension pages",
  !!(manifest.content_security_policy &&
    String(manifest.content_security_policy.extension_pages || "").includes("wasm-unsafe-eval"))
);
check(
  "worker does not call chrome.runtime.getURL (dedicated module workers have no chrome.*)",
  !/chrome\.runtime\.getURL\s*\(/.test(workerSrc)
);
check(
  "worker resolves vendor WASM/ONNX via import.meta.url",
  workerSrc.includes("import.meta.url") &&
    workerSrc.includes("VENDOR_DIR") &&
    workerSrc.includes("blaze.onnx")
);
check(
  "worker wasmPaths is { wasm } object, not a directory string",
  /wasmPaths\s*=\s*\{/.test(workerSrc) &&
    workerSrc.includes("ort-wasm-simd-threaded.wasm") &&
    !/wasmPaths\s*=\s*VENDOR_DIR\.href/.test(workerSrc)
);
check(
  "worker does not force a dynamic import of ort-wasm-simd-threaded.mjs via wasmPaths",
  !/wasmPaths\s*=\s*VENDOR_DIR/.test(workerSrc)
);
check(
  "worker prefetches ort wasmBinary before InferenceSession.create",
  workerSrc.includes("ensureOrtWasmBinary") &&
    workerSrc.includes("wasmBinary") &&
    /await\s+ensureOrtWasmBinary\s*\(/.test(workerSrc)
);
check(
  "worker locks ORT to single-thread (numThreads=1 / proxy=false) before session create",
  workerSrc.includes("lockOrtWasmSingleThread") &&
    /lockOrtWasmSingleThread\s*\(/.test(workerSrc) &&
    workerSrc.includes("numThreads") &&
    workerSrc.includes("proxy")
);

const ortMinPath = path.join(ROOT, "src", "vendor", "ort.min.js");
const ortMinSrc = fs.existsSync(ortMinPath) ? fs.readFileSync(ortMinPath, "utf8") : "";
check(
  "ort.min.js forces inlined WASM factory (no dynamic import of .mjs glue)",
  ortMinSrc.includes('to=async(n,t,a,u)=>{if(!Xr)throw new Error("ORT inlined WASM factory missing') &&
    !/await us\(m\)/.test(ortMinSrc)
);
check(
  "ort.min.js disables blob createObjectURL path (Kr) for Chrome MV3 CSP",
  ortMinSrc.includes("blob URL path disabled for Chrome MV3 CSP") &&
    !ortMinSrc.includes("URL.createObjectURL")
);

const wasmPath = path.join(ROOT, "src", "vendor", "ort-wasm-simd-threaded.wasm");
const mjsPath = path.join(ROOT, "src", "vendor", "ort-wasm-simd-threaded.mjs");
check(
  "src/vendor/ort-wasm-simd-threaded.wasm exists",
  fs.existsSync(wasmPath) && fs.statSync(wasmPath).size > 1_000_000,
  fs.existsSync(wasmPath) ? `size=${fs.statSync(wasmPath).size}` : "missing"
);
check(
  "src/vendor/ort-wasm-simd-threaded.mjs exists",
  fs.existsSync(mjsPath) && fs.statSync(mjsPath).size > 1000,
  fs.existsSync(mjsPath) ? `size=${fs.statSync(mjsPath).size}` : "missing"
);
check(
  "manifest WAR includes vendor mjs/wasm globs",
  war.includes("src/vendor/*.mjs") && war.includes("src/vendor/*.wasm")
);
check(
  "classifyError maps ORT wasm backend miss to INIT_FAILED",
  classifyError({
    message:
      "no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module: chrome-extension://id/src/vendor/ort-wasm-simd-threaded.mjs",
  }) === "INIT_FAILED"
);
check(
  "classifyError maps blob: dynamic-import failure to INIT_FAILED",
  classifyError({
    message:
      "no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module: blob:chrome-extension://id/uuid",
  }) === "INIT_FAILED"
);
check(
  "classifyError maps FACE_MODEL-prefixed ORT failure to FACE_REDACTION_REQUIRED",
  classifyError({
    message:
      "FACE_MODEL_UNAVAILABLE: no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module",
  }) === "FACE_REDACTION_REQUIRED"
);

console.log("");
if (fail) {
  console.log(`${pass} passed, ${fail} failed.`);
  console.log("Live face-redaction-before-VLM invariant has a REGRESSION.");
  process.exit(1);
}
console.log(`${pass} passed, 0 failed.`);
console.log("Live face redaction is gated BEFORE the VLM call for all tested cases.");
