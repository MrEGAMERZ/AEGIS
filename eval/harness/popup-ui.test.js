/**
 * Popup UI contract for Profile document upload + simplified Fill tab.
 *
 * USAGE: node eval/harness/popup-ui.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const html = fs.readFileSync(path.join(ROOT, "src/popup/popup.html"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "src/popup/popup.js"), "utf8");

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

console.log("Popup UI — profile upload + local AI structure\n");

const profileStart = html.indexOf('id="tab-profile"');
const fillStart = html.indexOf('id="tab-fill"');
const settingsStart = html.indexOf('id="tab-settings"');
const profileHtml = html.slice(profileStart, settingsStart);
const fillHtml = html.slice(fillStart, profileStart);

check("drop-zone is on Profile tab", profileHtml.includes('id="drop-zone"'));
check("doc-file-input is on Profile tab", profileHtml.includes('id="doc-file-input"'));
check("Fill tab has no drop-zone", !fillHtml.includes('id="drop-zone"'));
check("PDF accepted on doc input", html.includes(".pdf") && html.includes('id="doc-file-input"'));
check("analyze-with-ai defaults checked", /id="analyze-with-ai"[^>]*checked/.test(html));
check("save is an explicit post-extract button", html.includes('id="save-extracted-btn"') && html.includes('id="discard-extracted-btn"'));
check("auto vault checkbox removed", !html.includes("save-to-vault"));
check("Save prompt exists", html.includes('id="doc-save-card"') && html.includes('id="doc-field-preview"'));
check("tour banner removed", !html.includes("tour-card"));
check("voice mic removed from popup HTML", !html.includes("voice-start-btn"));
check("Fill Form button present", html.includes('id="fill-btn"'));
check("Privacy Scan present", html.includes('id="scan-btn"'));
check("Stop scan button present and starts disabled", html.includes('id="stop-scan-btn"') && /id="stop-scan-btn"[^>]*disabled/.test(html));
check("Theme button present", html.includes('id="theme-toggle-btn"') && html.includes("theme-btn"));
check("Stop scan sends ABORT_SCAN", js.includes('type: "ABORT_SCAN"') && js.includes("abortBusyWork"));
check("Scan stop ignores late SCAN_AND_OVERLAY results", js.includes("workGeneration") && js.includes("SCAN_ABORTED"));
check("Theme cycles light, dark, and system", js.includes('["light", "dark", "system"]') && js.includes("prefers-color-scheme"));
check("STRUCTURE_DOCUMENT_TEXT still sent", js.includes("STRUCTURE_DOCUMENT_TEXT"));
check("EXTRACT_DOCUMENT_TEXT still sent", js.includes("EXTRACT_DOCUMENT_TEXT"));
check("consented:true on AI structure", /consented:\s*true/.test(js));
check("falls back to extractProfileFromText", js.includes("extractProfileFromText"));
check("merges via toUserProfileFields", js.includes("toUserProfileFields"));
check("Import file uses document pipeline", js.includes("handleUploadedFile(file)"));
check("vault list refresh after save", js.includes("renderVaultList"));
check("pending upload held in RAM until Save", js.includes("pendingUpload"));
check("Save writes ADD_DOC_TO_VAULT", /function confirmSaveExtracted[\s\S]*ADD_DOC_TO_VAULT/.test(js));
check("Save writes saveProfileData", /function confirmSaveExtracted[\s\S]*saveProfileData/.test(js));
check("popup warms models on open", js.includes("WARM_MODELS") && js.includes("warmOnDeviceModels"));
check(
  "Fill Form skips leftover VLM when gateway is down",
  /gatewayReady === true/.test(js) && js.includes("local AI offline")
);
check("Stop aborts fill and run agent", js.includes('setBusy("fill")') && js.includes('setBusy("agent")') && js.includes("abortBusyWork"));
check(
  "TIMEOUT copy does not call a VLM timeout an init failure",
  /code === "TIMEOUT"[\s\S]*Local model timed out/.test(js) &&
    !/code === "TIMEOUT" \|\| code === "INIT_FAILED"/.test(js)
);

const extractStart = js.indexOf("async function handleUploadedFile");
const extractEnd = js.indexOf("dropZone?.addEventListener");
const extractFn = extractStart !== -1 && extractEnd > extractStart ? js.slice(extractStart, extractEnd) : "";
check("extract path does not ADD_DOC_TO_VAULT", extractFn.includes("EXTRACT_DOCUMENT_TEXT") && !extractFn.includes("ADD_DOC_TO_VAULT"));
check("extract path does not saveProfileData", extractFn.includes("EXTRACT_DOCUMENT_TEXT") && !extractFn.includes("saveProfileData"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
