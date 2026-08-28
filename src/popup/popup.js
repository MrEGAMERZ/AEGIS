// Popup script — Controls extension settings and triggers agent

const statusEl    = document.getElementById("status");
const runBtn      = document.getElementById("run-btn");
const scanBtn     = document.getElementById("scan-btn");
const modelStatus = document.getElementById("model-status");
const receiptEl   = document.getElementById("receipt");

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
    keys: ["vlmEndpoint", "vlmModel", "faceDetection", "passwordDetection", "piiDetection"],
  });
  document.getElementById("vlm-endpoint").value =
    config.vlmEndpoint || "http://localhost:8000/v1/chat/completions";
  document.getElementById("vlm-model").value =
    config.vlmModel || "Qwen/Qwen3-VL-8B-Instruct";
  document.getElementById("face-detection").checked   = config.faceDetection !== false;
  document.getElementById("password-detection").checked = config.passwordDetection !== false;
  document.getElementById("pii-detection").checked    = config.piiDetection !== false;
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
}

// ── Model Status ──────────────────────────────────────────────────
// The inference worker reports its status via INIT_DONE / INIT_PROGRESS.
// The popup can't directly receive worker messages; we poll storage.
// For now: show "Ready (WASM)" as a placeholder since we can't easily
// get worker status into the popup without a more complex message relay.
// TODO: when the ML engineer implements model loading, forward INIT_DONE
// via background → popup messaging or chrome.storage.session.

function updateModelStatus(status, type) {
  modelStatus.textContent = status;
  modelStatus.className = `model-status ${type}`;
}

// Simple placeholder: mark as "Ready" since DOM-based detection always works.
// Face/NER model status will be properly surfaced in a follow-up task.
function checkModelStatus() {
  // For MVP: the DOM-based detection pipeline always works.
  // BlazeFace/NER show as "loading" until the worker sends INIT_DONE.
  updateModelStatus("● DOM ready", "ready");
}

// ── Scan Page Button ──────────────────────────────────────────────
// Triggers DOM scan + overlay without a VLM call.
// Useful for demos to show redaction before committing to a full run.

scanBtn.addEventListener("click", async () => {
  scanBtn.disabled = true;
  clearStatus();
  setStatus("Scanning page for sensitive fields…");

  try {
    const result = await chrome.runtime.sendMessage({ type: "SCAN_AND_OVERLAY" });
    if (result.error) {
      setStatus(`Scan error: ${result.error}`, "error");
    } else {
      setStatus(
        `Found ${result.fieldCount} sensitive field(s). Overlay shown on page.`,
        result.fieldCount > 0 ? "success" : "active"
      );
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    scanBtn.disabled = false;
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
  setStatus("Capturing screen and running sanitization pipeline…");

  try {
    const response = await chrome.runtime.sendMessage({ type: "CAPTURE_AND_SANITIZE", task });

    if (response.error) {
      const code = response.errorCode || "UNKNOWN";
      setStatus(`[${code}] ${response.error}`, "error");
      return;
    }

    // Show receipt
    if (response.receipt) showReceipt(response.receipt);

    // Surface VLM-level errors without crashing
    if (response.vlmError) {
      setStatus(`VLM unavailable: ${response.vlmError}`, "warn");
      return;
    }

    if (!response.action) {
      setStatus("No action returned from VLM. Check server logs.", "warn");
      return;
    }

    setStatus(`VLM → action: ${response.action.action}. Executing…`);

    const execResult = await chrome.runtime.sendMessage({
      type: "EXECUTE_ACTION",
      action: response.action,
    });

    if (execResult.error) {
      setStatus(`Execution error: ${execResult.error}`, "error");
    } else if (response.action.action === "done") {
      setStatus(`Done: ${response.action.summary}`, "success");
    } else {
      setStatus(`Executed: ${JSON.stringify(execResult)}`, "success");
    }
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
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
