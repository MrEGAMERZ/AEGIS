/**
 * Aegis — Live NER redaction of names/places/orgs MUST complete before VLM
 * eval/harness/ner-redaction-before-vlm.test.js
 *
 * INVARIANT
 * ---------
 * On live tab capture, DistilBERT NER (PER / ORG / LOC) must run on extracted
 * visible text and pixelate those regions BEFORE the sanitized frame or
 * page-structure text is sent to the VLM. Fail closed if NER is unavailable.
 *
 * Root cause this guards: transformers.js v4.2.0 ignores aggregation_strategy
 * on pipeline() construction, so detectNER filtered on missing entity_group
 * and returned [] for every name/place/org.
 *
 * USAGE
 * -----
 *   node eval/harness/ner-redaction-before-vlm.test.js
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

const backgroundSrc = fs.readFileSync(BACKGROUND_PATH, "utf8");
const offscreenSrc = fs.readFileSync(OFFSCREEN_PATH, "utf8");
const workerSrc = fs.readFileSync(WORKER_PATH, "utf8");

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
  backgroundSrc +
    "\n;globalThis.__EXPORTS__ = { assertReadyForVlm, classifyError, redactNerSpansInFields, nerEntityGroup: (typeof nerEntityGroup === 'function' ? nerEntityGroup : undefined) };",
  sandbox,
  { filename: BACKGROUND_PATH }
);
const { assertReadyForVlm, classifyError, redactNerSpansInFields } = sandbox.__EXPORTS__;

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

const image = "data:image/png;base64,iVBORw0KGgo=";

console.log("Live NER-redaction-before-VLM invariant (PER/ORG/LOC)\n");

console.log("assertReadyForVlm() NER fail-closed behavior");

check(
  "rejects omitted nerPassComplete when PII detection is enabled",
  throwsMatching(
    () => assertReadyForVlm({ sanitizedImage: image, facePassComplete: true }, { faceDetection: true, piiDetection: true }),
    "NER_REDACTION_REQUIRED"
  )
);

check(
  "rejects nerPassComplete: false when PII detection is enabled",
  throwsMatching(
    () => assertReadyForVlm(
      { sanitizedImage: image, facePassComplete: true, nerPassComplete: false },
      { faceDetection: true, piiDetection: true }
    ),
    "names/places/orgs"
  )
);

check(
  "propagates NER_MODEL_UNAVAILABLE instead of calling VLM",
  throwsMatching(
    () => assertReadyForVlm(
      { error: "NER_MODEL_UNAVAILABLE", sanitizedImage: image, facePassComplete: true },
      { piiDetection: true }
    ),
    "NER_MODEL_UNAVAILABLE"
  )
);

check(
  "allows VLM only after both face and NER passes complete",
  (() => {
    assertReadyForVlm(
      { sanitizedImage: image, facePassComplete: true, nerPassComplete: true },
      { faceDetection: true, piiDetection: true }
    );
    return true;
  })()
);

check(
  "allows VLM when user disabled PII detection even without nerPassComplete",
  (() => {
    assertReadyForVlm(
      { sanitizedImage: image, facePassComplete: true },
      { faceDetection: true, piiDetection: false }
    );
    return true;
  })()
);

check(
  "classifyError maps NER_MODEL_UNAVAILABLE to NER_REDACTION_REQUIRED",
  classifyError({ message: "NER_MODEL_UNAVAILABLE" }) === "NER_REDACTION_REQUIRED"
);

check(
  "classifyError still maps FACE_MODEL to FACE_REDACTION_REQUIRED",
  classifyError({ message: "FACE_MODEL_UNAVAILABLE" }) === "FACE_REDACTION_REQUIRED"
);

check(
  "classifyError maps ORT no-available-backend to INIT_FAILED",
  classifyError({
    message:
      "no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module",
  }) === "INIT_FAILED"
);

console.log("\nredactNerSpansInFields() — labels must not leak PER/ORG/LOC to the VLM");

const fields = [
  { selector: "#name", label: "Contact Alice Smith about Acme Corp in Boston" },
  { selector: "#ok", label: "Full Name" },
];
const entities = [
  { text: "Alice Smith", entity_type: "PER" },
  { text: "Acme Corp", entity_type: "ORG" },
  { text: "Boston", entity_type: "LOC" },
];
const redacted = redactNerSpansInFields(fields, entities);
check(
  "redacts PER name in a field label",
  redacted[0].label.includes("[REDACTED]") && !redacted[0].label.includes("Alice Smith")
);
check(
  "redacts ORG in a field label",
  !redacted[0].label.includes("Acme Corp")
);
check(
  "redacts LOC in a field label",
  !redacted[0].label.includes("Boston")
);
check(
  "leaves non-PII labels unchanged",
  redacted[1].label === "Full Name"
);
check(
  "ignores non PER/ORG/LOC entity types",
  redactNerSpansInFields(
    [{ selector: "#x", label: "Order 123" }],
    [{ text: "123", entity_type: "CARD" }]
  )[0].label === "Order 123"
);
check(
  "empty entity list returns fields unchanged",
  redactNerSpansInFields(fields, [])[0].label === fields[0].label
);

console.log("\nWorker call-site contract (aggregation + fail-closed + PER/ORG/LOC)");

check(
  "aggregation_strategy: simple is passed at nerPipeline() CALL time",
  /nerPipeline\([^)]*aggregation_strategy:\s*['"]simple['"]/.test(workerSrc) ||
    /nerPipeline\(item\.text,\s*\{[\s\S]*?aggregation_strategy:\s*['"]simple['"]/.test(workerSrc)
);
check(
  "pipeline() construction does not pass aggregation_strategy",
  (() => {
    const m = workerSrc.match(
      /nerPipeline = await pipeline\(\s*'token-classification'[\s\S]{0,400}?\{[\s\S]{0,200}?\}\s*\)/
    );
    return !!(m && !m[0].includes("aggregation_strategy"));
  })()
);
check(
  "worker throws NER_MODEL_UNAVAILABLE when the pipeline is missing",
  workerSrc.includes("NER_MODEL_UNAVAILABLE") &&
    /if\s*\(\s*!nerPipeline\s*\)[\s\S]{0,80}NER_MODEL_UNAVAILABLE/.test(workerSrc)
);
check(
  "worker no longer silently return [] on a missing NER pipeline",
  !/if\s*\(\s*!nerPipeline\s*\)\s*return\s*\[\s*\]/.test(workerSrc)
);
check(
  "worker maps PER, ORG, and LOC (CoNLL-03 / DistilBERT labels)",
  workerSrc.includes("'PER'") && workerSrc.includes("'ORG'") && workerSrc.includes("'LOC'") &&
    workerSrc.includes("function nerEntityGroup")
);
check(
  "nerEntityGroup accepts raw BIO tags as a fallback (B-PER / I-ORG)",
  workerSrc.includes(".replace(/^(B-|I-)/")
);

check(
  "worker sets useWasmCache=false (no blob: ORT factory import)",
  workerSrc.includes("useWasmCache = false")
);
check(
  "ensureCallableTokenizer always wraps pipeline tokenizer as callable",
  workerSrc.includes("function ensureCallableTokenizer") &&
    workerSrc.includes("pipelineInstance.tokenizer = wrapper") &&
    workerSrc.includes("proto._call.call(tok")
);
check(
  "worker uses path-only localModelPath (not http href) so tokenizer files are found offline",
  workerSrc.includes("function localModelsPathname") &&
    workerSrc.includes("localModelPath = localModelsPathname()") &&
    !/localModelPath\s*=\s*MODELS_DIR\.href/.test(workerSrc)
);
check(
  "INIT_DONE waits for loadNERModel (Ready includes names)",
  /await loadNERModel\(\);[\s\S]{0,500}type: 'INIT_DONE'/.test(workerSrc) &&
    offscreenSrc.includes("nerModelReady: data.nerModelReady")
);
check(
  "ensureCallableTokenizer fails closed when tokenizer is missing",
  workerSrc.includes("tokenizer missing after pipeline load")
);

console.log("\nOffscreen / background live-path contract");

check(
  "offscreen detectTextPII does not swallow NER errors with a catch return",
  !/async function detectTextPII\([\s\S]*?catch[\s\S]*?Regex results are still returned/.test(offscreenSrc)
);
check(
  "offscreen DETECT_NER uses a long timeout (cold HF load)",
  /DETECT_NER[\s\S]{0,200}60000/.test(offscreenSrc)
);
check(
  "offscreen sets nerPassComplete after the NER pass",
  offscreenSrc.includes("nerPassComplete = true")
);
check(
  "offscreen forwards nerEntities for on-device label redaction",
  offscreenSrc.includes("nerEntities")
);
check(
  "SANITIZE message forwards piiDetection flag",
  backgroundSrc.includes("piiDetection: piiDetectionEnabled")
);
check(
  "pageStructure fields are NER-redacted before the VLM payload",
  /fields:\s*redactNerSpansInFields\(fillFields,\s*sanitizeResponse\.nerEntities\)/.test(backgroundSrc)
);

const fetchIdx = backgroundSrc.indexOf("await fetch(vlmEndpoint");
const assertCallIdx = backgroundSrc.indexOf("assertReadyForVlm(sanitizeResponse");
const redactCallIdx = backgroundSrc.indexOf("redactNerSpansInFields(fillFields");
check(
  "NER gate / label redaction runs BEFORE fetch(vlmEndpoint)",
  fetchIdx !== -1 && assertCallIdx !== -1 && redactCallIdx !== -1 &&
    assertCallIdx < fetchIdx && redactCallIdx < fetchIdx,
  `assert@${assertCallIdx} redact@${redactCallIdx} fetch@${fetchIdx}`
);

const vlmSlice = backgroundSrc.slice(
  backgroundSrc.indexOf("const vlmPayload"),
  fetchIdx === -1 ? backgroundSrc.length : fetchIdx
);
check(
  "VLM page-structure serialization does not include raw nerEntities",
  !vlmSlice.includes("nerEntities")
);

console.log("");
if (fail) {
  console.log(`${pass} passed, ${fail} failed.`);
  console.log("Live NER-redaction-before-VLM invariant has a REGRESSION.");
  process.exit(1);
}
console.log(`${pass} passed, 0 failed.`);
console.log("Live NER redaction of names/places/orgs is gated BEFORE the VLM call.");
