// Popup script — Controls extension settings, voice, documents, profiles, and triggers agent

import { toBase64, detectDocFormat, MAX_DOCUMENT_BYTES } from "../shared/file-helpers.js";
import {
  PROFILE_KEYS,
  KEY_LABELS,
  extractProfileFromText,
  toUserProfileFields,
} from "../shared/extract-profile.js";

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
const stopScanBtn = document.getElementById("stop-scan-btn");
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
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked = config.piiDetection !== false;
  // Profile fields render from aegisProfiles / userProfile via renderProfile().
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
  document.getElementById("face-detection")?.addEventListener("change", (e) => {
    chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { faceDetection: e.target.checked } });
  });
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

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "INIT_PROGRESS") {
      updateModelStatus("Loading...", "loading");
      setStatus(msg.status || "Loading on-device models...", "active");
    }
    if (msg.type === "INIT_DONE") {
      updateModelStatus(msg.faceModelReady ? "On-device ready" : "On-device failed", msg.faceModelReady ? "ready" : "failed");
    }
  });
}

function labelFor(k) { return KEY_LABELS[k] || k; }

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
  if (entries.length === 0) { profileList.innerHTML = '<div class="p-empty">No details yet. Drop a PDF or text file above.</div>'; }
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
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = "";
  const format = detectDocFormat(file.name, file.type);
  if (format === "json") {
    try {
      const json = JSON.parse(await file.text());
      const data = json.data || json;
      if (data && typeof data === "object" && !Array.isArray(data) && (json.profileName || json.data)) {
        const profile = await getProfile();
        for (const [k, v] of Object.entries(data)) {
          profile[k] = typeof v === "object" && v && v.value ? v.value : typeof v === "string" ? v : String(v);
        }
        await saveProfileData(profile);
        setStatus(`Imported ${file.name}.`, "success");
        renderProfile();
        return;
      }
    } catch {
      // fall through to the document pipeline
    }
  }
  await handleUploadedFile(file);
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
  if (code === "TIMEOUT") {
    if (/VLM|server timed out|vision model/i.test(t)) {
      return `[TIMEOUT] Local model timed out. Keep the gateway on :8000 and retry. ${t}`;
    }
    return `[TIMEOUT] On-device model timed out. ${t} Wait, then retry; reload the extension if this persists.`;
  }
  if (code === "INIT_FAILED") return `[${code}] On-device model init failed. ${t} Reload extension.`;
  if (code === "VLM_BAD_RESPONSE") return `[${code}] VLM did not return a usable action. ${t}`;
  if (code === "BAD_JSON") return `[${code}] Non-JSON response. ${t}`;
  if (code === "STRUCTURE_REMOTE_REJECTED") {
    return `[${code}] ${t} The analyzer only runs against the local model — switch the VLM endpoint back to http://localhost:8000.`;
  }
  if (code === "STRUCTURE_EMPTY_TEXT") return `[${code}] ${t}`;
  if (code === "STRUCTURE_TOO_LARGE") return `[${code}] ${t}`;
  if (code === "STRUCTURE_RATE_LIMITED") return `[${code}] ${t}`;
  if (code === "STRUCTURE_CONSENT_REQUIRED") {
    return "[consent] Check 'Structure with local AI' and try again.";
  }
  if (code === "SCAN_ABORTED") return "Scan stopped.";
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

let workGeneration = 0;

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

async function runAgentLoop(task, token) {
  const mine = token ?? workGeneration;
  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_GATEWAY_STATUS" });
    if (mine !== workGeneration) return;
    if (!status?.ok && !status?.usingGateway) {
      setPipeline(null);
      setStatus(formatVlmOfflineMessage("Failed to fetch"), "warn");
      return;
    }
  } catch {
    if (mine !== workGeneration) return;
    setPipeline(null);
    setStatus(formatVlmOfflineMessage("Failed to fetch"), "warn");
    return;
  }
  for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
    if (mine !== workGeneration) return;
    const stepLabel = `Step ${step}/${MAX_AGENT_STEPS}`;
    setPipeline("capture");
    setStatus(`${stepLabel}: Capturing viewport and running local redaction...`);
    setPipeline("redact");
    const response = await withStuckHint(() => chrome.runtime.sendMessage({ type: "CAPTURE_AND_SANITIZE", task }), `${stepLabel}: Still working... Click Stop to cancel.`);
    if (mine !== workGeneration) return;
    if (response?.aborted || response?.errorCode === "SCAN_ABORTED") {
      setPipeline(null);
      setStatus("Stopped.", "warn");
      return;
    }
    if (response.error) { setPipeline(null); setStatus(formatAgentError(response.errorCode || "UNKNOWN", response.error), "error"); return; }
    if (response.receipt) showReceipt(response.receipt);
    showSanitizedPreview(response.sanitizedImage);
    setPipeline("vlm");
    if (response.vlmError) { setPipeline(null); setStatus(formatVlmOfflineMessage(response.vlmError), "warn"); return; }
    if (!response.action) { setPipeline(null); setStatus(`${stepLabel}: No action from VLM.`, "warn"); return; }
    setStatus(`${stepLabel}: VLM -> ${response.action.action}. Executing...`);
    const execResult = await chrome.runtime.sendMessage({ type: "EXECUTE_ACTION", action: response.action });
    if (mine !== workGeneration) return;
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

function setBusy(mode) {
  const busy = mode != null;
  scanBtn.disabled = busy;
  fillBtn.disabled = busy;
  runBtn.disabled = busy;
  if (stopScanBtn) {
    stopScanBtn.disabled = !busy;
    stopScanBtn.textContent = mode && mode !== "scan" ? "Stop" : "Stop scan";
    stopScanBtn.title = busy
      ? (mode === "scan" ? "Stop the in-progress Privacy Scan" : "Stop the in-progress action")
      : "Stop an in-progress Privacy Scan";
  }
}

async function abortBusyWork() {
  const token = ++workGeneration;
  setPipeline(null);
  setStatus("Stopped.", "warn");
  try {
    await chrome.runtime.sendMessage({ type: "ABORT_SCAN" });
  } catch {
    // Background may already be gone; UI resets after this returns.
  }
  if (token === workGeneration) setBusy(null);
}

stopScanBtn?.addEventListener("click", () => abortBusyWork());

// ── Button Handlers ───────────────────────────────────────────────
fillBtn.addEventListener("click", async () => {
  const saveErr = await persistProfileFromTextarea();
  if (saveErr) { setStatus(saveErr, "error"); return; }
  const task = document.getElementById("task-input").value.trim() || DEFAULT_FILL_TASK;
  document.getElementById("task-input").value = task;
  const token = ++workGeneration;
  setBusy("fill");
  clearStatus(); previewWrap.classList.remove("visible");
  try {
    setStatus("Filling matching fields from your profile and documents…", "active");
    const local = await chrome.runtime.sendMessage({ type: "FILL_MATCHING_FIELDS" });
    if (token !== workGeneration) return;
    if (local?.error) {
      setStatus(formatAgentError(local.errorCode || "UNKNOWN", local.error), "error");
      return;
    }
    const filled = local?.filled || 0;
    const remaining = local?.remaining ?? 0;
    const gatewayReady = local?.gatewayReady === true;
    if (!gatewayReady || remaining === 0) {
      if (filled > 0) {
        const extra = remaining > 0 && !gatewayReady
          ? " Remaining fields left blank (local AI offline)."
          : remaining > 0
            ? " Remaining fields left blank."
            : "";
        setStatus(`Filled ${filled} field(s) from your profile and documents.${extra}`, "success");
        return;
      }
      setStatus("No matching profile fields. Save a profile or upload a document first.", "warn");
      return;
    }
    if (filled > 0) {
      setStatus(`Filled ${filled} field(s). Asking local AI for the rest…`, "active");
    }
    await runAgentLoop(task, token);
  } catch (err) {
    if (token !== workGeneration) return;
    setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error");
  }
  finally { if (token === workGeneration) setBusy(null); }
});

async function runPrivacyScan(opts = {}) {
  const forceFaces = opts.forceFaces === true;
  const token = ++workGeneration;
  setBusy("scan");
  clearStatus();
  previewWrap.classList.remove("visible");
  setPipeline("capture", { includeVlm: false });
  setStatus("Capturing viewport and running local redaction...");
  try {
    setPipeline("redact", { includeVlm: false });
    const result = await withStuckHint(
      () => chrome.runtime.sendMessage({ type: "SCAN_AND_OVERLAY", forceFaces }),
      "Still scanning... Click Stop scan to cancel."
    );
    if (token !== workGeneration) return;
    if (result?.aborted || result?.errorCode === "SCAN_ABORTED") {
      setPipeline(null);
      setStatus("Scan stopped.", "warn");
      return;
    }
    if (result?.error) {
      setPipeline(null);
      setStatus(formatAgentError(result.errorCode || "UNKNOWN", result.error), "error");
      return;
    }
    if (result.receipt) showReceipt(result.receipt);
    showSanitizedPreview(result.sanitizedImage);
    setPipeline(null);
    const faces = result.receipt?.masked?.faces || 0;
    const fields = result.fieldCount || 0;
    const facesOn = forceFaces || document.getElementById("face-detection")?.checked !== false;
    if (facesOn) {
      setStatus(`Secured ${fields} field(s) + ${faces} face(s).`, fields > 0 || faces > 0 ? "success" : "active");
    } else {
      setStatus(`Secured ${fields} field(s). Faces not scanned (toggle off).`, fields > 0 ? "success" : "active");
    }
  } catch (err) {
    if (token !== workGeneration) return;
    setPipeline(null);
    setStatus(formatRuntimeDisconnect(err), "error");
  } finally {
    if (token === workGeneration) setBusy(null);
  }
}

scanBtn.addEventListener("click", () => runPrivacyScan());

function enableFaceScanToggles() {
  const settingsToggle = document.getElementById("face-detection");
  if (settingsToggle) settingsToggle.checked = true;
  chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { faceDetection: true } }).catch(() => {});
}

function scanFacesNow() {
  enableFaceScanToggles();
  document.querySelector('.tab[data-tab="fill"]')?.click();
  return runPrivacyScan({ forceFaces: true });
}

document.getElementById("scan-faces-page-btn")?.addEventListener("click", scanFacesNow);

runBtn.addEventListener("click", async () => {
  const task = document.getElementById("task-input").value.trim();
  if (!task) { setStatus("Enter a task description.", "error"); return; }
  const saveErr = await persistProfileFromTextarea();
  if (saveErr && saveErr !== "Profile is empty.") { setStatus(saveErr, "error"); return; }
  const token = ++workGeneration;
  setBusy("agent");
  clearStatus(); previewWrap.classList.remove("visible");
  try { await runAgentLoop(task, token); } catch (err) {
    if (token !== workGeneration) return;
    setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error");
  }
  finally { if (token === workGeneration) setBusy(null); }
});

// ── Document Drop ─────────────────────────────────────────────────
// Extract on-device, then ASK before anything is persisted. Save writes
// structured fields into the Profile list and the document text into
// aegisDocVault (local knowledge on this machine). Discard drops RAM only.
const dropZone = document.getElementById("drop-zone");
const fileInput = document.getElementById("doc-file-input");

const MAX_PREVIEW_CHARS = 4000;
let pendingUpload = null;

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

function showFieldPreview(fields) {
  const el = document.getElementById("doc-field-preview");
  if (!el) return;
  el.textContent = "";
  const entries = Object.entries(fields || {}).sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    el.innerHTML = '<div class="p-empty">No phone, email, or other fields found. Save still keeps the document text as local knowledge.</div>';
    return;
  }
  for (const [key, val] of entries) {
    const row = document.createElement("div");
    row.className = "fp-row";
    const k = document.createElement("span");
    k.className = "fp-key";
    k.textContent = key;
    const v = document.createElement("span");
    v.className = "fp-val";
    v.textContent = String(val);
    row.appendChild(k);
    row.appendChild(v);
    el.appendChild(row);
  }
}

function showSavePrompt() {
  const card = document.getElementById("doc-save-card");
  if (card) card.style.display = "block";
}

function hideSavePrompt() {
  pendingUpload = null;
  const card = document.getElementById("doc-save-card");
  if (card) card.style.display = "none";
  const el = document.getElementById("doc-field-preview");
  if (el) el.textContent = "";
}

async function confirmSaveExtracted() {
  if (!pendingUpload) {
    setStatus("Nothing to save. Drop a document first.", "warn");
    return;
  }
  const { name, format, text, fields, usedAi, aiError } = pendingUpload;
  const fieldCount = Object.keys(fields || {}).length;
  const profile = await getProfile();
  if (fieldCount) Object.assign(profile, fields);
  await saveProfileData(profile);

  const v = await chrome.runtime.sendMessage({
    type: "ADD_DOC_TO_VAULT",
    docName: name,
    format,
    text,
  });
  if (v?.error) {
    setStatus(`Profile saved, but local knowledge failed: ${v.error}`, "warn");
  }

  await renderProfile();
  await renderVaultList();
  hideSavePrompt();
  clearDocPreview();
  document.querySelector('.tab[data-tab="profile"]')?.click();
  const how = usedAi ? "Local AI" : "on-device extract";
  const extra = aiError && !usedAi ? ` AI skipped: ${aiError}` : "";
  const vaultOk = !v?.error;
  setStatus(
    `${how}: saved ${fieldCount} field(s) from ${name}.${vaultOk ? " Document text kept as local knowledge." : ""}${extra}`,
    usedAi || !aiError ? "success" : "warn"
  );
}

function discardExtracted() {
  hideSavePrompt();
  clearDocPreview();
  setStatus("Not saved. Nothing stored on this device.", "active");
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

  hideSavePrompt();
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

    // Structure in RAM only. Persistence waits for confirmSaveExtracted.
    // Extracted TEXT goes to the LOCAL VLM via STRUCTURE_DOCUMENT_TEXT —
    // the backend refuses remote endpoints before any request.
    const analyzeChecked = document.getElementById("analyze-with-ai")?.checked !== false;
    const profileFields = {};
    let usedAi = false;
    let aiError = "";

    if (analyzeChecked) {
      setStatus(`Structuring ${file.name} with local AI…`, "active");
      const r = await chrome.runtime.sendMessage({
        type: "STRUCTURE_DOCUMENT_TEXT",
        text,
        consented: true,
      });
      if (r?.error) {
        aiError = formatAgentError(r.errorCode || "UNKNOWN", r.error);
      } else {
        Object.assign(profileFields, toUserProfileFields(r.fields || {}));
        usedAi = Object.keys(profileFields).length > 0;
      }
    }

    if (!usedAi) {
      Object.assign(profileFields, toUserProfileFields(extractProfileFromText(text)));
    }

    pendingUpload = {
      name: file.name,
      format: res.format || format,
      size: file.size,
      text,
      fields: profileFields,
      usedAi,
      aiError,
    };
    showFieldPreview(profileFields);
    showSavePrompt();
    const n = Object.keys(profileFields).length;
    const how = usedAi ? "Local AI" : "on-device extract";
    const extra = aiError && !usedAi ? ` AI skipped: ${aiError}` : "";
    setStatus(
      `${how}: ${n} field(s) from ${file.name}. Review and click Save to keep them.${extra}`,
      usedAi || !aiError ? "active" : "warn"
    );
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
document.getElementById("save-extracted-btn")?.addEventListener("click", () => confirmSaveExtracted());
document.getElementById("discard-extracted-btn")?.addEventListener("click", discardExtracted);

async function renderVaultList() {
  const el = document.getElementById("vault-list");
  if (!el) return;
  el.textContent = "";
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_DOC_VAULT" });
    const docs = Array.isArray(res?.docs) ? res.docs : [];
    if (!docs.length) {
      el.textContent = "No documents saved yet.";
      return;
    }
    for (const d of docs) {
      const row = document.createElement("div");
      row.className = "vault-row";
      const name = document.createElement("span");
      name.textContent = String(d.docName || d.name || "document");
      const meta = document.createElement("span");
      const chars = d.charCount ?? d.chars;
      meta.textContent = chars ? `${chars} chars` : "";
      row.appendChild(name);
      row.appendChild(meta);
      el.appendChild(row);
    }
  } catch {
    el.textContent = "";
  }
}

// ── Theme Switcher (Light → Dark → System) ────────────────────────
const THEME_ORDER = ["light", "dark", "system"];
const themeToggleBtn = document.getElementById("theme-toggle-btn");
let aegisTheme = "system";

function systemPrefersDark() {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyTheme(theme) {
  aegisTheme = THEME_ORDER.includes(theme) ? theme : "system";
  const dark = aegisTheme === "dark" || (aegisTheme === "system" && systemPrefersDark());
  document.body.classList.toggle("dark-mode", dark);
  document.body.style.colorScheme = dark ? "dark" : "light";
  if (!themeToggleBtn) return;
  const label = aegisTheme === "light" ? "Light" : aegisTheme === "dark" ? "Dark" : "Auto";
  const next = aegisTheme === "light" ? "Dark" : aegisTheme === "dark" ? "System" : "Light";
  themeToggleBtn.textContent = label;
  themeToggleBtn.title = `Theme: ${aegisTheme === "system" ? "System" : label} — click for ${next}`;
  themeToggleBtn.setAttribute("aria-label", `Theme: ${aegisTheme === "system" ? "System" : label}`);
}

async function initTheme() {
  let raw;
  try {
    const stored = await chrome.storage.local.get("aegisTheme");
    raw = stored.aegisTheme;
  } catch {
    raw = "system";
  }
  applyTheme(raw === "dark" || raw === "light" || raw === "system" ? raw : "system");
}

themeToggleBtn?.addEventListener("click", async () => {
  const idx = THEME_ORDER.indexOf(aegisTheme);
  const next = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
  applyTheme(next);
  try {
    await chrome.storage.local.set({ aegisTheme: next });
  } catch {
    // Preview / missing chrome.storage — theme still applies in this document.
  }
});

if (typeof matchMedia === "function") {
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const onScheme = () => {
    if (aegisTheme === "system") applyTheme("system");
  };
  if (typeof mq.addEventListener === "function") mq.addEventListener("change", onScheme);
  else if (typeof mq.addListener === "function") mq.addListener(onScheme);
}

function warmOnDeviceModels() {
  updateModelStatus("Loading...", "loading");
  chrome.runtime.sendMessage({ type: "WARM_MODELS" })
    .then((warm) => {
      if (!warm) return;
      if (warm.ok === false && /timed out/i.test(String(warm.error || ""))) return;
      if (warm.ok === false || warm.faceModelReady === false) {
        updateModelStatus("On-device failed", "failed");
        return;
      }
      updateModelStatus("On-device ready", "ready");
    })
    .catch(() => {});
}

// ── Init ──────────────────────────────────────────────────────────
initTheme();
loadConfig();
setupConfigListeners();
loadLastReceipt();
renderProfile();
renderVaultList();
warmOnDeviceModels();
