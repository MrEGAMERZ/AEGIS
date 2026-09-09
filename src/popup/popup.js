// Popup script — Controls extension settings, voice, documents, profiles, and triggers agent

import { toBase64, detectDocFormat, MAX_DOCUMENT_BYTES } from "../shared/file-helpers.js";

// ── Tab Navigation ────────────────────────────────────────────────
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    tab.classList.add("active");
    const target = document.getElementById(`tab-${tab.dataset.tab}`);
    if (target) target.classList.add("active");
  });
});

const statusEl    = document.getElementById("status");
const runBtn      = document.getElementById("run-btn");
const scanBtn     = document.getElementById("scan-btn");
const fillBtn     = document.getElementById("fill-btn");
const modelStatus = document.getElementById("model-status");
const receiptEl   = document.getElementById("receipt");
const previewWrap = document.getElementById("preview-wrap");
const previewImg  = document.getElementById("sanitize-preview");
const pipelineEl  = document.getElementById("pipeline");

const MAX_AGENT_STEPS = 10;
const AGENT_STEP_DELAY_MS = 400;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function withStuckHint(work, msg) {
  const t = setTimeout(() => setStatus(msg, "active"), 15000);
  return Promise.resolve().then(() => work()).finally(() => clearTimeout(t));
}

// ── Status helpers ────────────────────────────────────────────────
function setStatus(message, type = "active") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}
function clearStatus() { statusEl.className = "status"; statusEl.textContent = ""; }

// ── Privacy Receipt ───────────────────────────────────────────────
function showReceipt(receipt) {
  if (!receipt) return;
  document.getElementById("r-fields").textContent =
    (receipt.masked.passwordFields || 0) + (receipt.masked.piiSpans || 0) > 0
      ? `${receipt.masked.passwordFields} field(s), ${receipt.masked.piiSpans} span(s)`
      : "None detected";
  document.getElementById("r-faces").textContent = receipt.masked.faces > 0 ? `${receipt.masked.faces}` : "None detected";
  document.getElementById("r-pii").textContent = receipt.masked.piiSpans > 0 ? `${receipt.masked.piiSpans}` : "None detected";
  document.getElementById("r-total").textContent = receipt.totalMs ? `${receipt.totalMs}ms` : "--";

  const badges = document.getElementById("r-badges");
  badges.innerHTML = "";
  const latency = receipt.latencyMs || {};
  for (const [label, ms] of [["Capture", latency.capture], ["DOM scan", latency.domScan], ["Inference", latency.inference], ["VLM", latency.vlm]]) {
    if (ms == null) continue;
    const b = document.createElement("span");
    b.className = "badge-pill" + (ms > 1500 ? " warn" : "");
    b.textContent = `${label}: ${ms}ms`;
    badges.appendChild(b);
  }
  receiptEl.classList.add("visible");
}

function showSanitizedPreview(dataUrl) {
  if (typeof dataUrl !== "string" || dataUrl.indexOf("data:image/") !== 0) {
    previewWrap.classList.remove("visible");
    previewImg.removeAttribute("src");
    return;
  }
  previewImg.src = dataUrl;
  previewWrap.classList.add("visible");
}

function setPipeline(stage, options = {}) {
  const steps = { capture: document.getElementById("step-capture"), redact: document.getElementById("step-redact"), vlm: document.getElementById("step-vlm") };
  const includeVlm = options.includeVlm !== false;
  if (steps.vlm) steps.vlm.style.display = includeVlm ? "" : "none";
  if (!stage) {
    pipelineEl.classList.remove("visible");
    Object.values(steps).forEach((el) => { if (el) el.className = "pipeline-step"; });
    return;
  }
  pipelineEl.classList.add("visible");
  const order = includeVlm ? ["capture", "redact", "vlm"] : ["capture", "redact"];
  const idx = order.indexOf(stage);
  order.forEach((name, i) => { if (steps[name]) steps[name].className = "pipeline-step" + (i < idx ? " done" : i === idx ? " active" : ""); });
}

async function loadLastReceipt() {
  try {
    const receipt = await chrome.runtime.sendMessage({ type: "GET_LAST_RECEIPT" });
    if (receipt) showReceipt(receipt);
  } catch {}
}

// ── Load saved config ─────────────────────────────────────────────
async function loadConfig() {
  const config = await chrome.runtime.sendMessage({
    type: "GET_CONFIG",
    keys: ["vlmEndpoint", "vlmModel", "faceDetection", "passwordDetection", "piiDetection", "userProfile"],
  });
  document.getElementById("vlm-endpoint").value = config.vlmEndpoint || "http://localhost:8000/v1/chat/completions";
  document.getElementById("vlm-model").value = config.vlmModel || "qwen2.5vl:7b";
  document.getElementById("face-detection").checked = config.faceDetection !== false;
  const faceScanToggle = document.getElementById("face-scan-toggle");
  if (faceScanToggle) faceScanToggle.checked = config.faceDetection !== false;
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked = config.piiDetection !== false;
  if (config.userProfile !== undefined && config.userProfile !== null) {
    const el = document.getElementById("profile-input");
    if (el) el.value = typeof config.userProfile === "string" ? config.userProfile : JSON.stringify(config.userProfile, null, 2);
  }
  await loadApiKeyStatus();
  await syncGatewayEndpoint();
}

async function syncGatewayEndpoint() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_GATEWAY_STATUS" });
    if (!status || !status.endpoint) return;
    const input = document.getElementById("vlm-endpoint");
    if (input && status.usingGateway) {
      input.value = status.endpoint;
      chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { vlmEndpoint: status.endpoint } }).catch(() => {});
    }
  } catch {}
}

async function loadApiKeyStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_VLM_API_KEY_STATUS" });
    const hint = document.getElementById("api-key-hint");
    const input = document.getElementById("vlm-api-key");
    input.value = "";
    if (status?.configured) {
      input.placeholder = "Key held in this session (re-enter to replace)";
      hint.textContent = "Session-only. Not stored on disk.";
    } else {
      input.placeholder = "API key (Gemini / hosted VLM)";
      hint.textContent = "Session-only. Leave empty for local Ollama.";
    }
  } catch {}
}

function setupConfigListeners() {
  const inputs = [
    { id: "vlm-endpoint", key: "vlmEndpoint" },
    { id: "vlm-model", key: "vlmModel" },
    { id: "password-detection", key: "passwordDetection" },
    { id: "pii-detection", key: "piiDetection" },
  ];
  for (const { id, key } of inputs) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => {
      chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { [key]: el.type === "checkbox" ? el.checked : el.value } });
    });
  }
  const faceIds = ["face-detection", "face-scan-toggle"];
  for (const id of faceIds) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("change", () => {
      const on = el.checked;
      for (const otherId of faceIds) {
        const other = document.getElementById(otherId);
        if (other && other !== el) other.checked = on;
      }
      chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { faceDetection: on } });
    });
  }
  document.getElementById("vlm-api-key").addEventListener("change", (e) => {
    const vlmApiKey = e.target.value;
    e.target.value = "";
    chrome.runtime.sendMessage({ type: "SET_VLM_API_KEY", vlmApiKey }).then(() => loadApiKeyStatus());
  });
}

// ── Model Status ──────────────────────────────────────────────────
function updateModelStatus(status, type) {
  modelStatus.textContent = status;
  modelStatus.className = `model-status ${type}`;
}

function formatVlmOfflineMessage(vlmError) {
  const msg = String(vlmError || "");
  if (msg.includes("Failed to fetch") || msg.includes("unreachable") || msg.includes("ECONNREFUSED") || /VLM API error:\s*5\d\d/.test(msg))
    return "VLM optional -- local redaction succeeded. Use Privacy scan anytime without Ollama; Run Agent needs a running VLM.";
  if (/\b403\b/.test(msg))
    return "Ollama blocked the extension (403). Use the local gateway: http://localhost:8000/v1/chat/completions. " + msg;
  if (msg.includes("timed out")) return "The vision model is still running or stuck. Wait and try again. " + msg;
  return "VLM unavailable: " + msg;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "INIT_PROGRESS") {
    updateModelStatus("Loading...", "loading");
    setStatus(msg.status || "Loading on-device models...", "active");
  }
  if (msg.type === "INIT_DONE") {
    updateModelStatus(msg.faceModelReady ? "On-device ready" : "On-device failed", msg.faceModelReady ? "ready" : "failed");
  }
});

// ── Profile Parsing ───────────────────────────────────────────────
const PROFILE_KEYS = [
  "fullName", "firstName", "lastName", "email", "phone", "dob", "gender",
  "addressLine1", "addressLine2", "city", "state", "pincode", "country",
  "nationality", "college", "rollNumber", "course", "branch", "guardianName",
  "occupation", "annualIncome",
];
const KEY_LABELS = {
  fullName: "Full name", firstName: "First name", lastName: "Last name",
  email: "Email", phone: "Phone", dob: "Date of birth", gender: "Gender",
  addressLine1: "Address line 1", addressLine2: "Address line 2",
  city: "City", state: "State", pincode: "PIN code", country: "Country",
  nationality: "Nationality", college: "College / institution",
  rollNumber: "Roll number", course: "Course", branch: "Branch",
  guardianName: "Guardian name", occupation: "Occupation", annualIncome: "Annual income",
};
function labelFor(k) { return KEY_LABELS[k] || k; }

function extractProfileFromText(text) {
  const extracted = {};
  if (!text) return extracted;
  try { const j = JSON.parse(text); for (const k of PROFILE_KEYS) { if (j[k]) extracted[k] = String(j[k]).trim(); else if (j[KEY_LABELS[k]]) extracted[k] = String(j[KEY_LABELS[k]]).trim(); } if (Object.keys(extracted).length > 0) return extracted; } catch {}
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) extracted.email = emailMatch[0];
  const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) extracted.phone = phoneMatch[0].replace(/\D/g, "").slice(-10);
  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth\s*Date)[\s:]*(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/i);
  if (dobMatch) extracted.dob = dobMatch[1];
  const nameMatch = text.match(/(?:Full\s*Name|Name|Mera\s*naam|My\s*name\s*is)[\s:]*([A-Za-z\s]{3,35})/i);
  if (nameMatch) { const n = nameMatch[1].replace(/hai|is|and|email|phone/gi, "").trim(); if (n.length >= 3) extracted.fullName = n; }
  const cityMatch = text.match(/(?:City|Location|Rehta\s*hoon|Raho)[\s:]*([A-Za-z\s]{3,20})/i);
  if (cityMatch) { const c = cityMatch[1].replace(/hai|in|is/gi, "").trim(); if (c) extracted.city = c; }
  const stateMatch = text.match(/(?:State)[\s:]*([A-Za-z\s]{3,20})/i);
  if (stateMatch) extracted.state = stateMatch[1].trim();
  const pinMatch = text.match(/(?:PIN|Pincode|Zip)[\s:]*(\d{6})/i);
  if (pinMatch) extracted.pincode = pinMatch[1];
  const collegeMatch = text.match(/(?:College|University|Institution)[\s:]*([A-Za-z\s]{3,40})/i);
  if (collegeMatch) extracted.college = collegeMatch[1].trim();
  const incomeMatch = text.match(/(?:Income|Salary)[\s:]*(\d{5,10})/i);
  if (incomeMatch) extracted.annualIncome = incomeMatch[1];
  return extracted;
}

function parseUserProfile(raw) {
  const text = raw.trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed; try { parsed = JSON.parse(text); } catch { return { error: "Profile JSON is invalid." }; }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return { profile: parsed };
    return { error: "Profile must be a JSON object." };
  }
  if (!text) return { error: "Profile is empty." };
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries = {}; let validLines = 0;
  for (const line of lines) {
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) return { profile: { notes: text } };
    const key = line.slice(0, sepIdx).trim(); const value = line.slice(sepIdx + 1).trim();
    if (!key) continue; entries[key] = value; validLines++;
  }
  if (validLines > 0) return { profile: entries };
  return { error: "Could not parse profile." };
}

// ── Multi-Profile System ──────────────────────────────────────────
async function getProfile() {
  const stored = await chrome.storage.local.get(["aegisCurrentProfile", "aegisProfiles", "userProfile"]);
  const activeName = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  if (profiles[activeName]) return profiles[activeName];
  return stored.userProfile || {};
}

async function saveProfileData(profile) {
  const stored = await chrome.storage.local.get(["aegisCurrentProfile", "aegisProfiles"]);
  const activeName = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  profiles[activeName] = profile;
  await chrome.storage.local.set({ aegisProfiles: profiles, userProfile: profile });
}

async function renderProfile() {
  const profile = await getProfile();
  const profileList = document.getElementById("profile-list");
  profileList.innerHTML = "";
  const entries = Object.keys(profile).filter((k) => k !== "_skipped").map((k) => [k, profile[k]]).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) { profileList.innerHTML = '<div class="p-empty">No details saved yet. Use Voice, Demo, or Upload!</div>'; }
  for (const [key, val] of entries) {
    const row = document.createElement("div"); row.className = "p-row";
    const input = document.createElement("input"); input.type = "text"; input.value = typeof val === "object" ? val.value : val; input.placeholder = labelFor(key);
    input.addEventListener("change", async () => { const p = await getProfile(); const v = input.value.trim(); if (!v) delete p[key]; else p[key] = v; await saveProfileData(p); renderProfile(); });
    const del = document.createElement("button"); del.className = "p-del"; del.textContent = "X"; del.title = "Delete";
    del.addEventListener("click", async () => { const p = await getProfile(); delete p[key]; await saveProfileData(p); renderProfile(); });
    row.appendChild(input); row.appendChild(del); profileList.appendChild(row);
  }
}

// ── Inline Add Field ──────────────────────────────────────────────
document.getElementById("profile-add-btn")?.addEventListener("click", async () => {
  const profile = await getProfile();
  const emptyKeys = PROFILE_KEYS.filter((k) => !profile[k]);
  if (emptyKeys.length === 0) { setStatus("All fields already added.", "active"); return; }
  const sel = document.getElementById("profile-select-key");
  sel.innerHTML = '<option value="">-- Choose Field --</option>';
  for (const k of emptyKeys) { const o = document.createElement("option"); o.value = k; o.textContent = labelFor(k); sel.appendChild(o); }
  document.getElementById("profile-input-val").value = "";
  document.getElementById("add-field-card").style.display = "block";
  document.getElementById("profile-action-btns").style.display = "none";
});
document.getElementById("profile-cancel-btn")?.addEventListener("click", () => {
  document.getElementById("add-field-card").style.display = "none";
  document.getElementById("profile-action-btns").style.display = "flex";
});
document.getElementById("profile-save-btn")?.addEventListener("click", async () => {
  const key = document.getElementById("profile-select-key")?.value;
  const val = document.getElementById("profile-input-val")?.value.trim();
  if (!key) { setStatus("Choose a field.", "error"); return; }
  if (!val) { setStatus("Enter a value.", "error"); return; }
  const profile = await getProfile(); profile[key] = val; await saveProfileData(profile);
  document.getElementById("add-field-card").style.display = "none";
  document.getElementById("profile-action-btns").style.display = "flex";
  clearStatus(); renderProfile();
});

// ── Profile Clear / Demo ──────────────────────────────────────────
document.getElementById("profile-clear-btn")?.addEventListener("click", async () => {
  if (!confirm("Clear all saved profile data?")) return;
  await saveProfileData({}); setStatus("Cleared.", "active"); renderProfile();
});
document.getElementById("profile-sample-btn")?.addEventListener("click", async () => {
  const sample = { fullName: "Aarav Sharma", email: "aarav.sharma@example.com", phone: "9876543210", dob: "1998-05-15", gender: "male", addressLine1: "123 MG Road, Koramangala", city: "Bengaluru", state: "Karnataka", pincode: "560034", college: "Indian Institute of Technology", occupation: "Software Engineer", annualIncome: "1200000" };
  const profile = await getProfile(); Object.assign(profile, sample); await saveProfileData(profile);
  setStatus("Loaded sample profile!", "success"); renderProfile();
});

// ── Multi-Profile Switcher ────────────────────────────────────────
document.getElementById("profile-switcher")?.addEventListener("change", async (e) => {
  await chrome.storage.local.set({ aegisCurrentProfile: e.target.value });
  setStatus(`Switched to: ${e.target.value}`, "success"); renderProfile();
});

// ── Export / Import ───────────────────────────────────────────────
document.getElementById("export-profile-btn")?.addEventListener("click", async () => {
  const profile = await getProfile();
  const stored = await chrome.storage.local.get("aegisCurrentProfile");
  const name = stored.aegisCurrentProfile || "Personal";
  const blob = new Blob([JSON.stringify({ profileName: name, data: profile }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `Aegis_${name}.json`; a.click(); URL.revokeObjectURL(url);
  setStatus(`Exported ${name} profile!`, "success");
});
document.getElementById("import-profile-btn")?.addEventListener("click", () => document.getElementById("import-file-input")?.click());
document.getElementById("import-file-input")?.addEventListener("change", async (e) => {
  const file = e.target.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const json = JSON.parse(evt.target.result); const data = json.data || json;
      const profile = await getProfile();
      for (const [k, v] of Object.entries(data)) { profile[k] = typeof v === "object" && v.value ? v : typeof v === "string" ? v : String(v); }
      await saveProfileData(profile); setStatus(`Imported from ${file.name}!`, "success"); renderProfile();
    } catch { setStatus("Invalid JSON file.", "error"); }
  };
  reader.readAsText(file);
});

// ── Quick Task Chips ──────────────────────────────────────────────
document.getElementById("chip-loan")?.addEventListener("click", () => { const el = document.getElementById("task-input"); if (el) el.value = "Fill out this loan application form"; });
document.getElementById("chip-contact")?.addEventListener("click", () => { const el = document.getElementById("task-input"); if (el) el.value = "Fill in the personal details"; });

// ── Save Profile (textarea) ───────────────────────────────────────
document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const raw = document.getElementById("profile-input").value;
  const result = parseUserProfile(raw);
  if (!result.profile) { setStatus(result.error, "error"); return; }
  await chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { userProfile: result.profile } });
  setStatus("Profile saved.", "success"); setTimeout(() => clearStatus(), 2000);
});

// ── Error Formatting ──────────────────────────────────────────────
function formatAgentError(code, message) {
  const t = message || "";
  if (code === "NO_CONTENT_SCRIPT") return `[${code}] ${t}`;
  if (code === "FACE_REDACTION_REQUIRED") {
    return `[${code}] Face redaction did not complete — unredacted faces cannot leave the device. ${t}`;
  }
  if (code === "NER_REDACTION_REQUIRED") {
    return `[${code}] NER redaction did not complete — unredacted PII cannot leave the device. ${t}`;
  }
  if (code === "TIMEOUT" || code === "INIT_FAILED") return `[${code}] On-device model init failed. ${t} Reload extension.`;
  if (code === "VLM_BAD_RESPONSE") return `[${code}] VLM did not return a usable action. ${t}`;
  if (code === "BAD_JSON") return `[${code}] Non-JSON response. ${t}`;
  if (code === "STRUCTURE_REMOTE_REJECTED") {
    return `[${code}] ${t} The analyzer only runs against the local model — switch the VLM endpoint back to http://localhost:8000.`;
  }
  if (code === "STRUCTURE_EMPTY_TEXT") return `[${code}] ${t}`;
  if (code === "STRUCTURE_TOO_LARGE") return `[${code}] ${t}`;
  if (code === "STRUCTURE_RATE_LIMITED") return `[${code}] ${t}`;
  if (code === "STRUCTURE_CONSENT_REQUIRED") {
    return "[consent] Re-enable 'Analyze with AI' and try again.";
  }
  return `[${code}] ${t}`;
}

function formatRuntimeDisconnect(err) {
  const msg = String(err?.message || err || "");
  if (msg.includes("Receiving end does not exist") || msg.includes("Could not establish connection"))
    return "[NO_CONTENT_SCRIPT] Refresh this tab, then try again.";
  return `Error: ${msg}`;
}

// ── Agent Loop ────────────────────────────────────────────────────
const DEFAULT_FILL_TASK = "Fill the visible form using my saved profile. Leave blank any field not in the profile.";

async function persistProfileFromTextarea() {
  const raw = document.getElementById("profile-input")?.value || "";
  if (raw.trim()) {
    const result = parseUserProfile(raw);
    if (!result.profile) return result.error || "Save a profile first.";
    await chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { userProfile: result.profile } });
    return null;
  }
  // Profile tab / Demo / upload write aegisProfiles. Sync that into
  // userProfile so Fill Form does not die on an empty notes textarea.
  const profile = await getProfile();
  const keys = profile && typeof profile === "object"
    ? Object.keys(profile).filter((k) => k !== "_skipped")
    : [];
  if (keys.length) {
    await chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { userProfile: profile } });
  }
  return null;
}

async function runAgentLoop(task) {
  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    const stepLabel = `Step ${step}/${MAX_AGENT_STEPS}`;
    setPipeline("capture");
    setStatus(`${stepLabel}: Capturing viewport and running local redaction...`);
    setPipeline("redact");
    const response = await withStuckHint(() => chrome.runtime.sendMessage({ type: "CAPTURE_AND_SANITIZE", task }), `${stepLabel}: Still working...`);
    if (response.error) { setPipeline(null); setStatus(formatAgentError(response.errorCode || "UNKNOWN", response.error), "error"); return; }
    if (response.receipt) showReceipt(response.receipt);
    showSanitizedPreview(response.sanitizedImage);
    setPipeline("vlm");
    if (response.vlmError) { setPipeline(null); setStatus(formatVlmOfflineMessage(response.vlmError), "warn"); return; }
    if (!response.action) { setPipeline(null); setStatus(`${stepLabel}: No action from VLM.`, "warn"); return; }
    setStatus(`${stepLabel}: VLM -> ${response.action.action}. Executing...`);
    const execResult = await chrome.runtime.sendMessage({ type: "EXECUTE_ACTION", action: response.action });
    if (execResult.error) { setPipeline(null); setStatus(`${stepLabel}: ${formatAgentError(execResult.errorCode || "UNKNOWN", execResult.error)}`, "error"); return; }
    if (response.action.action === "fill_many") {
      setPipeline(null);
      setStatus(`${stepLabel}: Filled ${execResult.filled ?? response.action.fields?.length ?? 0} field(s) from your profile and documents.`, "success");
      return;
    }
    if (response.action.action === "done") { setPipeline(null); setStatus(`${stepLabel}: Done: ${response.action.summary}`, "success"); return; }
    if (step >= MAX_AGENT_STEPS) { setPipeline(null); setStatus(`${stepLabel}: Step cap reached.`, "warn"); return; }
    setStatus(`${stepLabel}: Executed ${response.action.action}. Replanning...`);
    await sleep(AGENT_STEP_DELAY_MS);
  }
}

// ── Button Handlers ───────────────────────────────────────────────
fillBtn.addEventListener("click", async () => {
  const saveErr = await persistProfileFromTextarea();
  if (saveErr) { setStatus(saveErr, "error"); return; }
  const task = document.getElementById("task-input").value.trim() || DEFAULT_FILL_TASK;
  document.getElementById("task-input").value = task;
  fillBtn.disabled = true; scanBtn.disabled = true; runBtn.disabled = true; clearStatus(); previewWrap.classList.remove("visible");
  try {
    setStatus("Filling matching fields from your profile and documents…", "active");
    const local = await chrome.runtime.sendMessage({ type: "FILL_MATCHING_FIELDS" });
    if (local?.error) {
      setStatus(formatAgentError(local.errorCode || "UNKNOWN", local.error), "error");
      return;
    }
    const filled = local?.filled || 0;
    const remaining = local?.remaining ?? 0;
    if (filled > 0 && remaining === 0) {
      setStatus(`Filled ${filled} field(s) from your profile and documents.`, "success");
      return;
    }
    if (filled > 0) {
      setStatus(`Filled ${filled} field(s). Asking local AI for the rest…`, "active");
    }
    await runAgentLoop(task);
  } catch (err) { setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error"); }
  finally { fillBtn.disabled = false; scanBtn.disabled = false; runBtn.disabled = false; }
});

async function runPrivacyScan(opts = {}) {
  const forceFaces = opts.forceFaces === true;
  scanBtn.disabled = true; fillBtn.disabled = true; runBtn.disabled = true; clearStatus(); previewWrap.classList.remove("visible");
  setPipeline("capture", { includeVlm: false }); setStatus("Capturing viewport and running local redaction...");
  try {
    setPipeline("redact", { includeVlm: false });
    const result = await withStuckHint(
      () => chrome.runtime.sendMessage({ type: "SCAN_AND_OVERLAY", forceFaces }),
      "Still scanning..."
    );
    if (result.error) { setPipeline(null); setStatus(formatAgentError(result.errorCode || "UNKNOWN", result.error), "error"); }
    else { if (result.receipt) showReceipt(result.receipt); showSanitizedPreview(result.sanitizedImage); setPipeline(null);
      const faces = result.receipt?.masked?.faces || 0; const fields = result.fieldCount || 0;
      const facesOn = forceFaces || document.getElementById("face-scan-toggle")?.checked !== false;
      if (facesOn) {
        setStatus(`Secured ${fields} field(s) + ${faces} face(s).`, fields > 0 || faces > 0 ? "success" : "active");
      } else {
        setStatus(`Secured ${fields} field(s). Faces not scanned (toggle off).`, fields > 0 ? "success" : "active");
      }
    }
  } catch (err) { setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error"); }
  finally { scanBtn.disabled = false; fillBtn.disabled = false; runBtn.disabled = false; }
}

scanBtn.addEventListener("click", () => runPrivacyScan());

function enableFaceScanToggles() {
  const fillToggle = document.getElementById("face-scan-toggle");
  const settingsToggle = document.getElementById("face-detection");
  if (fillToggle) fillToggle.checked = true;
  if (settingsToggle) settingsToggle.checked = true;
  chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { faceDetection: true } }).catch(() => {});
}

function scanFacesNow() {
  enableFaceScanToggles();
  document.querySelector('.tab[data-tab="fill"]')?.click();
  return runPrivacyScan({ forceFaces: true });
}

document.getElementById("scan-faces-page-btn")?.addEventListener("click", scanFacesNow);
document.getElementById("scan-faces-now-btn")?.addEventListener("click", scanFacesNow);

runBtn.addEventListener("click", async () => {
  const task = document.getElementById("task-input").value.trim();
  if (!task) { setStatus("Enter a task description.", "error"); return; }
  const saveErr = await persistProfileFromTextarea();
  if (saveErr && saveErr !== "Profile is empty.") { setStatus(saveErr, "error"); return; }
  runBtn.disabled = true; scanBtn.disabled = true; fillBtn.disabled = true; clearStatus(); previewWrap.classList.remove("visible");
  try { await runAgentLoop(task); } catch (err) { setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error"); }
  finally { runBtn.disabled = false; scanBtn.disabled = false; fillBtn.disabled = false; }
});

// ── Voice Input ───────────────────────────────────────────────────
const voiceStartBtn = document.getElementById("voice-start-btn");
const voiceLangSelect = document.getElementById("voice-lang-select");
const voiceBox = document.getElementById("voice-box");
const voiceTranscript = document.getElementById("voice-transcript");
let recognition = null; let isRecording = false;

function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) { if (voiceStartBtn) voiceStartBtn.disabled = true; return null; }
  const rec = new SpeechRecognition(); rec.continuous = false; rec.interimResults = true;
  rec.onstart = () => { isRecording = true; voiceStartBtn?.classList.add("recording"); if (voiceBox) voiceBox.style.display = "block"; if (voiceTranscript) voiceTranscript.textContent = "Listening..."; };
  rec.onresult = (e) => { let t = ""; for (let i = e.resultIndex; i < e.results.length; ++i) t += e.results[i][0].transcript; if (voiceTranscript) voiceTranscript.textContent = `"${t}"`; if (e.results[e.results.length - 1].isFinal) processVoiceTranscript(t); };
  rec.onerror = (e) => { isRecording = false; voiceStartBtn?.classList.remove("recording"); if (voiceTranscript) voiceTranscript.textContent = `Error: ${e.error}`; };
  rec.onend = () => { isRecording = false; voiceStartBtn?.classList.remove("recording"); };
  return rec;
}

async function processVoiceTranscript(speechText) {
  const extracted = extractProfileFromText(speechText);
  if (Object.keys(extracted).length > 0) {
    const profile = await getProfile(); Object.assign(profile, extracted); await saveProfileData(profile);
    setStatus(`Voice: extracted ${Object.keys(extracted).length} field(s)!`, "success"); renderProfile();
  } else {
    const el = document.getElementById("task-input"); if (el) el.value = speechText;
    setStatus("Voice: used as task.", "active");
  }
}

voiceStartBtn?.addEventListener("click", async () => {
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); }
  catch { chrome.tabs.create({ url: chrome.runtime.getURL("src/voice/voice.html") }); return; }
  if (isRecording) { recognition?.stop(); return; }
  if (!recognition) recognition = initVoiceRecognition();
  if (recognition) { recognition.lang = voiceLangSelect?.value || "en-US"; try { recognition.start(); } catch { chrome.tabs.create({ url: chrome.runtime.getURL("src/voice/voice.html") }); } }
});

// ── Document Drop ─────────────────────────────────────────────────
// Every dropped file goes through the SAME on-device extraction pipeline
// (popup → background → offscreen document → { text, format }), so PDFs and
// DOCX files — which file.text() cannot read — extract exactly like text
// formats. The extracted text is shown in a preview; profile fields are then
// auto-extracted exactly as before (JSON auto-parses immediately; TXT/CSV/MD
// keep their regex extraction; PDF/DOCX now work instead of failing).
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("doc-file-input");

const MAX_PREVIEW_CHARS = 4000;

function formatBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function showDocPreview(text, meta = {}) {
  const wrap = document.getElementById("doc-preview-wrap");
  const body = document.getElementById("doc-preview-text");
  const metaEl = document.getElementById("doc-preview-meta");
  if (!wrap || !body || !metaEl) return;

  const truncated = text.length > MAX_PREVIEW_CHARS;
  body.textContent = truncated ? text.slice(0, MAX_PREVIEW_CHARS) + "\n…" : text;
  const bits = [];
  if (meta.format) bits.push(meta.format.toUpperCase());
  bits.push(`${text.length.toLocaleString()} chars`);
  if (truncated) bits.push(`showing first ${MAX_PREVIEW_CHARS.toLocaleString()}`);
  if (meta.name) bits.push(formatBytes(meta.size));
  metaEl.textContent = bits.join(" · ");
  wrap.style.display = "block";
}

function clearDocPreview() {
  const wrap = document.getElementById("doc-preview-wrap");
  if (wrap) wrap.style.display = "none";
}

async function handleUploadedFile(file) {
  if (!file) return;

  const format = detectDocFormat(file.name, file.type || "");
  if (!format) {
    setStatus(`Unsupported file: ${file.name}. On-device extraction supports PDF, DOCX, TXT, JSON, CSV, MD.`, "error");
    return;
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    setStatus(`${file.name} is ${formatBytes(file.size)} — over the ${Math.floor(MAX_DOCUMENT_BYTES / (1024 * 1024))} MB on-device limit.`, "error");
    return;
  }

  clearDocPreview();
  setStatus(`Extracting text from ${file.name}…`, "active");
  try {
    // MV3 cannot pass File objects through messaging — convert to base64 here.
    const arrayBufferBase64 = await toBase64(file);
    const res = await chrome.runtime.sendMessage({
      type: "EXTRACT_DOCUMENT_TEXT",
      file: { name: file.name, size: file.size, mimeType: file.type || "", arrayBufferBase64 },
    });

    if (!res || res.error) {
      setStatus(`Could not extract text from ${file.name}: ${(res && res.error) || "no response"}`, "error");
      return;
    }

    const text = String(res.text || "");
    showDocPreview(text, { format: res.format || format, name: file.name, size: file.size });

    // ── AI structuring + local vault (backend contract) ─────────────
    // The extracted TEXT (already produced on-device above) is sent ONLY to
    // the LOCAL VLM via STRUCTURE_DOCUMENT_TEXT — the backend refuses remote
    // endpoints before any request. Returned dynamic-key fields merge into the
    // active profile. The vault (aegisDocVault) keeps a scrubbed copy locally
    // for RAG-lite fill; nothing here ever leaves the device.
    const analyzeChecked = document.getElementById("analyze-with-ai")?.checked === true;
    const toVault = document.getElementById("save-to-vault")?.checked === true;

    if (toVault) {
      const v = await chrome.runtime.sendMessage({
        type: "ADD_DOC_TO_VAULT",
        docName: file.name,
        format: res.format || format,
        text,
      });
      if (v?.ok) setStatus(`Saved "${file.name}" to vault (${v.vault?.count ?? 0} docs).`, "success");
      else setStatus(`Vault: ${v?.error || "failed"}`, "error");
    }

    if (analyzeChecked) {
      setStatus(`Analyzing ${file.name} with local AI…`, "active");
      // Per-upload consent: the backend refuses STRUCTURE_DOCUMENT_TEXT unless
      // msg.consented === true (or an explicit docConsent storage flag). The
      // popup never persists this — every upload starts from "off", so consent
      // is explicit per upload and revocable by simply leaving the box clear.
      const r = await chrome.runtime.sendMessage({
        type: "STRUCTURE_DOCUMENT_TEXT",
        text,
        consented: analyzeChecked,
      });
      if (r?.error) { setStatus(formatAgentError(r.errorCode || "UNKNOWN", r.error), "error"); return; }
      const fields = r.fields || {};
      const keys = Object.keys(fields);
      if (keys.length === 0) { setStatus(`AI found no fields in ${file.name}.`, "warn"); return; }
      const profile = await getProfile();
      let added = 0;
      for (const [k, v] of Object.entries(fields)) { if (profile[k] === undefined) added++; profile[k] = v; }
      await saveProfileData(profile); renderProfile();
      setStatus(`AI extracted ${keys.length} field(s) from ${file.name}${toVault ? " (also in vault)" : ""}.`, "success");
      return; // the AI path is authoritative — skip the legacy regex merge
    }

    const extracted = extractProfileFromText(text);
    if (Object.keys(extracted).length === 0) {
      setStatus(`No profile fields found in ${file.name} (${text.length.toLocaleString()} chars extracted).`, "warn");
      return;
    }
    const profile = await getProfile();
    Object.assign(profile, extracted);
    await saveProfileData(profile);
    setStatus(`Extracted ${Object.keys(extracted).length} field(s) from ${file.name}!`, "success");
    renderProfile();
  } catch (err) {
    const msg = String(err && err.message ? err.message : err || "");
    if (/Receiving end does not exist|Could not establish connection|message port closed/i.test(msg)) {
      setStatus("Extraction stopped — the popup closed mid-read. Re-drop the file.", "warn");
    } else {
      setStatus(`Extraction failed: ${msg}`, "error");
    }
  }
}

dropZone?.addEventListener("click", () => fileInput?.click());
fileInput?.addEventListener("change", (e) => { const f = e.target.files?.[0]; if (f) handleUploadedFile(f); });
dropZone?.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone?.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone?.addEventListener("drop", (e) => { e.preventDefault(); dropZone.classList.remove("dragover"); const f = e.dataTransfer?.files?.[0]; if (f) handleUploadedFile(f); });

// ── Dashboard Link ────────────────────────────────────────────────
document.getElementById("dashboard-btn")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
});

// ── Theme Switcher ────────────────────────────────────────────────
const themeToggleBtn = document.getElementById("theme-toggle-btn");
async function initTheme() {
  const stored = await chrome.storage.local.get("aegisTheme");
  if (stored.aegisTheme === "dark") { document.body.classList.add("dark-mode"); if (themeToggleBtn) themeToggleBtn.textContent = "L"; }
}
themeToggleBtn?.addEventListener("click", async () => {
  const isDark = document.body.classList.toggle("dark-mode");
  if (themeToggleBtn) themeToggleBtn.textContent = isDark ? "L" : "D";
  await chrome.storage.local.set({ aegisTheme: isDark ? "dark" : "light" });
});

// ── Onboarding Tour ───────────────────────────────────────────────
const TOUR_STEPS = [
  { title: "Welcome to Aegis!", body: "Privacy Scan outlines faces and redacts PII on-device before any AI analysis. Daily browsing does not scan photos of other people." },
  { title: "Setup Your Profile", body: "Click Demo or speak in your native language to save details." },
  { title: "Instant Autofill", body: "Open any web form and press Ctrl+Shift+F or click Fill Form!" },
];
let currentTourStep = 1;
async function initTour() {
  const stored = await chrome.storage.local.get("aegisTourDone");
  if (!stored.aegisTourDone) { document.getElementById("tour-card").style.display = "block"; updateTourUI(); }
}
function updateTourUI() {
  const step = TOUR_STEPS[currentTourStep - 1];
  document.getElementById("tour-title").textContent = step.title;
  document.getElementById("tour-step-badge").textContent = `Step ${currentTourStep}/3`;
  document.getElementById("tour-body-text").textContent = step.body;
  document.getElementById("tour-next-btn").textContent = currentTourStep === 3 ? "Got It!" : "Next";
}
document.getElementById("tour-next-btn")?.addEventListener("click", async () => {
  if (currentTourStep < 3) { currentTourStep++; updateTourUI(); }
  else { document.getElementById("tour-card").style.display = "none"; await chrome.storage.local.set({ aegisTourDone: true }); }
});
document.getElementById("tour-skip-btn")?.addEventListener("click", async () => {
  document.getElementById("tour-card").style.display = "none"; await chrome.storage.local.set({ aegisTourDone: true });
});

// ── Init ──────────────────────────────────────────────────────────
initTheme();
initTour();
loadConfig();
setupConfigListeners();
loadLastReceipt();
renderProfile();
