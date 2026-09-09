/**
 * Aegis — VLM payload privacy: no URL/title, no API key in local storage,
 * auth headers, fail-closed (no screenshot on gate failure).
 *
 * USAGE: node eval/harness/privacy-payload.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const BACKGROUND_PATH = path.join(ROOT, "src", "background", "background.js");
const POPUP_JS = path.join(ROOT, "src", "popup", "popup.js");
const POPUP_HTML = path.join(ROOT, "src", "popup", "popup.html");
const CONTENT_PATH = path.join(ROOT, "src", "content", "content.js");
const CONTRACT_PATH = path.join(ROOT, "docs", "STORAGE_CONTRACT.md");

const backgroundSrc = fs.readFileSync(BACKGROUND_PATH, "utf8");
const popupJs = fs.readFileSync(POPUP_JS, "utf8");
const popupHtml = fs.readFileSync(POPUP_HTML, "utf8");
const contentSrc = fs.readFileSync(CONTENT_PATH, "utf8");
const contract = fs.readFileSync(CONTRACT_PATH, "utf8");

const localSets = [];
const sandbox = {
  URL,
  chrome: {
    runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: {
      local: {
        set: async (obj) => { localSets.push(obj); },
        get: async () => ({}),
      },
      session: {
        set: async () => {},
        get: async () => ({}),
        remove: async () => {},
      },
    },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  backgroundSrc +
    "\n;globalThis.__EXPORTS__ = { sanitizeLocalConfig, buildVlmAuthHeaders, isLocalVlmEndpoint, buildPageStructureForVlm, assertReadyForVlm, classifyError };",
  sandbox,
  { filename: BACKGROUND_PATH }
);
const {
  sanitizeLocalConfig,
  buildVlmAuthHeaders,
  isLocalVlmEndpoint,
  buildPageStructureForVlm,
  assertReadyForVlm,
  classifyError,
} = sandbox.__EXPORTS__;

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

console.log("Privacy payload + session API key + fail-closed holes\n");

console.log("1. API key must not persist to chrome.storage.local");
check(
  "sanitizeLocalConfig strips vlmApiKey",
  !Object.prototype.hasOwnProperty.call(
    sanitizeLocalConfig({ vlmEndpoint: "http://localhost:11434/x", vlmApiKey: "sk-secret" }),
    "vlmApiKey"
  )
);
check(
  "sanitizeLocalConfig strips apiKey / token / authorization",
  (() => {
    const out = sanitizeLocalConfig({ apiKey: "a", token: "b", authorization: "c", vlmModel: "m" });
    return out.vlmModel === "m" && !out.apiKey && !out.token && !out.authorization;
  })()
);
check("SET_CONFIG handler uses sanitizeLocalConfig", backgroundSrc.includes("sanitizeLocalConfig(msg.config)"));
check("popup sends SET_VLM_API_KEY not SET_CONFIG for the key field", popupJs.includes("SET_VLM_API_KEY") && popupJs.includes("vlmApiKey"));
check("popup never logs the API key", !/console\.(log|info|debug|warn).*vlmApiKey/.test(popupJs));
check("popup password field exists", popupHtml.includes('id="vlm-api-key"') && popupHtml.includes('type="password"'));
check("contract documents session vlmApiKey", contract.includes("`vlmApiKey`") || contract.includes("vlmApiKey"));

console.log("\n2. Auth headers: localhost empty key works; hosted gets Bearer");
check("localhost is detected", isLocalVlmEndpoint("http://localhost:11434/v1/chat/completions"));
check("127.0.0.1 is local", isLocalVlmEndpoint("http://127.0.0.1:11434/v1/chat/completions"));
check(
  "empty key + localhost → no Authorization",
  !buildVlmAuthHeaders("", "http://localhost:11434/v1/chat/completions").Authorization
);
check(
  "key + localhost → still no Authorization (Ollama-safe)",
  !buildVlmAuthHeaders("sk-test", "http://localhost:11434/v1/chat/completions").Authorization
);
check(
  "key + Gemini OpenAI-compat host → Bearer",
  buildVlmAuthHeaders("sk-gemini", "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions").Authorization === "Bearer sk-gemini"
);
check(
  "empty key + hosted → no Authorization",
  !buildVlmAuthHeaders("", "https://api.openai.com/v1/chat/completions").Authorization
);
check("fetch uses buildVlmAuthHeaders", backgroundSrc.includes("buildVlmAuthHeaders(sessionSecrets.vlmApiKey"));

console.log("\n3. Fail-closed: no frame leaves on gate failure");
check(
  "error sendResponse has no sanitizedImage / screenshot fields",
  /catch\(\(err\)\s*=>\s*sendResponse\(\{[\s\S]*?\}\)\)/.test(backgroundSrc.replace(/\s+/g, " ")) &&
    !backgroundSrc.includes("sendResponse({ error: err.message, errorCode: classifyError(err), sanitizedImage")
);
check(
  "VLM body uses sanitizedImage not screenshotDataUrl",
  backgroundSrc.includes("sanitizeResponse.sanitizedImage") &&
    !/image_url: \{ url: screenshotDataUrl \}/.test(backgroundSrc)
);
check(
  "assertReadyForVlm still blocks missing face pass",
  (() => {
    try {
      assertReadyForVlm(
        { sanitizedImage: "data:image/png;base64,xx", nerPassComplete: true },
        { faceDetection: true, piiDetection: true }
      );
      return false;
    } catch (e) {
      return String(e.message).includes("FACE_REDACTION");
    }
  })()
);
check(
  "assertReadyForVlm still blocks missing NER pass",
  (() => {
    try {
      assertReadyForVlm(
        { sanitizedImage: "data:image/png;base64,xx", facePassComplete: true },
        { faceDetection: true, piiDetection: true }
      );
      return false;
    } catch (e) {
      return String(e.message).includes("NER_REDACTION");
    }
  })()
);
check("classifyError still maps FACE_MODEL", classifyError({ message: "FACE_MODEL_UNAVAILABLE" }) === "FACE_REDACTION_REQUIRED");
check("classifyError still maps NER_MODEL", classifyError({ message: "NER_MODEL_UNAVAILABLE" }) === "NER_REDACTION_REQUIRED");
check("classifyError maps worker load failure to INIT_FAILED", classifyError({ message: "Inference worker failed to load: boom" }) === "INIT_FAILED");
check(
  "classifyError maps ORT no-available-backend to INIT_FAILED",
  classifyError({
    message:
      "no available backend found. ERR: [wasm] TypeError: Failed to fetch dynamically imported module: chrome-extension://x/src/vendor/ort-wasm-simd-threaded.mjs",
  }) === "INIT_FAILED"
);
check(
  "classifyError maps FACE_MODEL-prefixed ORT failure to FACE_REDACTION_REQUIRED",
  classifyError({
    message: "FACE_MODEL_UNAVAILABLE: no available backend found. ERR: [wasm] TypeError",
  }) === "FACE_REDACTION_REQUIRED"
);
check(
  "classifyError maps Receiving end does not exist to NO_CONTENT_SCRIPT",
  classifyError({ message: "Could not establish connection. Receiving end does not exist." }) === "NO_CONTENT_SCRIPT"
);
check("popup surfaces NO_CONTENT_SCRIPT", popupJs.includes("NO_CONTENT_SCRIPT") && popupJs.includes("Refresh this tab"));
check("background injects content script via scripting.executeScript", backgroundSrc.includes("chrome.scripting") && backgroundSrc.includes("executeScript"));
check("CAPTURE still gates VLM with assertReadyForVlm", backgroundSrc.includes("assertReadyForVlm(sanitizeResponse"));

console.log("\n4. URL / title omitted from VLM page structure");
const ps = buildPageStructureForVlm({
  fields: [{ selector: "#x", label: "Name" }],
  maskedRegions: [],
  dpr: 2,
});
check("no url key", !Object.prototype.hasOwnProperty.call(ps, "url"));
check("no title key", !Object.prototype.hasOwnProperty.call(ps, "title"));
check("keeps fields for actions", ps.fields[0].selector === "#x");
check("handleCaptureAndSanitize uses buildPageStructureForVlm", backgroundSrc.includes("buildPageStructureForVlm({"));
// Bound the slice by the statement that directly follows the vlmPayload
// object literal. The previous anchor ("const vlmResponse = await fetch")
// moved into requestVlmContent() when VLM transport was extracted, which
// made indexOf return -1 and silently widened this slice to the whole file.
const payloadStart = backgroundSrc.indexOf("const vlmPayload");
const payloadEnd = backgroundSrc.indexOf("const sessionSecrets", payloadStart);
check("payload block anchors resolve", payloadStart !== -1 && payloadEnd > payloadStart,
  `start=${payloadStart} end=${payloadEnd}`);
const payloadBlock = backgroundSrc.slice(payloadStart, payloadEnd);
check(
  "VLM payload object does not interpolate tab.url or tab.title",
  payloadBlock.includes("JSON.stringify(pageStructure)") &&
    !payloadBlock.includes("tab.url") &&
    !payloadBlock.includes("tab.title"),
  payloadBlock.includes("tab.url") ? "tab.url still in payload block" : "payload block missing"
);

console.log("\n5. Demo UI: loading + sanitized preview + receipt");
check("pipeline loading UI exists", popupHtml.includes('id="pipeline"') && popupJs.includes("setPipeline"));
check("sanitized preview is an img of the redacted frame", popupHtml.includes('id="sanitize-preview"') && popupJs.includes("showSanitizedPreview(response.sanitizedImage)"));
check("receipt still rendered", popupJs.includes("showReceipt"));

console.log("\n6. Dynamic DOM re-scan (no VLM)");
check("content script uses MutationObserver", contentSrc.includes("new MutationObserver"));
check("rescan is debounced", contentSrc.includes("RESCAN_DEBOUNCE_MS") || contentSrc.includes("setTimeout"));
check("rescan only refreshes overlay, does not fetch VLM", contentSrc.includes("showRedactionOverlay") && !contentSrc.includes("CAPTURE_AND_SANITIZE") && !contentSrc.includes("fetch("));
check("idle rescan does not send DETECT_FACES", (() => {
  const start = contentSrc.indexOf("function scheduleSensitiveRescan");
  const end = contentSrc.indexOf("function mutationTouchesOverlay");
  return start !== -1 && end > start && !contentSrc.slice(start, end).includes("DETECT_FACES");
})());

console.log("\n7. Face-scan toggle + Fill Form copy (Fill tab)");
check("Fill tab has Scan human faces toggle", popupHtml.includes('id="face-scan-toggle"') && popupHtml.includes("Scan human faces"));
check("Fill tab copy says browsing does not scan other people's faces", /Browsing does not scan other people's faces/.test(popupHtml));
check("Fill tab has Scan faces now control", popupHtml.includes('id="scan-faces-now-btn"'));
check("popup syncs Fill-tab toggle with faceDetection storage", popupJs.includes("face-scan-toggle") && popupJs.includes("faceDetection"));
check("Privacy Scan / Scan faces now send forceFaces on SCAN_AND_OVERLAY", popupJs.includes("forceFaces") && popupJs.includes("SCAN_AND_OVERLAY"));
check("Fill Form copy says profile and document text stay on device", popupHtml.includes('id="fill-form-hint"') && /saved profile and document text on this device/.test(popupHtml));
check("upload copy says PDF is read as text on this device", popupHtml.includes("PDF is read as text on this device"));
check("overlay includeFaces follows faceDetectionEnabled", backgroundSrc.includes("includeFaces: faceDetectionEnabled"));
check("FILL_MATCHING_FIELDS consumes vault via extract-profile", backgroundSrc.includes("enrichProfileFromVaultText"));
check(
  "Fill Form click sends exact FILL_MATCHING_FIELDS message",
  /fillBtn\.addEventListener\([\s\S]*?sendMessage\(\{\s*type:\s*"FILL_MATCHING_FIELDS"\s*\}\)/.test(popupJs)
);
check("Settings tab has scan-faces-page-btn", popupHtml.includes('id="scan-faces-page-btn"'));
check(
  "scan-faces-page-btn wired to scanFacesNow (forceFaces path)",
  popupJs.includes('getElementById("scan-faces-page-btn")') &&
    popupJs.includes('getElementById("scan-faces-now-btn")') &&
    /function scanFacesNow[\s\S]*runPrivacyScan\(\{\s*forceFaces:\s*true\s*\}\)/.test(popupJs)
);
check(
  "runPrivacyScan forwards forceFaces on SCAN_AND_OVERLAY",
  /runPrivacyScan[\s\S]*sendMessage\(\{\s*type:\s*"SCAN_AND_OVERLAY",\s*forceFaces\s*\}\)/.test(popupJs)
);
check(
  "background SCAN_AND_OVERLAY honors forceFaces for faceDetection",
  /handleScanAndOverlay[\s\S]*msg\.forceFaces === true[\s\S]*config\.faceDetection = true/.test(backgroundSrc)
);

console.log("");
if (fail) {
  console.log(`${pass} passed, ${fail} failed.`);
  process.exit(1);
}
console.log(`${pass} passed, 0 failed.`);
