// Popup script — Controls extension settings, voice, documents, profiles, and triggers agent

import { toBase64, detectDocFormat, MAX_DOCUMENT_BYTES } from "../shared/file-helpers.js";
import {
  PROFILE_KEYS,
  KEY_LABELS,
  extractProfileFromText,
  toUserProfileFields,
  mergeProfileFieldMaps,
} from "../shared/extract-profile.js";
import {
  VOICE_LANGUAGES,
  speechRecognitionSupported,
  requestMicrophone,
  createSpeechSession,
} from "../shared/speech-listen.js";

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
  updatePreviewLegend(receipt);
}

function updatePreviewLegend(receipt) {
  const el = document.getElementById("preview-legend");
  if (!el) return;
  const masked = receipt?.masked;
  if (!masked) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  const faces = masked.faces || 0;
  const fields = masked.passwordFields || 0;
  const pii = masked.piiSpans || 0;
  el.hidden = false;
  el.textContent = `Hidden from agents: ${faces} face(s), ${fields} password/sensitive field(s), ${pii} PII span(s).`;
}

function showSanitizedPreview(dataUrl, opts = {}) {
  if (!previewWrap || !previewImg) return;
  const ok = typeof dataUrl === "string" && dataUrl.indexOf("data:image/") === 0;
  if (!ok) {
    previewWrap.classList.remove("has-image");
    previewImg.removeAttribute("src");
    return;
  }
  previewImg.src = dataUrl;
  previewWrap.classList.add("has-image");
  if (opts.persist !== false) {
    chrome.storage?.session?.set({ lastSanitizedImage: dataUrl }).catch(() => {});
  }
  if (opts.scroll !== false) {
    requestAnimationFrame(() => {
      previewWrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }
}

async function revealScanPreview(preferredUrl) {
  let url = preferredUrl;
  if (typeof url !== "string" || url.indexOf("data:image/") !== 0) {
    try {
      url = await chrome.runtime.sendMessage({ type: "GET_LAST_SANITIZED_IMAGE" });
    } catch {}
  }
  if (typeof url !== "string" || url.indexOf("data:image/") !== 0) {
    try {
      const stored = await chrome.storage.session.get("lastSanitizedImage");
      url = stored?.lastSanitizedImage;
    } catch {}
  }
  showSanitizedPreview(url, { persist: false, scroll: true });
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

// ── Scan Progress Bar ─────────────────────────────────────────────
// Stages map: stage key → { pct: fill %, stageId: dot element id }
const SCAN_STAGES = [
  { key: "capture", pct: 15,  stageId: "sp-stage-capture" },
  { key: "dom",     pct: 35,  stageId: "sp-stage-dom"     },
  { key: "detect",  pct: 75,  stageId: "sp-stage-detect"  },
  { key: "done",    pct: 100, stageId: "sp-stage-done"    },
];

const scanProgressEl   = document.getElementById("scan-progress");
const scanProgressFill = document.getElementById("scan-progress-fill");
const scanProgressPct  = document.getElementById("scan-progress-pct");

function setScanProgress(stage, { error = false } = {}) {
  if (!stage) {
    // hide and reset
    scanProgressEl?.classList.remove("visible");
    if (scanProgressFill) { scanProgressFill.style.width = "0%"; scanProgressFill.className = "scan-progress-fill"; }
    if (scanProgressPct) scanProgressPct.textContent = "0%";
    SCAN_STAGES.forEach(({ stageId }) => {
      const el = document.getElementById(stageId);
      if (el) el.className = "scan-stage";
    });
    return;
  }
  scanProgressEl?.classList.add("visible");
  const idx = SCAN_STAGES.findIndex((s) => s.key === stage);
  if (idx === -1) return;
  const { pct } = SCAN_STAGES[idx];
  if (scanProgressFill) {
    scanProgressFill.style.width = `${pct}%`;
    scanProgressFill.className = "scan-progress-fill" + (error ? " error" : stage === "done" ? " done" : "");
  }
  if (scanProgressPct) scanProgressPct.textContent = `${pct}%`;
  SCAN_STAGES.forEach(({ key, stageId }, i) => {
    const el = document.getElementById(stageId);
    if (!el) return;
    if (i < idx) el.className = "scan-stage done";
    else if (i === idx) el.className = "scan-stage" + (error ? "" : " active") + (key === "done" && !error ? " done" : "");
    else el.className = "scan-stage";
  });
}


async function loadLastReceipt() {
  try {
    const receipt = await chrome.runtime.sendMessage({ type: "GET_LAST_RECEIPT" });
    if (receipt) showReceipt(receipt);
    const stored = await chrome.storage.session.get("lastSanitizedImage");
    if (stored?.lastSanitizedImage) {
      showSanitizedPreview(stored.lastSanitizedImage, { persist: false, scroll: false });
    }
  } catch {}
}

// ── Privacy Risk Score Card ───────────────────────────────────────
const riskGradeEl   = document.getElementById("risk-grade-badge");
const riskScoreEl   = document.getElementById("risk-score-num");
const riskHostEl    = document.getElementById("risk-host");
const riskFactorsEl = document.getElementById("risk-factors");
const riskRefreshBtn = document.getElementById("risk-refresh-btn");

function renderRiskScore(report) {
  if (!report) {
    const badge = document.getElementById("risk-grade-badge");
    if (badge) { badge.className = "risk-grade-badge loading"; badge.textContent = "\u00a0"; }
    if (riskScoreEl)   { riskScoreEl.textContent = "--"; riskScoreEl.style.color = "#94a3b8"; }
    if (riskHostEl)    riskHostEl.textContent = "Scanning\u2026";
    if (riskFactorsEl) riskFactorsEl.innerHTML = "";
    return;
  }

  // Unscannable page (chrome://, new tab, system page)
  if (report.unscannable) {
    const badge = document.getElementById("risk-grade-badge");
    if (badge) {
      badge.className = "risk-grade-badge";
      badge.style.background = "#94a3b8";
      badge.textContent = "?";
    }
    if (riskScoreEl)   { riskScoreEl.textContent = "--"; riskScoreEl.style.color = "#94a3b8"; }
    if (riskHostEl)    riskHostEl.textContent = "Navigate to a website to scan";
    if (riskFactorsEl) {
      riskFactorsEl.innerHTML = "";
      const msg = document.createElement("div");
      msg.className = "risk-safe-msg";
      msg.style.color = "#94a3b8";
      msg.textContent = "Open any website and re-scan";
      riskFactorsEl.appendChild(msg);
    }
    return;
  }

  const { grade, score, color, risks = [], host } = report;
  // Grade badge — re-insert to replay pop animation
  const oldBadge = document.getElementById("risk-grade-badge");
  if (oldBadge) {
    const nb = oldBadge.cloneNode(false);
    nb.id = "risk-grade-badge";
    nb.className = "risk-grade-badge";
    nb.style.background = color;
    nb.textContent = grade;
    oldBadge.parentNode.replaceChild(nb, oldBadge);
  }
  if (riskScoreEl)   { riskScoreEl.textContent = String(score); riskScoreEl.style.color = color; }
  if (riskHostEl)    riskHostEl.textContent = host || "this page";
  if (riskFactorsEl) {
    riskFactorsEl.innerHTML = "";
    if (risks.length === 0) {
      const msg = document.createElement("div");
      msg.className = "risk-safe-msg";
      msg.innerHTML = "✅ No threats detected on this page";
      riskFactorsEl.appendChild(msg);
    } else {
      risks.forEach(({ label, severity }) => {
        const row = document.createElement("div");
        row.className = "risk-factor";
        row.innerHTML = `<span class="rf-dot ${severity}"></span>${label}`;
        riskFactorsEl.appendChild(row);
      });
    }
  }
}

async function loadRiskScore() {
  try {
    const report = await chrome.runtime.sendMessage({ type: "GET_PAGE_RISK_SCORE" });
    renderRiskScore(report);
  } catch {
    renderRiskScore(null);
  }
}

riskRefreshBtn?.addEventListener("click", async () => {
  riskRefreshBtn.classList.add("spinning");
  // Reset to loading state
  const badge = document.getElementById("risk-grade-badge");
  if (badge) { badge.className = "risk-grade-badge loading"; badge.textContent = "\u00a0"; }
  if (riskScoreEl) { riskScoreEl.textContent = "--"; riskScoreEl.style.color = "#94a3b8"; }
  if (riskHostEl) riskHostEl.textContent = "Scanning\u2026";
  if (riskFactorsEl) riskFactorsEl.innerHTML = "";
  await loadRiskScore();
  setTimeout(() => riskRefreshBtn.classList.remove("spinning"), 700);
});

// ── Load saved config ─────────────────────────────────────────────
async function loadConfig() {
  const config = await chrome.runtime.sendMessage({
    type: "GET_CONFIG",
    keys: ["vlmEndpoint", "vlmModel", "faceDetection", "passwordDetection", "piiDetection", "userProfile"],
  });
  document.getElementById("vlm-endpoint").value = config.vlmEndpoint || "http://localhost:8000/v1/chat/completions";
  document.getElementById("vlm-model").value = config.vlmModel || "SARA-Distillation-0.5B";
  document.getElementById("face-detection").checked = config.faceDetection !== false;
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked = config.piiDetection !== false;
  // Profile fields render from aegisProfiles / userProfile via renderProfile().
  await loadApiKeyStatus();
  await syncGatewayEndpoint();
}

async function syncGatewayEndpoint() {
  const hint = document.getElementById("local-llm-status");
  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_GATEWAY_STATUS" });
    if (!status || !status.endpoint) {
      if (hint) hint.textContent = "Could not reach the local gateway.";
      return;
    }
    const input = document.getElementById("vlm-endpoint");
    if (input) input.value = status.endpoint;
    if (status.usingGateway) {
      chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { vlmEndpoint: status.endpoint } }).catch(() => {});
    }
    if (hint) {
      if (status.ollamaUp) {
        hint.textContent = `Connected: SARA-Distillation-0.5B is active via local gateway (:8000).`;
      } else if (status.gatewayUp) {
        hint.textContent = "Gateway is up on :8000. Start Ollama on this laptop, then reopen the popup.";
      } else {
        hint.textContent = "Start Ollama, then `cd server && node index.js`. Endpoint stays http://localhost:8000/v1/chat/completions.";
      }
    }
  } catch {
    if (hint) hint.textContent = "Could not reach the local gateway.";
  }
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
      hint.textContent = "Leave empty. Local Ollama on this laptop does not need a key.";
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
  if (!modelStatus) return;
  if (type === "ready") {
    modelStatus.hidden = true;
    modelStatus.textContent = "";
    modelStatus.className = "model-status";
    return;
  }
  modelStatus.hidden = false;
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

function applyInitDone(msg) {
  const faces = msg && msg.faceModelReady === true;
  const names = msg && msg.nerModelReady === true;
  if (faces && names) updateModelStatus("", "ready");
  else updateModelStatus("Not loaded", "failed");
}

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "RISK_SCORE_UPDATE" && msg.report) {
      renderRiskScore(msg.report);
    }
    if (msg.type === "INIT_PROGRESS") updateModelStatus("Loading models", "loading");
    if (msg.type === "INIT_DONE") applyInitDone(msg);
    if (msg.type === "SCAN_PROGRESS" && msg.stage) {
      setScanProgress(msg.stage);
      if (msg.label) setStatus(msg.label, "active");
    }
  });
}

function warmOnDeviceModels() {
  if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) return;
  chrome.runtime.sendMessage({ type: "WARM_MODELS" }).then((res) => {
    if (!res) return;
    if (res.ok === false) {
      updateModelStatus("Not loaded", "failed");
      return;
    }
    if ("faceModelReady" in res || "nerModelReady" in res) applyInitDone(res);
  }).catch(() => {});
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
const DEFAULT_PROFILE_NAMES = ["Personal", "Work", "Family"];
const MAX_PROFILES = 8;
const MAX_PROFILE_NAME_CHARS = 32;

function sanitizeProfileName(raw) {
  const name = String(raw || "").replace(/\s+/g, " ").trim();
  if (!name) return "";
  return name.slice(0, MAX_PROFILE_NAME_CHARS);
}

function profileNameTaken(profiles, name, except) {
  const needle = name.toLowerCase();
  return Object.keys(profiles || {}).some((n) => n.toLowerCase() === needle && n !== except);
}

async function loadProfileBag() {
  const stored = await chrome.storage.local.get(["aegisProfiles", "aegisCurrentProfile", "userProfile"]);
  const profiles = stored.aegisProfiles && typeof stored.aegisProfiles === "object" && !Array.isArray(stored.aegisProfiles)
    ? { ...stored.aegisProfiles }
    : {};
  let current = stored.aegisCurrentProfile || "Personal";
  if (!Object.keys(profiles).length) {
    const seed = stored.userProfile && typeof stored.userProfile === "object" && !Array.isArray(stored.userProfile)
      ? stored.userProfile
      : {};
    profiles.Personal = seed;
    profiles.Work = {};
    profiles.Family = {};
    current = "Personal";
    await chrome.storage.local.set({
      aegisProfiles: profiles,
      aegisCurrentProfile: current,
      userProfile: seed,
    });
  }
  if (!profiles[current]) {
    current = Object.keys(profiles)[0] || "Personal";
    if (!profiles[current]) profiles[current] = {};
    await chrome.storage.local.set({ aegisCurrentProfile: current, aegisProfiles: profiles });
  }
  return { profiles, current };
}

async function setActiveProfile(name, extra = {}) {
  const { profiles } = await loadProfileBag();
  if (!profiles[name]) profiles[name] = extra.data || {};
  const data = extra.data !== undefined ? extra.data : (profiles[name] || {});
  profiles[name] = data;
  await chrome.storage.local.set({
    aegisProfiles: profiles,
    aegisCurrentProfile: name,
    userProfile: data,
  });
}

async function getProfile() {
  const { profiles, current } = await loadProfileBag();
  return profiles[current] && typeof profiles[current] === "object" ? profiles[current] : {};
}

async function saveProfileData(profile) {
  const { current } = await loadProfileBag();
  await setActiveProfile(current, { data: profile });
}

async function renderProfileSwitcher() {
  const sel = document.getElementById("profile-switcher");
  if (!sel) return;
  const { profiles, current } = await loadProfileBag();
  const names = Object.keys(profiles).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = "";
  for (const n of names) {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
    if (n === current) o.selected = true;
    sel.appendChild(o);
  }
  const hint = document.getElementById("saved-fields-hint");
  if (hint) hint.textContent = current;
}

async function renderProfile() {
  await renderProfileSwitcher();
  const profile = await getProfile();
  const profileList = document.getElementById("profile-list");
  profileList.innerHTML = "";
  const entries = Object.keys(profile).filter((k) => k !== "_skipped").map((k) => [k, profile[k]]).sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length === 0) { profileList.innerHTML = '<div class="p-empty">No details yet in this profile. Speak, drop a PDF, or add a field.</div>'; }
  for (const [key, val] of entries) {
    const row = document.createElement("div"); row.className = "p-row";
    const input = document.createElement("input"); input.type = "text"; input.value = typeof val === "object" ? val.value : val; input.placeholder = labelFor(key);
    input.addEventListener("change", async () => { const p = await getProfile(); const v = input.value.trim(); if (!v) delete p[key]; else p[key] = v; await saveProfileData(p); renderProfile(); });
    const del = document.createElement("button"); del.className = "p-del"; del.textContent = "X"; del.title = "Delete";
    del.addEventListener("click", async () => { const p = await getProfile(); delete p[key]; await saveProfileData(p); renderProfile(); });
    row.appendChild(input); row.appendChild(del); profileList.appendChild(row);
  }
}

let profileNameMode = "new";

function showProfileNameCard(mode) {
  profileNameMode = mode;
  const card = document.getElementById("profile-name-card");
  const input = document.getElementById("profile-name-input");
  const save = document.getElementById("profile-name-save-btn");
  if (!card || !input || !save) return;
  card.style.display = "block";
  save.textContent = mode === "rename" ? "Rename" : "Create";
  input.value = "";
  input.focus();
}

function hideProfileNameCard() {
  const card = document.getElementById("profile-name-card");
  if (card) card.style.display = "none";
}

document.getElementById("profile-new-btn")?.addEventListener("click", async () => {
  const { profiles } = await loadProfileBag();
  if (Object.keys(profiles).length >= MAX_PROFILES) {
    setStatus(`At most ${MAX_PROFILES} profiles on this device.`, "warn");
    return;
  }
  showProfileNameCard("new");
});

document.getElementById("profile-rename-btn")?.addEventListener("click", () => showProfileNameCard("rename"));

document.getElementById("profile-name-cancel-btn")?.addEventListener("click", hideProfileNameCard);

document.getElementById("profile-name-save-btn")?.addEventListener("click", async () => {
  const next = sanitizeProfileName(document.getElementById("profile-name-input")?.value);
  if (!next) { setStatus("Enter a profile name.", "error"); return; }
  const { profiles, current } = await loadProfileBag();
  if (profileNameMode === "new") {
    if (Object.keys(profiles).length >= MAX_PROFILES) {
      setStatus(`At most ${MAX_PROFILES} profiles on this device.`, "warn");
      return;
    }
    if (profileNameTaken(profiles, next)) {
      setStatus("That profile name already exists.", "error");
      return;
    }
    profiles[next] = {};
    await chrome.storage.local.set({ aegisProfiles: profiles, aegisCurrentProfile: next, userProfile: {} });
    hideProfileNameCard();
    setStatus(`Created ${next}. Speak or drop a document into this profile.`, "success");
    await renderProfile();
    return;
  }
  if (next === current) { hideProfileNameCard(); return; }
  if (profileNameTaken(profiles, next, current)) {
    setStatus("That profile name already exists.", "error");
    return;
  }
  profiles[next] = profiles[current] || {};
  delete profiles[current];
  await chrome.storage.local.set({
    aegisProfiles: profiles,
    aegisCurrentProfile: next,
    userProfile: profiles[next],
  });
  hideProfileNameCard();
  setStatus(`Renamed to ${next}.`, "success");
  await renderProfile();
});

document.getElementById("profile-delete-btn")?.addEventListener("click", async () => {
  const { profiles, current } = await loadProfileBag();
  const names = Object.keys(profiles);
  if (names.length <= 1) {
    setStatus("Keep at least one profile.", "warn");
    return;
  }
  if (!confirm(`Delete the "${current}" profile and its fields?`)) return;
  delete profiles[current];
  const next = DEFAULT_PROFILE_NAMES.find((n) => profiles[n]) || Object.keys(profiles)[0];
  await chrome.storage.local.set({
    aegisProfiles: profiles,
    aegisCurrentProfile: next,
    userProfile: profiles[next] || {},
  });
  setStatus(`Deleted ${current}. Now using ${next}.`, "active");
  await renderProfile();
});

document.getElementById("profile-switcher")?.addEventListener("change", async (e) => {
  const name = e.target.value;
  await setActiveProfile(name);
  setStatus(`Switched to ${name}. Fill Form will use this profile.`, "success");
  await renderProfile();
});

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
  if (!confirm("Clear fields in this profile only?")) return;
  await saveProfileData({}); setStatus("Cleared.", "active"); renderProfile();
});
document.getElementById("profile-sample-btn")?.addEventListener("click", async () => {
  const sample = { fullName: "Aarav Sharma", email: "aarav.sharma@example.com", phone: "9876543210", dob: "1998-05-15", gender: "male", addressLine1: "123 MG Road, Koramangala", city: "Bengaluru", state: "Karnataka", pincode: "560034", college: "Indian Institute of Technology", occupation: "Software Engineer", annualIncome: "1200000" };
  const profile = await getProfile(); Object.assign(profile, sample); await saveProfileData(profile);
  setStatus("Loaded sample profile!", "success"); renderProfile();
});

// ── Export / Import ───────────────────────────────────────────────
document.getElementById("export-profile-btn")?.addEventListener("click", async () => {
  const profile = await getProfile();
  const stored = await chrome.storage.local.get("aegisCurrentProfile");
  const name = stored.aegisCurrentProfile || "Personal";
  const blob = new Blob([JSON.stringify({ profileName: name, data: profile }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `AEGIS_${name}.json`; a.click(); URL.revokeObjectURL(url);
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
        const target = sanitizeProfileName(json.profileName) || (await loadProfileBag()).current;
        const { profiles } = await loadProfileBag();
        if (profiles[target] == null) {
          if (Object.keys(profiles).length >= MAX_PROFILES) {
            setStatus(`At most ${MAX_PROFILES} profiles. Switch to one, then import.`, "warn");
            return;
          }
          profiles[target] = {};
        }
        const profile = { ...(profiles[target] || {}) };
        for (const [k, v] of Object.entries(data)) {
          profile[k] = typeof v === "object" && v && v.value ? v.value : typeof v === "string" ? v : String(v);
        }
        await setActiveProfile(target, { data: profile });
        setStatus(`Imported ${file.name} into ${target}.`, "success");
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

function profileHasFillValues(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  return Object.entries(profile).some(([k, v]) => {
    if (k === "_skipped") return false;
    const val = typeof v === "object" && v && "value" in v ? v.value : v;
    return String(val ?? "").trim().length > 0;
  });
}

async function hasSavedFillData() {
  if (profileHasFillValues(await getProfile())) return true;
  try {
    const res = await chrome.runtime.sendMessage({ type: "GET_DOC_VAULT" });
    return Array.isArray(res?.docs) && res.docs.length > 0;
  } catch {
    return false;
  }
}

// Fill Form always writes every matching field first. This only describes
// the result: leftover empty controls are a warning, never a reason to skip.
function statusForLocalFill(filled, remaining) {
  const n = Math.max(0, Number(filled) || 0);
  const left = Math.max(0, Number(remaining) || 0);
  if (n > 0 && left === 0) {
    return { text: `Filled ${n} field(s) from your profile and documents.`, kind: "success" };
  }
  if (n > 0) {
    return { text: `Filled ${n} field(s). Not enough data available to fill the rest.`, kind: "warn" };
  }
  return { text: "Not enough data available to fill form.", kind: "warn" };
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

let scanGeneration = 0;
function setScanBusy(busy) {
  scanBtn.disabled = busy;
  fillBtn.disabled = busy;
  runBtn.disabled = busy;
  if (stopScanBtn) stopScanBtn.disabled = !busy;
}

async function abortPrivacyScan() {
  scanGeneration += 1;
  setScanBusy(false);
  setScanProgress(null);
  setPipeline(null);
  setStatus("Scan stopped.", "warn");
  try {
    await chrome.runtime.sendMessage({ type: "ABORT_SCAN" });
  } catch {
    // Background may already be gone; UI is already reset.
  }
}


stopScanBtn?.addEventListener("click", () => abortPrivacyScan());

// ── Button Handlers ───────────────────────────────────────────────
fillBtn.addEventListener("click", async () => {
  const saveErr = await persistProfileFromTextarea();
  if (saveErr) { setStatus(saveErr, "error"); return; }
  if (!(await hasSavedFillData())) {
    setStatus("Save a profile first.", "warn");
    return;
  }
  fillBtn.disabled = true; scanBtn.disabled = true; runBtn.disabled = true; clearStatus();
  try {
    setStatus("Filling matching fields from your profile and documents…", "active");
    const local = await chrome.runtime.sendMessage({ type: "FILL_MATCHING_FIELDS" });
    if (local?.error) {
      setStatus(formatAgentError(local.errorCode || "UNKNOWN", local.error), "error");
      return;
    }
    const filled = local?.filled || 0;
    const remaining = local?.remaining ?? 0;
    const result = statusForLocalFill(filled, remaining);
    setStatus(result.text, result.kind);
  } catch (err) { setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error"); }
  finally { fillBtn.disabled = false; scanBtn.disabled = false; runBtn.disabled = false; }
});

async function runPrivacyScan(opts = {}) {
  const forceFaces = opts.forceFaces === true;
  const token = ++scanGeneration;
  setScanBusy(true);
  clearStatus();
  document.querySelector('.tab[data-tab="fill"]')?.click();
  setScanProgress("capture");
  setPipeline("capture", { includeVlm: false });
  setStatus("Capturing viewport...");

  try {
    // Stage 2 — DOM Scan (background emits SCAN_PROGRESS but we also advance
    // optimistically once we've kicked off the message)
    setScanProgress("dom");
    setPipeline("redact", { includeVlm: false });
    setStatus("Scanning DOM and running local redaction...");

    const result = await withStuckHint(
      () => chrome.runtime.sendMessage({ type: "SCAN_AND_OVERLAY", forceFaces }),
      "Still scanning... Click Stop scan to cancel."
    );
    if (token !== scanGeneration) return;

    if (result?.aborted || result?.errorCode === "SCAN_ABORTED") {
      setScanProgress(null);
      setPipeline(null);
      setStatus("Scan stopped.", "warn");
      return;
    }
    if (result?.error) {
      setScanProgress("detect", { error: true });
      setPipeline(null);
      setStatus(formatAgentError(result.errorCode || "UNKNOWN", result.error), "error");
      setTimeout(() => setScanProgress(null), 2500);
      return;
    }

    // Stage 3 — Detect & Mask (completed — advance to done)
    setScanProgress("detect");
    await new Promise((r) => setTimeout(r, 180)); // brief pause so user sees the step
    setScanProgress("done");
    setPipeline(null);

    if (result.receipt) showReceipt(result.receipt);
    await revealScanPreview(result.sanitizedImage);
    setPipeline(null);
    const faces = result.receipt?.masked?.faces || 0;
    const fields = result.fieldCount || 0;
    const facesOn = forceFaces || document.getElementById("face-detection")?.checked !== false;
    if (facesOn) {
      setStatus(`Secured ${fields} field(s) + ${faces} face(s).`, fields > 0 || faces > 0 ? "success" : "active");
    } else {
      setStatus(`Secured ${fields} field(s). Faces not scanned (toggle off).`, fields > 0 ? "success" : "active");
    }

    // Auto-hide the bar after a short success pause
    setTimeout(() => { if (token === scanGeneration) setScanProgress(null); }, 2000);
  } catch (err) {
    if (token !== scanGeneration) return;
    setScanProgress("detect", { error: true });
    setPipeline(null);
    setStatus(formatRuntimeDisconnect(err), "error");
    setTimeout(() => setScanProgress(null), 2500);
  } finally {
    if (token === scanGeneration) setScanBusy(false);
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
  runBtn.disabled = true; scanBtn.disabled = true; fillBtn.disabled = true; clearStatus();
  try { await runAgentLoop(task); } catch (err) { setPipeline(null); setStatus(formatRuntimeDisconnect(err), "error"); }
  finally { runBtn.disabled = false; scanBtn.disabled = false; fillBtn.disabled = false; }
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
    // Always harvest Label: value lines on-device first. Local AI (if on)
    // overlays / fills gaps — it must not replace a rich extract with 3 fields.
    const analyzeChecked = document.getElementById("analyze-with-ai")?.checked !== false;
    let profileFields = mergeProfileFieldMaps(extractProfileFromText(text));
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
      } else if (r?.fields && typeof r.fields === "object") {
        const aiCount = Object.keys(r.fields).length;
        if (aiCount > 0) {
          profileFields = mergeProfileFieldMaps(profileFields, r.fields);
          usedAi = true;
        }
      }
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
  if (!themeToggleBtn) return;
  const label = aegisTheme === "light" ? "Light" : aegisTheme === "dark" ? "Dark" : "Auto";
  const icon  = aegisTheme === "dark" ? "🌙" : aegisTheme === "system" ? "✨" : "☀️";
  const next  = aegisTheme === "light" ? "Dark" : aegisTheme === "dark" ? "System" : "Light";
  const iconEl  = themeToggleBtn.querySelector(".theme-icon");
  const labelEl = themeToggleBtn.querySelector("#theme-label");
  if (iconEl)  iconEl.textContent  = icon;
  if (labelEl) labelEl.textContent = label;
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

// ── Multilingual speech (Chrome Web Speech, 10 languages) ─────────
const voiceStartBtn = document.getElementById("voice-start-btn");
const voiceLangSelect = document.getElementById("voice-lang-select");
const voiceTranscriptEl = document.getElementById("voice-transcript");
const voiceFieldPreview = document.getElementById("voice-field-preview");
const voiceSaveRow = document.getElementById("voice-save-row");

let voiceSession = null;
let pendingVoiceFields = null;
let lastVoiceTranscript = "";

function openExtensionPage(relPath) {
  const url = chrome.runtime.getURL(relPath);
  chrome.tabs.create({ url });
}

function fillVoiceLangSelect() {
  if (!voiceLangSelect) return;
  const current = voiceLangSelect.value;
  voiceLangSelect.innerHTML = "";
  for (const { code, label } of VOICE_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    voiceLangSelect.appendChild(opt);
  }
  voiceLangSelect.value = current && [...voiceLangSelect.options].some((o) => o.value === current)
    ? current
    : "en-US";
}

function showVoiceFields(fields) {
  pendingVoiceFields = fields;
  if (!voiceFieldPreview || !voiceSaveRow) return;
  voiceFieldPreview.textContent = "";
  const entries = Object.entries(fields || {});
  if (!entries.length) {
    voiceFieldPreview.style.display = "none";
    voiceSaveRow.style.display = "none";
    return;
  }
  voiceFieldPreview.style.display = "block";
  voiceSaveRow.style.display = "flex";
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
    voiceFieldPreview.appendChild(row);
  }
}

function bindVoiceSession() {
  voiceSession = createSpeechSession({
    lang: voiceLangSelect?.value || "en-US",
    onStart() {
      voiceStartBtn?.classList.add("recording");
      if (voiceStartBtn) voiceStartBtn.textContent = "Stop";
      if (voiceTranscriptEl) {
        voiceTranscriptEl.style.display = "block";
        voiceTranscriptEl.textContent = "Listening...";
      }
      setStatus("Listening… speak name, email, or phone.", "active");
    },
    onInterim(t) {
      lastVoiceTranscript = t;
      if (voiceTranscriptEl) voiceTranscriptEl.textContent = t;
    },
    onFinal(t) {
      lastVoiceTranscript = t;
      if (voiceTranscriptEl) {
        voiceTranscriptEl.style.display = "block";
        voiceTranscriptEl.textContent = t;
      }
      const fields = toUserProfileFields(extractProfileFromText(t));
      showVoiceFields(fields);
      const n = Object.keys(fields).length;
      if (n) setStatus(`${n} field(s) from speech. Save to keep them.`, "active");
      else setStatus("Heard you, but no phone/email/name to save.", "warn");
    },
    onError(err) {
      voiceStartBtn?.classList.remove("recording");
      if (voiceStartBtn) voiceStartBtn.textContent = "Start listening";
      const msg = String(err || "error");
      if (msg === "not-allowed") {
        setStatus("Microphone blocked. Use Full mic page, or allow mic for this extension.", "error");
      } else if (msg === "no-speech") {
        setStatus("No speech heard. Try again, or open the full mic page.", "warn");
      } else {
        setStatus(`Speech error: ${msg}`, "error");
      }
    },
    onEnd() {
      voiceStartBtn?.classList.remove("recording");
      if (voiceStartBtn) voiceStartBtn.textContent = "Start listening";
    },
  });
}

voiceStartBtn?.addEventListener("click", async () => {
  if (!speechRecognitionSupported()) {
    setStatus("Speech needs Google Chrome. Open the full mic page if the popup blocks the mic.", "error");
    return;
  }
  if (voiceSession?.isRecording()) {
    voiceSession.stop();
    return;
  }
  try {
    await requestMicrophone();
  } catch {
    setStatus("Microphone denied. Open Full mic page and allow the mic there.", "error");
    return;
  }
  bindVoiceSession();
  voiceSession.setLang(voiceLangSelect?.value || "en-US");
  try {
    voiceSession.start();
  } catch {
    setStatus("Could not start listening. Try Full mic page.", "warn");
  }
});

voiceLangSelect?.addEventListener("change", () => {
  voiceSession?.setLang(voiceLangSelect.value);
});

document.getElementById("save-voice-btn")?.addEventListener("click", async () => {
  if (!pendingVoiceFields || !Object.keys(pendingVoiceFields).length) {
    setStatus("Nothing to save. Speak first.", "warn");
    return;
  }
  const profile = await getProfile();
  Object.assign(profile, pendingVoiceFields);
  await saveProfileData(profile);
  if (lastVoiceTranscript) {
    try {
      await chrome.runtime.sendMessage({
        type: "ADD_DOC_TO_VAULT",
        docName: "spoken-note.txt",
        format: "txt",
        text: lastVoiceTranscript,
      });
      await renderVaultList();
    } catch {
      // vault optional
    }
  }
  const n = Object.keys(pendingVoiceFields).length;
  pendingVoiceFields = null;
  if (voiceSaveRow) voiceSaveRow.style.display = "none";
  await renderProfile();
  setStatus(`Saved ${n} spoken field(s) to this profile.`, "success");
});

document.getElementById("discard-voice-btn")?.addEventListener("click", () => {
  pendingVoiceFields = null;
  lastVoiceTranscript = "";
  if (voiceFieldPreview) {
    voiceFieldPreview.textContent = "";
    voiceFieldPreview.style.display = "none";
  }
  if (voiceSaveRow) voiceSaveRow.style.display = "none";
  if (voiceTranscriptEl) voiceTranscriptEl.style.display = "none";
  setStatus("Not saved. Nothing stored from speech.", "active");
});

document.getElementById("open-voice-page-btn")?.addEventListener("click", () => {
  openExtensionPage("src/voice/voice.html");
});
document.getElementById("open-voice-settings-btn")?.addEventListener("click", () => {
  openExtensionPage("src/voice/voice.html");
});
document.getElementById("open-dashboard-btn")?.addEventListener("click", () => {
  openExtensionPage("src/dashboard/dashboard.html");
});

fillVoiceLangSelect();

// ── Init ──────────────────────────────────────────────────────────
initTheme();
loadConfig();
setupConfigListeners();
loadLastReceipt();
renderProfile();
renderVaultList();
warmOnDeviceModels();
loadRiskScore();
