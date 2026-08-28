// Service Worker — Event-driven orchestrator (no DOM access)

const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen/offscreen.html");

// ── Offscreen State ────────────────────────────────────────────────
// Do NOT use a boolean flag — it resets to false on every service worker
// restart, even if the offscreen document is still alive. Use getContexts()
// which queries Chrome's actual process state.

async function hasOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [OFFSCREEN_URL],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["DOM_PARSER", "WORKERS"],
    justification:
      "Inference and mask rendering require Canvas/DOM access; WORKERS reason required to spawn inference Web Worker inside offscreen document",
  });
}

// ── Message Router ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAPTURE_AND_SANITIZE") {
    handleCaptureAndSanitize(msg.task)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message, errorCode: classifyError(err) }));
    return true;
  }

  if (msg.type === "EXECUTE_ACTION") {
    handleExecuteAction(msg.action, sender.tab?.id)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "SCAN_AND_OVERLAY") {
    // Scan the active tab's DOM and show redaction overlay — no VLM call.
    handleScanAndOverlay()
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.type === "SET_CONFIG") {
    chrome.storage.local.set(msg.config).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "GET_CONFIG") {
    chrome.storage.local.get(msg.keys).then(sendResponse);
    return true;
  }

  if (msg.type === "GET_LAST_RECEIPT") {
    chrome.storage.session
      .get("lastReceipt")
      .then((r) => sendResponse(r.lastReceipt || null));
    return true;
  }
});

// ── Scan + Overlay (no VLM) ────────────────────────────────────────
// Used by the popup's "Scan page" button. Runs the DOM scan and shows
// the redaction overlay in the active tab — no screenshot, no VLM call.

async function handleScanAndOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const domScanResults = await chrome.tabs.sendMessage(tab.id, { type: "DOM_SCAN" });

  // Show overlay in the content script
  await chrome.tabs.sendMessage(tab.id, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
  });

  return {
    fieldCount: domScanResults.fields?.length || 0,
    dpr: domScanResults.dpr || 1,
    url: tab.url,
  };
}

// ── Core Pipeline ──────────────────────────────────────────────────

async function handleCaptureAndSanitize(task) {
  const t0 = Date.now();

  // 1. Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  // 2. Capture screenshot
  const t1 = Date.now();
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const tCapture = Date.now() - t1;

  // 3. DOM scan (includes dpr)
  const t2 = Date.now();
  const domScanResults = await chrome.tabs.sendMessage(tab.id, { type: "DOM_SCAN" });
  const tDomScan = Date.now() - t2;

  // Show redaction overlay immediately after DOM scan, before inference
  // (gives visual feedback while the offscreen pipeline runs)
  chrome.tabs.sendMessage(tab.id, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
  }).catch(() => {}); // non-critical, don't let overlay failure block pipeline

  // 4. Offscreen: inference + masking
  await ensureOffscreen();
  const t3 = Date.now();
  const sanitizeResponse = await chrome.runtime.sendMessage({
    type: "SANITIZE",
    screenshot: screenshotDataUrl,
    domScanResults,
  });
  const tInference = Date.now() - t3;

  if (sanitizeResponse?.error) throw new Error(sanitizeResponse.error);

  // 5. Build structural context payload
  const config = await chrome.storage.local.get(["vlmEndpoint", "vlmModel"]);
  // Default: Ollama running locally (verified working — see docs/SERVER_SETUP.md)
  const vlmEndpoint = config.vlmEndpoint || "http://localhost:11434/v1/chat/completions";
  const vlmModel = config.vlmModel || "qwen2.5vl:7b";

  const pageStructure = {
    url: tab.url,
    title: tab.title,
    fields: domScanResults.fields || [],
    maskedRegions: sanitizeResponse.maskedRegions || [],
    dpr: domScanResults.dpr || 1,
  };

  // 6. VLM call
  const t4 = Date.now();
  let action = null;
  let vlmError = null;

  try {
    const vlmPayload = {
      model: vlmModel,
      messages: [
        {
          role: "system",
          content:
            "You are a browser automation agent. You receive a sanitized screenshot where sensitive data (passwords, faces, personal info) has been pixelated or blacked out for privacy. You also receive a structural description of the page. Based on the user's task, return ONLY a single JSON object with no markdown or explanation. Available actions: {\"action\":\"click\",\"x\":N,\"y\":N}, {\"action\":\"type\",\"selector\":\"CSS\",\"value\":\"text\"}, {\"action\":\"scroll\",\"direction\":\"up\"|\"down\"}, {\"action\":\"navigate\",\"url\":\"URL\"}, {\"action\":\"done\",\"summary\":\"...\"}. Only use actions that do NOT require reading redacted content.",
        },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: sanitizeResponse.sanitizedImage } },
            {
              type: "text",
              text: `Page structure: ${JSON.stringify(pageStructure)}\n\nTask: ${task}`,
            },
          ],
        },
      ],
      max_tokens: 256,
      temperature: 0.1,
    };

    const vlmResponse = await fetch(vlmEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(vlmPayload),
    });

    if (!vlmResponse.ok) {
      vlmError = `VLM API error: ${vlmResponse.status} ${vlmResponse.statusText}`;
    } else {
      const vlmData = await vlmResponse.json();
      const actionRaw = vlmData.choices?.[0]?.message?.content;
      action = parseAction(actionRaw);
    }
  } catch (fetchErr) {
    vlmError = fetchErr.message.includes("fetch")
      ? "VLM server unreachable. Is it running at " + vlmEndpoint + "?"
      : fetchErr.message;
  }

  const tVlm = Date.now() - t4;

  // 7. Privacy receipt
  const receipt = {
    timestamp: new Date().toISOString(),
    url: tab.url,
    masked: {
      passwordFields: (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "password_input" || r.type === "sensitive_input").length,
      faces: (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "face").length,
      piiSpans: (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "pii").length,
    },
    backend: sanitizeResponse.backend || "wasm",
    latencyMs: { capture: tCapture, domScan: tDomScan, inference: tInference, vlm: tVlm },
    totalMs: Date.now() - t0,
  };

  // Store receipt in session storage (cleared on browser close, not persisted)
  await chrome.storage.session.set({ lastReceipt: receipt });

  return { pageStructure, action, sanitizedImage: sanitizeResponse.sanitizedImage, receipt, vlmError };
}

// ── Action Parser ──────────────────────────────────────────────────

function parseAction(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON from markdown code block
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) {
      try { return JSON.parse(match[1].trim()); } catch { /* fall through */ }
    }
    // Try to find first { ... } in the text
    const braceMatch = raw.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try { return JSON.parse(braceMatch[0]); } catch { /* fall through */ }
    }
    return null;
  }
}

// ── Error Classification ───────────────────────────────────────────

function classifyError(err) {
  if (err.message?.includes("No active tab")) return "NO_ACTIVE_TAB";
  if (err.message?.includes("VLM")) return "BACKEND_UNAVAILABLE";
  if (err.message?.includes("timed out")) return "TIMEOUT";
  if (err.message?.includes("offscreen")) return "OFFSCREEN_ERROR";
  return "UNKNOWN";
}

// ── Action Executor ────────────────────────────────────────────────

async function handleExecuteAction(action, tabId) {
  if (!action) return { error: "No action provided" };

  // Validate action shape before executing
  const VALID_ACTIONS = ["click", "type", "scroll", "navigate", "done"];
  if (!VALID_ACTIONS.includes(action.action)) {
    return { error: `Unknown action: ${action.action}. Valid: ${VALID_ACTIONS.join(", ")}` };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetTabId = tabId || tab?.id;
  if (!targetTabId) throw new Error("No active tab");

  switch (action.action) {
    case "click":
      return chrome.tabs.sendMessage(targetTabId, { type: "EXECUTE_CLICK", x: action.x, y: action.y });

    case "type":
      return chrome.tabs.sendMessage(targetTabId, { type: "EXECUTE_TYPE", selector: action.selector, value: action.value });

    case "scroll":
      return chrome.tabs.sendMessage(targetTabId, { type: "EXECUTE_SCROLL", direction: action.direction });

    case "navigate":
      await chrome.tabs.update(targetTabId, { url: action.url });
      return { ok: true, navigated: action.url };

    case "done":
      // Clear overlay when agent reports task complete
      chrome.tabs.sendMessage(targetTabId, { type: "CLEAR_REDACTION_OVERLAY" }).catch(() => {});
      return { ok: true, summary: action.summary };
  }
}

// ── Extension Install ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    // Verified working — see docs/SERVER_SETUP.md
    vlmEndpoint: "http://localhost:11434/v1/chat/completions",
    vlmModel: "qwen2.5vl:7b",
    detectionEnabled: true,
    faceDetection: true,
    passwordDetection: true,
    piiDetection: true,
  });
});
