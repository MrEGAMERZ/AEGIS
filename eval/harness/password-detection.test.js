/**
 * Aegis — passwordDetection toggle gates DOM password masking only.
 *
 * USAGE: node eval/harness/password-detection.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const BACKGROUND_PATH = path.join(ROOT, "src", "background", "background.js");
const CONTENT_PATH = path.join(ROOT, "src", "content", "content.js");
const backgroundSrc = fs.readFileSync(BACKGROUND_PATH, "utf8");
const contentSrc = fs.readFileSync(CONTENT_PATH, "utf8");

const sandbox = {
  chrome: {
    runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: { local: { set: async () => {}, get: async () => ({}) } },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  backgroundSrc + "\n;globalThis.__EXPORTS__ = { filterFieldsForPasswordDetection };",
  sandbox,
  { filename: BACKGROUND_PATH }
);
const { filterFieldsForPasswordDetection } = sandbox.__EXPORTS__;

const SAMPLE_FIELDS = [
  { type: "password_input", selector: "#pw", label: "Password" },
  { type: "sensitive_input", selector: "#cc", label: "Card" },
  { type: "text_input", selector: "#name", label: "Name" },
];

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

console.log("passwordDetection toggle wiring\n");

console.log("1. Filter helper");
check(
  "enabled keeps password_input",
  filterFieldsForPasswordDetection(SAMPLE_FIELDS, true).some((f) => f.type === "password_input")
);
check(
  "disabled drops password_input only",
  filterFieldsForPasswordDetection(SAMPLE_FIELDS, false).every((f) => f.type !== "password_input")
);
check(
  "disabled keeps sensitive_input",
  filterFieldsForPasswordDetection(SAMPLE_FIELDS, false).some((f) => f.type === "sensitive_input")
);

console.log("\n2. Pipeline reads storage key");
check(
  "handleCaptureAndSanitize loads passwordDetection",
  /handleCaptureAndSanitize[\s\S]*passwordDetection/.test(backgroundSrc)
);
check(
  "handleScanAndOverlay loads passwordDetection",
  /handleScanAndOverlay[\s\S]*passwordDetection/.test(backgroundSrc)
);
check(
  "filter applied before SANITIZE fields",
  backgroundSrc.includes("filterFieldsForPasswordDetection(")
);

console.log("\n3. Content overlay rescan respects toggle");
check(
  "content reads passwordDetection from storage",
  contentSrc.includes('chrome.storage.local.get(["passwordDetection"])')
);
check(
  "content filters password_input on rescan",
  /filterFieldsForPasswordDetection\(fields, passwordOn\)/.test(contentSrc)
);

console.log("\n4. Idle MutationObserver never runs face CV");
const rescanStart = contentSrc.indexOf("function scheduleSensitiveRescan");
const rescanEnd = contentSrc.indexOf("function mutationTouchesOverlay");
check("scheduleSensitiveRescan found", rescanStart !== -1 && rescanEnd > rescanStart);
const rescanFn = contentSrc.slice(rescanStart, rescanEnd);
check("idle rescan does not mention DETECT_FACES", !rescanFn.includes("DETECT_FACES"));
check("idle rescan sets includeFaces: false", rescanFn.includes("includeFaces: false"));
check("idle rescan does not query applicant-photo", !rescanFn.includes("applicant-photo"));
check(
  "content script never sends DETECT_FACES",
  !contentSrc.includes('type: "DETECT_FACES"') && !contentSrc.includes("type: 'DETECT_FACES'")
);
check(
  "photo/face heuristic is inside renderFaceOverlays only",
  /function renderFaceOverlays[\s\S]*applicant-photo/.test(contentSrc) &&
    contentSrc.indexOf("function renderFaceOverlays") < contentSrc.indexOf("applicant-photo")
);
check(
  "scan overlay path still requests faces",
  /SHOW_REDACTION_OVERLAY[\s\S]{0,180}includeFaces:\s*true/.test(backgroundSrc)
);

console.log("\n5. Fail-closed layers unchanged");
check("face gate still in assertReadyForVlm", backgroundSrc.includes("facePassComplete"));
check("NER gate still in assertReadyForVlm", backgroundSrc.includes("nerPassComplete"));
check("sanitizeAction profileKey guard intact", backgroundSrc.includes("profileKey"));

console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
