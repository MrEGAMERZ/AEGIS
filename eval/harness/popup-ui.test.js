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
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

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
check("voice mic is on Profile tab", profileHtml.includes('id="voice-start-btn"') && profileHtml.includes('id="voice-lang-select"'));
check("Fill tab has no voice mic", !fillHtml.includes('id="voice-start-btn"'));
check("ten speech languages listed", (html.match(/hi-IN|bn-IN|ta-IN|te-IN|mr-IN|kn-IN|gu-IN|ml-IN|pa-IN/g) || []).length >= 9);
check("popup uses Chrome SpeechRecognition helper", js.includes("createSpeechSession") && js.includes("speech-listen.js"));
check("speech Save writes profile", /save-voice-btn[\s\S]*saveProfileData/.test(js));
check("full voice page opener", js.includes("src/voice/voice.html"));
check("dashboard opener", js.includes("src/dashboard/dashboard.html"));
check("Fill Form button present", html.includes('id="fill-btn"'));
check("Product name is AEGIS in the popup header", html.includes("<h1>AEGIS</h1>") && html.includes("<title>AEGIS</title>"));
check("Popup does not use the AGs short label", !/\bAGs\b/.test(html));
check("Chrome card name is AEGIS", manifest.name === "AEGIS" && manifest.short_name === "AEGIS" && manifest.action.default_title === "AEGIS");
const dashboardHtml = fs.readFileSync(path.join(ROOT, "src/dashboard/dashboard.html"), "utf8");
const voiceHtml = fs.readFileSync(path.join(ROOT, "src/voice/voice.html"), "utf8");
const autofillJs = fs.readFileSync(path.join(ROOT, "src/content/autofill.js"), "utf8");
check("Dashboard chrome says AEGIS", dashboardHtml.includes("<title>AEGIS") && dashboardHtml.includes("<h1>AEGIS"));
check("Voice page title is AEGIS", voiceHtml.includes("<title>AEGIS"));
check("voice page is a module", voiceHtml.includes('src="voice.js" type="module"'));
const voiceJsSrc = fs.readFileSync(path.join(ROOT, "src/voice/voice.js"), "utf8");
check("voice page uses shared extract", voiceJsSrc.includes("extractProfileFromText"));
check("voice page does not auto-save on transcript", !/rec\.onresult[\s\S]*chrome\.storage\.local\.set/.test(voiceJsSrc));
check("Autofill overlay uses AEGIS, not Aegis", autofillJs.includes("AEGIS — complete your profile") && autofillJs.includes("`AEGIS: ${fieldsCount} fields`") && !autofillJs.includes("<h2>Aegis"));
check("Exported profile filename uses AEGIS", js.includes("`AEGIS_${name}.json`"));
check("Privacy Scan present", html.includes('id="scan-btn"'));
check(
  "redacted screenshot sits at the bottom of the popup on every tab",
  html.indexOf('id="tab-settings"') < html.indexOf('id="preview-wrap"') &&
    html.includes("What the agent would see") &&
    html.includes('id="preview-empty"')
);
check("Privacy Scan shows the redacted frame after SCAN_AND_OVERLAY", js.includes("revealScanPreview(result.sanitizedImage)") && js.includes("GET_LAST_SANITIZED_IMAGE"));
check("last redacted frame is restored from session", js.includes("lastSanitizedImage"));
check("Stop scan button present and starts disabled", html.includes('id="stop-scan-btn"') && /id="stop-scan-btn"[^>]*disabled/.test(html));
check("Theme button present", html.includes('id="theme-toggle-btn"') && html.includes("theme-btn"));
check("Stop scan sends ABORT_SCAN", js.includes('type: "ABORT_SCAN"') && js.includes("abortPrivacyScan"));
check("Scan stop ignores late SCAN_AND_OVERLAY results", js.includes("scanGeneration") && js.includes("SCAN_ABORTED"));
check("Theme cycles light, dark, and system", js.includes('["light", "dark", "system"]') && js.includes("prefers-color-scheme"));
check("STRUCTURE_DOCUMENT_TEXT still sent", js.includes("STRUCTURE_DOCUMENT_TEXT"));
check("EXTRACT_DOCUMENT_TEXT still sent", js.includes("EXTRACT_DOCUMENT_TEXT"));
check("consented:true on AI structure", /consented:\s*true/.test(js));
check("falls back to extractProfileFromText", js.includes("extractProfileFromText"));
check(
  "upload always merges on-device extract with local AI fields",
  js.includes("mergeProfileFieldMaps") &&
    /mergeProfileFieldMaps\(\s*extractProfileFromText\(text\)\s*\)/.test(js) &&
    /mergeProfileFieldMaps\(\s*profileFields,\s*r\.fields\s*\)/.test(js)
);
check("merges via toUserProfileFields", js.includes("toUserProfileFields"));
check("Import file uses document pipeline", js.includes("handleUploadedFile(file)"));
check("vault list refresh after save", js.includes("renderVaultList"));
check("pending upload held in RAM until Save", js.includes("pendingUpload"));
check("Save writes ADD_DOC_TO_VAULT", /function confirmSaveExtracted[\s\S]*ADD_DOC_TO_VAULT/.test(js));
check("Save writes saveProfileData", /function confirmSaveExtracted[\s\S]*saveProfileData/.test(js));
check("Profiles card can add a named profile", html.includes('id="profile-new-btn"') && html.includes('id="profile-name-input"'));
check("Profiles can be renamed and deleted", html.includes('id="profile-rename-btn"') && html.includes('id="profile-delete-btn"'));
check("profile cap is 8", /MAX_PROFILES\s*=\s*8/.test(js));
check("switching a profile writes userProfile", /async function setActiveProfile[\s\S]*userProfile:\s*data/.test(js));
check("empty store seeds Personal, Work, Family", js.includes('profiles.Work = {}') && js.includes('profiles.Family = {}'));

const extractStart = js.indexOf("async function handleUploadedFile");
const extractEnd = js.indexOf("dropZone?.addEventListener");
const extractFn = extractStart !== -1 && extractEnd > extractStart ? js.slice(extractStart, extractEnd) : "";
check("extract path does not ADD_DOC_TO_VAULT", extractFn.includes("EXTRACT_DOCUMENT_TEXT") && !extractFn.includes("ADD_DOC_TO_VAULT"));
check("extract path does not saveProfileData", extractFn.includes("EXTRACT_DOCUMENT_TEXT") && !extractFn.includes("saveProfileData"));
check("Ready requires faces and names", js.includes("faceModelReady") && js.includes("nerModelReady") && js.includes("applyInitDone"));
check("Popup warms models on open", js.includes('type: "WARM_MODELS"') && js.includes("warmOnDeviceModels()"));
check("Startup copy is Loading models only", html.includes(">Loading models</span>") && js.includes('"Loading models"'));
check("Loaded hides the badge; fail says Not loaded", js.includes('type === "ready"') && js.includes("Not loaded") && !js.includes("On-device ready") && !js.includes("Faces failed"));
const fillClick = js.slice(js.indexOf("fillBtn.addEventListener"), js.indexOf("async function runPrivacyScan"));
check("Fill Form stops when nothing is saved", fillClick.includes("hasSavedFillData") && fillClick.includes("Save a profile first."));
check(
  "Fill Form leftovers do not call the laptop brain",
  fillClick.includes("statusForLocalFill") &&
    !fillClick.includes("runAgentLoop") &&
    !fillClick.includes("Asking local AI")
);
check(
  "Fill Form always sends FILL_MATCHING_FIELDS before leftover copy",
  fillClick.indexOf("FILL_MATCHING_FIELDS") !== -1 &&
    fillClick.indexOf("FILL_MATCHING_FIELDS") < fillClick.indexOf("statusForLocalFill")
);

const statusFnMatch = js.match(/function statusForLocalFill\([\s\S]*?\n\}/);
let statusForLocalFill;
if (statusFnMatch) {
  const ctx = {};
  require("vm").createContext(ctx);
  require("vm").runInContext(statusFnMatch[0] + "\nthis.statusForLocalFill = statusForLocalFill;", ctx);
  statusForLocalFill = ctx.statusForLocalFill;
}
check("statusForLocalFill is a pure helper", typeof statusForLocalFill === "function");
check(
  "partial fill keeps written fields and warns about the rest",
  typeof statusForLocalFill === "function" &&
    statusForLocalFill(4, 3).kind === "warn" &&
    statusForLocalFill(4, 3).text === "Filled 4 field(s). Not enough data available to fill the rest."
);
check(
  "complete fill is success, not a leftover warning",
  typeof statusForLocalFill === "function" &&
    statusForLocalFill(6, 0).kind === "success" &&
    /Filled 6 field\(s\)/.test(statusForLocalFill(6, 0).text)
);
check(
  "zero matches warn without claiming a fill",
  typeof statusForLocalFill === "function" &&
    statusForLocalFill(0, 8).text === "Not enough data available to fill form." &&
    statusForLocalFill(0, 8).kind === "warn"
);
check(
  "Settings reports local Ollama via the gateway",
  html.includes('id="local-llm-status"') &&
    js.includes("GET_GATEWAY_STATUS") &&
    js.includes("ollamaUp")
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
