// Popup script — Controls extension settings and triggers agent

const statusEl    = document.getElementById("status");
const runBtn      = document.getElementById("run-btn");
const scanBtn     = document.getElementById("scan-btn");
const modelStatus = document.getElementById("model-status");
const receiptEl   = document.getElementById("receipt");
const previewWrap = document.getElementById("preview-wrap");
const previewImg  = document.getElementById("sanitize-preview");
const pipelineEl  = document.getElementById("pipeline");

// Must match src/background/background.js — bounded agent loop contract.
const MAX_AGENT_STEPS = 10;
const AGENT_STEP_DELAY_MS = 400;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Status helpers ────────────────────────────────────────────────

function setStatus(message, type = "active") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function clearStatus() {
  statusEl.className = "status";
  statusEl.textContent = "";
}

// ── Privacy Receipt ───────────────────────────────────────────────

function showReceipt(receipt) {
  if (!receipt) return;
  document.getElementById("r-fields").textContent =
    (receipt.masked.passwordFields || 0) + (receipt.masked.piiSpans || 0) > 0
      ? `${receipt.masked.passwordFields} field(s), ${receipt.masked.piiSpans} span(s)`
      : "None detected";
  document.getElementById("r-faces").textContent =
    receipt.masked.faces > 0 ? `${receipt.masked.faces}` : "None detected";
  document.getElementById("r-pii").textContent =
    receipt.masked.piiSpans > 0 ? `${receipt.masked.piiSpans}` : "None detected";
  document.getElementById("r-total").textContent =
    receipt.totalMs ? `${receipt.totalMs}ms` : "—";

  // Latency badges
  const badges = document.getElementById("r-badges");
  badges.innerHTML = "";
  const latency = receipt.latencyMs || {};
  const entries = [
    ["📸 Capture", latency.capture],
    ["🔍 DOM scan", latency.domScan],
    ["🧠 Inference", latency.inference],
    ["🌐 VLM", latency.vlm],
  ];
  for (const [label, ms] of entries) {
    if (ms == null) continue;
    const b = document.createElement("span");
    b.className = "badge" + (ms > 1500 ? " warn" : "");
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
  const steps = {
    capture: document.getElementById("step-capture"),
    redact: document.getElementById("step-redact"),
    vlm: document.getElementById("step-vlm"),
  };
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
  order.forEach((name, i) => {
    if (!steps[name]) return;
    steps[name].className = "pipeline-step" + (i < idx ? " done" : i === idx ? " active" : "");
  });
}

// ── Load last receipt on popup open ──────────────────────────────

async function loadLastReceipt() {
  try {
    const receipt = await chrome.runtime.sendMessage({ type: "GET_LAST_RECEIPT" });
    if (receipt) showReceipt(receipt);
  } catch {
    // No receipt yet — that's fine
  }
}

// ── Load saved config ─────────────────────────────────────────────

async function loadConfig() {
  const config = await chrome.runtime.sendMessage({
    type: "GET_CONFIG",
    keys: ["vlmEndpoint", "vlmModel", "faceDetection", "passwordDetection", "piiDetection", "userProfile"],
  });
  document.getElementById("vlm-endpoint").value =
    config.vlmEndpoint || "http://localhost:11434/v1/chat/completions";
  document.getElementById("vlm-model").value =
    config.vlmModel || "qwen2.5vl:7b";
  document.getElementById("face-detection").checked   = config.faceDetection !== false;
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked    = config.piiDetection !== false;
  if (config.userProfile !== undefined && config.userProfile !== null) {
    const profileInput = document.getElementById("profile-input");
    profileInput.value = typeof config.userProfile === "string"
      ? config.userProfile
      : JSON.stringify(config.userProfile, null, 2);
  }
  await loadApiKeyStatus();
}

async function loadApiKeyStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ type: "GET_VLM_API_KEY_STATUS" });
    const hint = document.getElementById("api-key-hint");
    const input = document.getElementById("vlm-api-key");
    input.value = "";
    if (status && status.configured) {
      input.placeholder = "Key held in this browser session (re-enter to replace)";
      hint.textContent = "Key is in session memory only — closing the browser clears it. Not stored on disk.";
    } else {
      input.placeholder = "API key (Gemini / hosted VLM)";
      hint.textContent = "Session-only — never written to disk. Leave empty for local Ollama.";
    }
  } catch {
    // status optional
  }
}

// ── Save config on change ─────────────────────────────────────────

function setupConfigListeners() {
  const inputs = [
    { id: "vlm-endpoint",       key: "vlmEndpoint" },
    { id: "vlm-model",          key: "vlmModel" },
    { id: "face-detection",     key: "faceDetection" },
    { id: "password-detection", key: "passwordDetection" },
    { id: "pii-detection",      key: "piiDetection" },
  ];
  for (const { id, key } of inputs) {
    const el = document.getElementById(id);
    el.addEventListener("change", () => {
      const value = el.type === "checkbox" ? el.checked : el.value;
      chrome.runtime.sendMessage({ type: "SET_CONFIG", config: { [key]: value } });
    });
  }

  const apiKeyInput = document.getElementById("vlm-api-key");
  apiKeyInput.addEventListener("change", () => {
    const vlmApiKey = apiKeyInput.value;
    apiKeyInput.value = "";
    chrome.runtime.sendMessage({ type: "SET_VLM_API_KEY", vlmApiKey }).then(() => {
      loadApiKeyStatus();
    });
  });
}

// ── Model Status ──────────────────────────────────────────────────
// Offscreen forwards worker INIT_PROGRESS / INIT_DONE via runtime messages.

function updateModelStatus(status, type) {
  modelStatus.textContent = status;
  modelStatus.className = `model-status ${type}`;
}

function checkModelStatus() {
  updateModelStatus("⟳ Warming models…", "loading");
  chrome.runtime.sendMessage({ type: "WARM_MODELS" }).catch(() => {
    updateModelStatus("○ Models idle", "loading");
  });
}

function formatVlmOfflineMessage(vlmError) {
  const msg = String(vlmError || "");
  const offline =
    msg.includes("Failed to fetch") ||
    msg.includes("unreachable") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("network") ||
    /VLM API error:\s*5\d\d/.test(msg);
  if (offline) {
    return (
      "VLM optional for this demo — local redaction succeeded. " +
      "See the sanitized preview and privacy receipt above. " +
      "Use Privacy scan anytime without Ollama; Run Agent needs a running VLM."
    );
  }
  return `VLM unavailable: ${msg}`;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "INIT_PROGRESS") {
    const text = msg.status || "Loading on-device models…";
    updateModelStatus("⟳ " + text, "loading");
    setStatus(text, "active");
    return;
  }
  if (msg.type === "INIT_DONE") {
    if (msg.faceModelReady) {
      updateModelStatus("● BlazeFace ready (WASM)", "ready");
    } else {
      updateModelStatus("● BlazeFace failed", "failed");
    }
  }
});

// ── Profile Saving ────────────────────────────────────────────────
// Converts the textarea into a JSON OBJECT for the RAG loop's
// `userProfile` key. Canonical storage shape: `{Key: value, ...}`.

function parseUserProfile(raw) {
  const text = raw.trim();

  // 1) Already JSON — accept only objects (canonical contract)
  if (text.startsWith("{") || text.startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { error: "Profile JSON is invalid. Fix it or use `Key: value` lines." };
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { profile: parsed };
    }
    return { error: "Profile must be a JSON object, e.g. {\"name\": \"Alice\"}." };
  }

  // 2) Empty — do not clobber a previously saved valid profile
  if (!text) {
    return { error: "Profile is empty. Enter data before saving." };
  }

  // 3) `Key: value` lines — one entry per line
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries = {};
  let validLines = 0;
  for (const line of lines) {
    const sepIdx = line.indexOf(":");
    if (sepIdx === -1) {
      // A line with no separator → freeform profile.
      return { profile: { notes: text } };
    }
    const key = line.slice(0, sepIdx).trim();
    const value = line.slice(sepIdx + 1).trim();
    if (!key) continue;
    entries[key] = value;
    validLines++;
  }

  if (validLines > 0) return { profile: entries };
  return { error: "Could not parse profile. Use `Key: value` lines or JSON." };
}

document.getElementById("save-profile-btn").addEventListener("click", async () => {
  const raw = document.getElementById("profile-input").value;
  const result = parseUserProfile(raw);

  if (!result.profile) {
    setStatus(result.error, "error");
    return;
  }

  await chrome.runtime.sendMessage({
    type: "SET_CONFIG",
    config: { userProfile: result.profile }
  });
  setStatus("Profile saved locally.", "success");
  setTimeout(() => clearStatus(), 2000);
});

// ── Scan Page Button ──────────────────────────────────────────────
// Triggers DOM scan + overlay without a VLM call.
// Useful for demos to show redaction before committing to a full run.

function formatAgentError(code, message) {
  const text = message || "";
  if (code === "NO_CONTENT_SCRIPT") {
    return `[${code}] ${text}`;
  }
  if (code === "FACE_REDACTION_REQUIRED") {
    return `[${code}] Face redaction did not complete — VLM call blocked so unredacted faces cannot leave the device. ${text}`;
  }
  if (code === "NER_REDACTION_REQUIRED") {
    return `[${code}] Name/place/org redaction did not complete — VLM call blocked so unredacted PII cannot leave the device. ${text}`;
  }
  if (code === "TIMEOUT" || code === "INIT_FAILED") {
    return `[${code}] On-device model init failed before any VLM call. ${text} Reload the extension at chrome://extensions if this repeats.`;
  }
  if (code === "VLM_BAD_RESPONSE") {
    return `[${code}] The VLM replied, but not with a usable action. ${text} Check the model is a vision model and that Ollama is healthy (\`ollama ps\`).`;
  }
  if (code === "BAD_JSON") {
    return `[${code}] Something returned non-JSON where JSON was expected — usually an on-device model asset download (Hugging Face / jsdelivr) or the VLM server. ${text} Check your network, then reload the extension.`;
  }
  return `[${code}] ${text}`;
}

function formatRuntimeDisconnect(err) {
  const msg = String(err?.message || err || "");
  if (
    msg.includes("Receiving end does not exist") ||
    msg.includes("Could not establish connection")
  ) {
    return "[NO_CONTENT_SCRIPT] Could not reach the page script (common after reloading the extension). Refresh this tab, then try again.";
  }
  return `Error: ${msg}`;
}

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  runBtn.disabled = true;
  clearStatus();
  previewWrap.classList.remove("visible");
  setPipeline("capture", { includeVlm: false });
  setStatus("Capturing viewport and running local redaction…");

  try {
    setPipeline("redact", { includeVlm: false });
    const result = await chrome.runtime.sendMessage({ type: "SCAN_AND_OVERLAY" });
    if (result.error) {
      setPipeline(null);
      setStatus(formatAgentError(result.errorCode || "UNKNOWN", result.error), "error");
    } else {
      if (result.receipt) showReceipt(result.receipt);
      showSanitizedPreview(result.sanitizedImage);
      setPipeline(null);
      const faces = result.receipt?.masked?.faces || 0;
      const fields = result.fieldCount || 0;
      setStatus(
        `Shield ON — ${fields} field(s) + ${faces} face(s) hidden on the live page. Ask Gemini now: it should only “see” the blacked-out regions. Preview below is what leaves the device.`,
        fields > 0 || faces > 0 ? "success" : "active"
      );
    }
  } catch (err) {
    setPipeline(null);
    setStatus(formatRuntimeDisconnect(err), "error");
  } finally {
    scanBtn.disabled = false;
    runBtn.disabled = false;
  }
});

// ── Run Agent Button ──────────────────────────────────────────────

runBtn.addEventListener("click", async () => {
  const task = document.getElementById("task-input").value.trim();
  if (!task) {
    setStatus("Enter a task description before running.", "error");
    return;
  }

  runBtn.disabled = true;
  scanBtn.disabled = true;
  clearStatus();
  previewWrap.classList.remove("visible");

  try {
    for (let step = 1; step <= MAX_AGENT_STEPS; step++) {
      const stepLabel = `Step ${step}/${MAX_AGENT_STEPS}`;
      setPipeline("capture");
      setStatus(`${stepLabel}: Capturing viewport and running local redaction…`);
      setPipeline("redact");

      const response = await chrome.runtime.sendMessage({ type: "CAPTURE_AND_SANITIZE", task });

      if (response.error) {
        setPipeline(null);
        setStatus(formatAgentError(response.errorCode || "UNKNOWN", response.error), "error");
        return;
      }

      if (response.receipt) showReceipt(response.receipt);
      showSanitizedPreview(response.sanitizedImage);

      setPipeline("vlm");

      if (response.vlmError) {
        setPipeline(null);
        setStatus(formatVlmOfflineMessage(response.vlmError), "warn");
        return;
      }

      if (!response.action) {
        setPipeline(null);
        setStatus(`${stepLabel}: No action returned from VLM. Check server logs.`, "warn");
        return;
      }

      setStatus(`${stepLabel}: VLM → ${response.action.action}. Executing…`);

      const execResult = await chrome.runtime.sendMessage({
        type: "EXECUTE_ACTION",
        action: response.action,
      });

      if (execResult.error) {
        setPipeline(null);
        setStatus(
          `${stepLabel}: ${formatAgentError(execResult.errorCode || "UNKNOWN", execResult.error)}`,
          "error"
        );
        return;
      }

      if (response.action.action === "done") {
        setPipeline(null);
        setStatus(`${stepLabel}: Done: ${response.action.summary}`, "success");
        return;
      }

      if (step >= MAX_AGENT_STEPS) {
        setPipeline(null);
        setStatus(
          `${stepLabel}: Step cap reached (${MAX_AGENT_STEPS}). Task may be incomplete — refine the prompt or run again.`,
          "warn"
        );
        return;
      }

      setStatus(`${stepLabel}: Executed ${response.action.action}. Replanning…`);
      await sleep(AGENT_STEP_DELAY_MS);
    }
  } catch (err) {
    setPipeline(null);
    setStatus(formatRuntimeDisconnect(err), "error");
  } finally {
    runBtn.disabled = false;
    scanBtn.disabled = false;
  }
});

// ── Init ──────────────────────────────────────────────────────────

loadConfig();
setupConfigListeners();
loadLastReceipt();
checkModelStatus();
