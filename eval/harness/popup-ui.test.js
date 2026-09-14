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
check("save-to-vault defaults checked", /id="save-to-vault"[^>]*checked/.test(html));
check("tour banner removed", !html.includes("tour-card"));
check("voice mic removed from popup HTML", !html.includes("voice-start-btn"));
check("Fill Form button present", html.includes('id="fill-btn"'));
check("Privacy Scan present", html.includes('id="scan-btn"'));
check("STRUCTURE_DOCUMENT_TEXT still sent", js.includes("STRUCTURE_DOCUMENT_TEXT"));
check("EXTRACT_DOCUMENT_TEXT still sent", js.includes("EXTRACT_DOCUMENT_TEXT"));
check("consented:true on AI structure", /consented:\s*true/.test(js));
check("falls back to extractProfileFromText", js.includes("extractProfileFromText"));
check("merges via toUserProfileFields", js.includes("toUserProfileFields"));
check("Import file uses document pipeline", js.includes("handleUploadedFile(file)"));
check("vault list refresh after save", js.includes("renderVaultList"));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
