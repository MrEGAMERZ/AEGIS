// Service Worker — Event-driven orchestrator (no DOM access)

const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen/offscreen.html");

const DEFAULT_OLLAMA_VLM = "http://localhost:11434/v1/chat/completions";
const DEFAULT_GATEWAY_VLM = "http://localhost:8000/v1/chat/completions";
const DEFAULT_GATEWAY_HEALTH = "http://localhost:8000/health";
const DEFAULT_VLM_MODEL = "qwen2.5vl:7b";
const VLM_FETCH_TIMEOUT_MS = 120000;

// ── Local document vault module (lazy) ────────────────────────────
// doc-vault.js owns vault storage, snippet retrieval, structured-output
// validation, and the vault provenance predicate. It attaches
// `globalThis.AegisDocVault` (no import/export statements), so it can be
// loaded two ways:
//   1. Browser MV3 module SW: lazy `import("./doc-vault.js")` below.
//   2. Node VM harnesses: the harness runs doc-vault.js in the SAME sandbox
//      before background.js, so `globalThis.AegisDocVault` already exists and
//      getDocVault() resolves without ever touching dynamic import (which the
//      VM sandbox cannot link).
const MAX_STRUCTURE_INPUT_CHARS = 60000; // mirrors doc-vault.js constant

let _docVaultPromise = null;
function getDocVault() {
  if (globalThis.AegisDocVault) return Promise.resolve(globalThis.AegisDocVault);
  if (!_docVaultPromise) {
    _docVaultPromise = import("./doc-vault.js")
      .then(() => globalThis.AegisDocVault || null)
      .catch((err) => {
        _docVaultPromise = null;
        throw err;
      });
  }
  return _docVaultPromise;
}

// Synchronous provenance check for sanitizeAction(): a "type" value passes the
// anti-hallucination guard only if it is traceable to the profile OR to the
// user's OWN stored document text (cached vault texts; empty cache → false →
// fail closed, which is exactly the pre-vault behavior).
//
// D9 (privacy audit 2026-09-06): vault provenance is permitted ONLY on the
// local-VLM path. handleCaptureAndSanitize() flips this flag from the RESOLVED
// endpoint's locality — a remote capture disables it, so sanitizeAction falls
// back to profile-only matching even if a future code path re-populates the
// vault-text cache. Default true = pre-feature behavior (cache empty at boot).
let vaultProvenanceLocalOnly = true;

function vaultAllowsValue(value) {
  try {
    if (!vaultProvenanceLocalOnly) return false;
    const api = globalThis.AegisDocVault;
    if (!api || typeof api.vaultContainsValue !== "function") return false;
    return api.vaultContainsValue(value, api.getCachedVaultTexts());
  } catch {
    return false;
  }
}

// Best-effort refresh of the synchronous vault-text cache (used by
// handleExecuteAction's re-validation so a vault-sourced "type" survives the
// second guard pass after a capture-less EXECUTE_ACTION).
async function refreshVaultCacheBestEffort() {
  try {
    const api = await getDocVault();
    await api.refreshVaultCache();
  } catch {
    // Vault unavailable → cache stays as-is → guard degrades to profile-only.
  }
}

// ── Audit Log Helper ──────────────────────────────────────────────
async function writeAuditLog(entry) {
  try {
    const { aegisAuditLogs = [] } = await chrome.storage.local.get(["aegisAuditLogs"]);
    aegisAuditLogs.unshift(entry);
    // Keep last 50 entries
    if (aegisAuditLogs.length > 50) aegisAuditLogs.length = 50;
    await chrome.storage.local.set({ aegisAuditLogs });
  } catch {}
}

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

// ── Document text extraction (popup → offscreen router) ───────────
// The heavy lifting happens in the offscreen document (DOM + module imports):
// this service worker only guarantees the offscreen document exists, forwards
// the payload, and relays the { text, format } answer. Base64 round-trips a
// message-bounded size; see MAX_DOCUMENT_BYTES in src/shared/file-helpers.js.

async function handleExtractDocumentText(filePayload) {
  if (!filePayload || typeof filePayload.arrayBufferBase64 !== "string") {
    throw new Error("DOC_EXTRACT_NO_FILE: expected { name, size, mimeType, arrayBufferBase64 }");
  }
  await ensureOffscreen();
  const response = await chrome.runtime.sendMessage({
    type: "EXTRACT_DOCUMENT_TEXT",
    file: filePayload,
  });
  if (!response || typeof response !== "object") {
    throw new Error("DOC_EXTRACT_NO_RESPONSE: the offscreen document did not answer");
  }
  return response;
}

// ── Content-script injection (file:// + post-reload) ───────────────
// After an unpacked Reload, existing tabs keep an *orphaned* content
// script whose chrome.runtime port is dead. chrome.tabs.sendMessage then
// fails with "Could not establish connection. Receiving end does not exist."
// Manifest <all_urls> covers file:// only when "Allow access to file URLs"
// is on; we still programmatically inject and retry once.

const CONTENT_SCRIPT_FILE = "src/content/content.js";
const injectInFlight = new Map();

function isMissingReceiver(err) {
  const msg = String(err?.message || err || "");
  return (
    msg.includes("Receiving end does not exist") ||
    msg.includes("Could not establish connection")
  );
}

function isInjectableTabUrl(url) {
  if (!url || typeof url !== "string") return false;
  try {
    const u = new URL(url);
    const p = u.protocol.toLowerCase();
    return p === "http:" || p === "https:" || p === "file:";
  } catch {
    return false;
  }
}

function noContentScriptError(tab) {
  const url = typeof tab?.url === "string" ? tab.url : "";
  const fileHint = url.startsWith("file:")
    ? ' For a local HTML file, keep "Allow access to file URLs" enabled on chrome://extensions.'
    : "";
  return new Error(
    "NO_CONTENT_SCRIPT: Could not reach the page script (common after reloading the extension)." +
      " Refresh this tab, then try again." +
      fileHint
  );
}

async function injectContentScript(tabId) {
  const existing = injectInFlight.get(tabId);
  if (existing) return existing;
  const p = chrome.scripting
    .executeScript({
      target: { tabId, allFrames: false },
      files: [CONTENT_SCRIPT_FILE],
      injectImmediately: true,
    })
    .finally(() => {
      injectInFlight.delete(tabId);
    });
  injectInFlight.set(tabId, p);
  return p;
}

async function sendTabMessage(tab, message) {
  const tabId = tab?.id;
  if (!tabId) throw new Error("No active tab");

  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    if (!isMissingReceiver(err)) throw err;
    if (!isInjectableTabUrl(tab.url)) throw noContentScriptError(tab);
    try {
      await injectContentScript(tabId);
    } catch {
      throw noContentScriptError(tab);
    }
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch {
      throw noContentScriptError(tab);
    }
  }
}

// ── Keyboard Shortcut Listener (Ctrl+Shift+F) ─────────────────────
chrome.commands?.onCommand?.addListener(async (command) => {
  if (command === "autofill_page") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      sendTabMessage(tab, { type: "PROFILE_PREFILL" }).catch(() => {});
    }
  }
});

// ── Context Menu (Right-Click "Fill with Aegis Profile") ─────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus?.create({
    id: "aegis_autofill_context",
    title: "Fill Form with Aegis Profile",
    contexts: ["page", "editable"],
  });
});

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (info.menuItemId === "aegis_autofill_context" && tab?.id) {
    sendTabMessage(tab, { type: "PROFILE_PREFILL" }).catch(() => {});
  }
});

// ── Message Router ─────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "CAPTURE_AND_SANITIZE") {
    handleCaptureAndSanitize(msg.task)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "EXECUTE_ACTION") {
    handleExecuteAction(msg.action, sender.tab?.id)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "PROFILE_PREFILL") {
    handleProfilePrefill()
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "SCAN_AND_OVERLAY") {
    // Scan the active tab's DOM and show redaction overlay — no VLM call.
    handleScanAndOverlay()
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "SET_CONFIG") {
    const safe = sanitizeLocalConfig(msg.config);
    chrome.storage.local.set(safe).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === "GET_GATEWAY_STATUS") {
    (async () => {
      const gateway = await probeRealGateway();
      sendResponse({
        ok: !!gateway,
        endpoint: gateway || DEFAULT_GATEWAY_VLM,
        usingGateway: !!gateway,
      });
    })();
    return true;
  }

  if (msg.type === "GET_CONFIG") {
    chrome.storage.local.get(msg.keys).then((stored) => {
      sendResponse(sanitizeLocalConfig(stored));
    });
    return true;
  }

  if (msg.type === "SET_VLM_API_KEY") {
    const key = typeof msg.vlmApiKey === "string" ? msg.vlmApiKey.trim() : "";
    const op = key
      ? chrome.storage.session.set({ vlmApiKey: key })
      : chrome.storage.session.remove("vlmApiKey");
    op.then(() => sendResponse({ ok: true, configured: !!key }));
    return true;
  }

  if (msg.type === "GET_VLM_API_KEY_STATUS") {
    chrome.storage.session.get("vlmApiKey").then((r) => {
      const key = r.vlmApiKey;
      sendResponse({
        configured: typeof key === "string" && key.length > 0,
      });
    });
    return true;
  }

  if (msg.type === "GET_LAST_RECEIPT") {
    chrome.storage.session
      .get("lastReceipt")
      .then((r) => sendResponse(r.lastReceipt || null));
    return true;
  }

  if (msg.type === "EXTRACT_DOCUMENT_TEXT") {
    // Popup → offscreen document routing for the on-device document ingestion
    // pipeline. The popup sends { name, size, mimeType, arrayBufferBase64 };
    // the offscreen document decodes/parses it (pdf.js / pako / DOMParser) and
    // answers { text, format, error? }. Nothing here touches the network.
    handleExtractDocumentText(msg.file)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          text: "",
          format: "text", // format authority is the offscreen document
          error: err.message,
        })
      );
    return true;
  }

  if (msg.type === "WARM_MODELS") {
    (async () => {
      try {
        await ensureOffscreen();
        const warm = await chrome.runtime.sendMessage({ type: "WARM_WORKER" });
        sendResponse(warm || { ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true;
  }

  if (msg.type === "STRUCTURE_DOCUMENT_TEXT") {
    // User's OWN extracted document text → LOCAL VLM only. Rejected up-front
    // when the resolved endpoint is remote (see handler). Returns
    // { fields: {dynamicKey: value}, latencyMs } — fields are merged into the
    // profile by the popup, never persisted raw here.
    handleStructureDocumentText(msg)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "ADD_DOC_TO_VAULT") {
    // User opts to keep the extracted text in the local vault (aegisDocVault).
    // Aadhaar/PAN are scrubbed before anything is persisted.
    handleAddDocToVault(msg)
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "GET_DOC_VAULT") {
    // Dashboard listing: names + char counts ONLY. Text never leaves the
    // vault / is never returned to the caller.
    handleGetDocVault()
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }

  if (msg.type === "CLEAR_DOC_VAULT") {
    // Full purge (D6): empties aegisDocVault AND strips every `_docSource`
    // marker from the active profile. Wired for the dashboard/toggle to call.
    handleClearDocVault()
      .then(sendResponse)
      .catch((err) =>
        sendResponse({
          error: err.message,
          errorCode: classifyError(err),
        })
      );
    return true;
  }
});

// Keys that must never be written to chrome.storage.local (F-11 / session-secret rule).
const FORBIDDEN_LOCAL_SECRET_KEYS = ["vlmApiKey", "apiKey", "authorization", "token", "secret"];

function isOllamaDirectEndpoint(endpoint) {
  if (typeof endpoint !== "string") return false;
  return /localhost:11434|127\.0\.0\.1:11434|\[::1\]:11434/.test(endpoint);
}

function preferGatewayEndpoint(endpoint) {
  if (isOllamaDirectEndpoint(endpoint)) return DEFAULT_GATEWAY_VLM;
  if (typeof endpoint === "string" && endpoint.trim()) return endpoint.trim();
  return DEFAULT_GATEWAY_VLM;
}

function sanitizeLocalConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (FORBIDDEN_LOCAL_SECRET_KEYS.includes(k)) continue;
    out[k] = k === "vlmEndpoint" ? preferGatewayEndpoint(v) : v;
  }
  return out;
}

async function probeRealGateway() {
  try {
    const res = await fetch(DEFAULT_GATEWAY_HEALTH, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const health = await res.json();
    if (health && health.status === "ok" && health.mock !== true) {
      return DEFAULT_GATEWAY_VLM;
    }
  } catch {
    // Down, slow, or fake (--mock). Do not treat that as a working VLM.
  }
  return null;
}

async function resolveVlmEndpoint(stored) {
  const preferred = preferGatewayEndpoint(stored);
  const gateway = await probeRealGateway();
  const resolved = gateway || preferred;
  if (resolved !== stored) {
    chrome.storage.local.set({ vlmEndpoint: resolved }).catch(() => {});
  }
  return resolved;
}

function isLocalVlmEndpoint(endpoint) {
  if (typeof endpoint !== "string" || !endpoint.trim()) return false;
  try {
    const u = new URL(endpoint);
    const host = (u.hostname || "").toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

// Bearer token for OpenAI-compatible hosts (Ollama needs none; Gemini's
// OpenAI-compat endpoint accepts Authorization: Bearer <key>). Empty key
// → no Authorization header, so local Ollama keeps working.
function buildVlmAuthHeaders(apiKey, endpoint) {
  const headers = { "Content-Type": "application/json" };
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  if (key && !isLocalVlmEndpoint(endpoint)) {
    headers.Authorization = `Bearer ${key}`;
  }
  return headers;
}

function buildPageStructureForVlm({ fields, maskedRegions, dpr, viewport }) {
  // Finding D: never send tab URL, query string, fragment, or title to the VLM.
  const scale = typeof dpr === "number" && dpr > 0 ? dpr : 1;
  const structure = {
    fields: Array.isArray(fields) ? fields : [],
    maskedRegions: Array.isArray(maskedRegions) ? maskedRegions : [],
    dpr: scale,
  };
  // Pixel size of the sanitized image, so the model knows the valid range for
  // click coordinates instead of guessing (or echoing the prompt's example).
  if (viewport && viewport.width > 0 && viewport.height > 0) {
    structure.imageSize = {
      width: Math.round(viewport.width * scale),
      height: Math.round(viewport.height * scale),
    };
  }
  return structure;
}

// ── Scan + local redaction (no VLM) ───────────────────────────────
// Popup "Privacy scan": DOM overlays + capture + BlazeFace/NER sanitize,
// sanitized preview + privacy receipt — hero path when Ollama is offline.

function buildPrivacyReceipt(tab, sanitizeResponse, timing) {
  const receipt = {
    timestamp: new Date().toISOString(),
    url: tab.url,
    masked: {
      passwordFields: (sanitizeResponse.maskedRegions || []).filter(
        (r) => r.type === "password_input" || r.type === "sensitive_input"
      ).length,
      faces: (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "face").length,
      piiSpans: (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "pii").length,
    },
    backend: sanitizeResponse.backend || "wasm",
    vlmRetried: timing.vlmRetried || false,
    latencyMs: {
      capture: timing.tCapture,
      domScan: timing.tDomScan,
      inference: timing.tInference,
    },
    totalMs: Date.now() - timing.t0,
  };
  if (timing.tVlm != null) receipt.latencyMs.vlm = timing.tVlm;
  if (timing.tRag != null) receipt.latencyMs.rag = timing.tRag;
  return receipt;
}

async function performLocalRedaction(tab, config) {
  const t0 = Date.now();
  const passwordDetectionEnabled = config.passwordDetection !== false;
  const faceDetectionEnabled = config.faceDetection !== false;
  const piiDetectionEnabled = config.piiDetection !== false;

  if (isInjectableTabUrl(tab.url)) {
    await sendTabMessage(tab, { type: "CLEAR_REDACTION_OVERLAY" }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, OVERLAY_CLEAR_PAINT_MS));
  }

  const t1 = Date.now();
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const tCapture = Date.now() - t1;

  const t2 = Date.now();
  const domScanResults = await sendTabMessage(tab, { type: "DOM_SCAN" });
  domScanResults.fields = filterFieldsForPasswordDetection(
    domScanResults.fields,
    passwordDetectionEnabled
  );
  const tDomScan = Date.now() - t2;

  sendTabMessage(tab, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
  }).catch(() => {});

  await ensureOffscreen();
  const t3 = Date.now();
  const sanitizeResponse = await chrome.runtime.sendMessage({
    type: "SANITIZE",
    screenshot: screenshotDataUrl,
    domScanResults,
    faceDetection: faceDetectionEnabled,
    piiDetection: piiDetectionEnabled,
  });
  const tInference = Date.now() - t3;

  if (sanitizeResponse?.error) throw new Error(sanitizeResponse.error);

  assertReadyForVlm(sanitizeResponse, {
    faceDetection: faceDetectionEnabled,
    piiDetection: piiDetectionEnabled,
  });

  const faceRegions = (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "face");
  sendTabMessage(tab, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
    faces: faceRegions,
    dpr: sanitizeResponse.dpr || domScanResults.dpr || 1,
  }).catch(() => {});

  const receipt = buildPrivacyReceipt(tab, sanitizeResponse, {
    t0,
    tCapture,
    tDomScan,
    tInference,
  });

  return { domScanResults, sanitizeResponse, receipt, t0, tCapture, tDomScan, tInference };
}

async function handleProfilePrefill() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");
  return sendTabMessage(tab, { type: "PROFILE_PREFILL" });
}

async function handleScanAndOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const config = await chrome.storage.local.get([
    "faceDetection",
    "piiDetection",
    "passwordDetection",
  ]);

  const { domScanResults, sanitizeResponse, receipt } = await performLocalRedaction(tab, config);

  await chrome.storage.session.set({ lastReceipt: receipt });

  const maskedFaces = receipt?.masked?.faces || 0;
  const maskedPii = receipt?.masked?.piiSpans || 0;
  const maskedFields = receipt?.masked?.passwordFields || 0;
  await writeAuditLog({
    domain: tab.url ? new URL(tab.url).hostname : "unknown",
    action: "scan",
    fields: maskedFields + maskedPii,
    faces: maskedFaces,
    time: new Date().toLocaleString(),
  });

  return {
    fieldCount: domScanResults.fields?.length || 0,
    dpr: domScanResults.dpr || 1,
    url: tab.url,
    sanitizedImage: sanitizeResponse.sanitizedImage,
    receipt,
  };
}

// ── Document Structuring + Local Vault ────────────────────────────
// Privacy boundary: the user's OWN extracted document text goes to the LOCAL
// VLM only — never a remote endpoint (absolute: rejected up-front), never
// persisted raw, never logged raw. Structured fields are returned to the popup
// which merges them into the profile; the text itself is stored ONLY if the
// user opted into the local vault, and even then Aadhaar/PAN are scrubbed.

async function handleStructureDocumentText(msg) {
  const text = typeof msg?.text === "string" ? msg.text : "";
  if (!text.trim()) {
    throw new Error("STRUCTURE_EMPTY_TEXT: No document text provided to structure.");
  }
  if (text.length > MAX_STRUCTURE_INPUT_CHARS) {
    throw new Error(
      `STRUCTURE_TOO_LARGE: Document text is too large to structure (${text.length} chars, max ${MAX_STRUCTURE_INPUT_CHARS}).`
    );
  }

  // D3 (privacy audit): consent is enforced HERE, in the background — the
  // popup checkbox is only the UI. Default OFF: either the stored
  // chrome.storage.local `docConsent` flag must be === true OR the message
  // must carry consented:true (the popup sends it only when the toggle is
  // checked). Without consent no VLM request is made, even if the popup (or a
  // co-installed extension) sends text directly.
  const { docConsent } = await chrome.storage.local.get("docConsent");
  const consented = docConsent === true || msg?.consented === true;
  if (!consented) {
    throw new Error(
      "STRUCTURE_CONSENT_REQUIRED: Analyzing a document needs your explicit consent. Enable \"Allow local document analysis\" in the popup."
    );
  }

  const api = await getDocVault();

  const limiter = api.structureRateLimit(1000);
  if (!limiter.ok) {
    throw new Error(
      `STRUCTURE_RATE_LIMITED: The analyzer is still busy — try again in ${Math.ceil(limiter.retryAfterMs)}ms.`
    );
  }

  const config = await chrome.storage.local.get(["vlmEndpoint", "vlmModel"]);
  const vlmEndpoint = await resolveVlmEndpoint(config.vlmEndpoint);

  // THE guard: raw document text must never reach a remote AI. This runs
  // before any request is made — a remote endpoint means no VLM call at all.
  if (!isLocalVlmEndpoint(vlmEndpoint)) {
    throw new Error(
      "Document text cannot be sent to a remote AI. Switch to the local model."
    );
  }

  const vlmModel = config.vlmModel || DEFAULT_VLM_MODEL;
  const sessionSecrets = await chrome.storage.session.get(["vlmApiKey"]);
  const vlmHeaders = buildVlmAuthHeaders(sessionSecrets.vlmApiKey, vlmEndpoint);

  const systemPrompt =
    `You are a privacy-preserving local document structurer. The user uploaded their own document and explicitly consented to analyzing it with the LOCAL model only.

Convert the document text into a JSON object that maps profile field names to their values. Example: {"fullName": "...", "email": "...", "skills": "...", "university": "..."}

RULES:
1. Output ONLY a single JSON object — no prose, no explanations, no markdown code fences. Start with { and end with }.
2. Field names are short lowercase keys (max 40 characters), one per distinct piece of information. ANY key is allowed — invent the key that best matches the information (e.g. "skills", "university", "motherTongue").
3. Values are the exact text found in the document, trimmed (max 500 characters), always as JSON strings.
4. NEVER include Aadhaar, PAN, CVV, passport, UPI, or bank/card numbers in the output — omit those fields entirely.
5. If the document contains no extractable fields, output an empty object: {}
6. Do not infer or invent information that is not stated in the document.`;

  const t0 = Date.now();
  let raw;
  try {
    raw = await requestVlmContent(vlmEndpoint, vlmHeaders, {
      model: vlmModel,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Document text:\n${text}` },
      ],
      max_tokens: 512,
      temperature: 0.1,
    });
  } catch (err) {
    const vlmMs = Date.now() - t0;
    throw new Error(`${err.message} (structuring took ${vlmMs}ms)`);
  }
  const tVlm = Date.now() - t0;

  const parsed = api.parseStructuredFields(raw);
  const { fields, dropped } = parsed
    ? api.validateStructuredFields(parsed)
    : { fields: {}, dropped: 1 };

  // Audit log: counts only — never the text, never the raw reply.
  await writeAuditLog({
    action: "structure",
    fields: Object.keys(fields).length,
    dropped,
    time: new Date().toLocaleString(),
  });

  return {
    fields,
    dropped,
    latencyMs: { vlm: tVlm, total: Date.now() - t0 },
    endpoint: vlmEndpoint,
  };
}

async function handleAddDocToVault(msg) {
  const api = await getDocVault();
  const res = await api.addDocToVault({
    docName: msg?.docName,
    format: msg?.format,
    text: msg?.text,
  });
  if (!res.ok) {
    return { error: res.error, ok: false };
  }
  return { ok: true, doc: res.doc, vault: { count: res.count, bytes: res.bytes } };
}

async function handleGetDocVault() {
  const api = await getDocVault();
  const docs = await api.getVaultList();
  return { docs };
}

async function handleClearDocVault() {
  const api = await getDocVault();
  await api.clearVault();
  // D6: purge also strips every `_docSource*` marker from the active profile
  // (fields that were derived from a vaulted document). Non-marker fields are
  // preserved — this is a doc purge, not a profile wipe.
  const { userProfile } = await chrome.storage.local.get("userProfile");
  let removedDocSourceMarkers = 0;
  if (userProfile && typeof userProfile === "object" && !Array.isArray(userProfile)) {
    const clean = {};
    for (const [k, v] of Object.entries(userProfile)) {
      if (String(k).startsWith("_docSource")) {
        removedDocSourceMarkers++;
        continue;
      }
      clean[k] = v;
    }
    if (removedDocSourceMarkers > 0) {
      await chrome.storage.local.set({ userProfile: clean });
    }
  }
  return { ok: true, removedDocSourceMarkers };
}

// ── Profile Normalization ─────────────────────────────────────────
// The popup saves userProfile as raw text. Accept a JSON object, a JSON
// object string, or free text, and always return a flat {key: value} map
// so the VLM system prompt shows real profile pairs (never char indices).
// Never throws — returns {} on any malformed/empty input.

function normalizeProfile(raw) {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    // JSON object string
    let candidate = null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      candidate = null;
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return normalizeProfile(candidate);
    }
    if (candidate !== null) return {}; // valid JSON but not an object (array/scalar)
    // Free text: try structured `Key: value` lines, else wrap as raw blob
    const entries = {};
    let ok = true;
    let sawAny = false;
    for (const line of trimmed.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue; // tolerate blank lines
      const m = t.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/);
      if (!m || !m[1].trim() || !m[2].trim()) { ok = false; break; }
      entries[m[1].trim()] = m[2].trim();
      sawAny = true;
    }
    if (ok && sawAny) return entries;
    return { raw: trimmed };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "object" ? safeStringify(v) : String(v);
  }
  return out;
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ── Core Pipeline ──────────────────────────────────────────────────

// Bounded multi-step agent loop — popup runs capture→execute cycles until
// done, sanitize/VLM/execute error, or cap. Constants exported for harness.
const MAX_AGENT_STEPS = 10;
const AGENT_STEP_DELAY_MS = 400;

// When passwordDetection is off, skip type="password" fields for masking and
// overlay only — sensitive_input / NER / face gates stay fail-closed.
function filterFieldsForPasswordDetection(fields, passwordDetectionEnabled) {
  const list = Array.isArray(fields) ? fields : [];
  if (passwordDetectionEnabled !== false) return list;
  return list.filter((f) => f && f.type !== "password_input");
}

function agentLoopStopAfterCapture(captureResult) {
  if (captureResult?.error) {
    return {
      stop: true,
      phase: "capture",
      errorCode: captureResult.errorCode,
      error: captureResult.error,
    };
  }
  if (captureResult?.vlmError) {
    return { stop: true, phase: "vlm", error: captureResult.vlmError };
  }
  if (!captureResult?.action) {
    return { stop: true, phase: "vlm", error: "No action returned from VLM." };
  }
  return { stop: false, action: captureResult.action };
}

function agentLoopStopAfterExecute({ step, maxSteps, action, execResult }) {
  if (execResult?.error) {
    return {
      stop: true,
      phase: "execute",
      errorCode: execResult.errorCode,
      error: execResult.error,
    };
  }
  if (action?.action === "done") {
    return {
      stop: true,
      phase: "done",
      summary: action.summary || execResult?.summary,
    };
  }
  if (step >= maxSteps) {
    return { stop: true, phase: "max_steps", step, maxSteps };
  }
  return { stop: false };
}

// Two frames at 60Hz — enough for an overlay clear to composite before capture.
const OVERLAY_CLEAR_PAINT_MS = 32;

async function handleCaptureAndSanitize(task) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const config = await chrome.storage.local.get([
    "vlmEndpoint",
    "vlmModel",
    "userProfile",
    "faceDetection",
    "piiDetection",
    "passwordDetection",
  ]);

  const {
    domScanResults,
    sanitizeResponse,
    t0,
    tCapture,
    tDomScan,
    tInference,
  } = await performLocalRedaction(tab, config);

  const faceDetectionEnabled = config.faceDetection !== false;
  const piiDetectionEnabled = config.piiDetection !== false;
  const vlmEndpoint = await resolveVlmEndpoint(config.vlmEndpoint);
  const vlmModel = config.vlmModel || DEFAULT_VLM_MODEL;
  const userProfile = normalizeProfile(config.userProfile);

  const pageStructure = buildPageStructureForVlm({
    fields: redactNerSpansInFields(domScanResults.fields || [], sanitizeResponse.nerEntities),
    maskedRegions: sanitizeResponse.maskedRegions || [],
    dpr: domScanResults.dpr || 1,
    viewport: domScanResults.viewport,
  });

  // 6. VLM call
  const t4 = Date.now();
  let action = null;
  let vlmError = null;
  let vlmRetried = false;
  let tRagMs = 0;

  try {
    // Build the system prompt.
    // If the user has saved a profile, inject it as the retrieval context (RAG).
    // The VLM is told EXACTLY what profile data is available and what to do
    // when a field has no matching profile value — return a done action asking
    // the user, NOT hallucinate an answer.
    const profileKeys = Object.keys(userProfile);
    const hasProfile = profileKeys.length > 0;
    const profileBlock = hasProfile
      ? `USER PROFILE (available data):
${Object.entries(userProfile)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join("\n")}`
      : "USER PROFILE: (Empty. No data is available.)";
    const allowedKeysBlock = hasProfile
      ? `AVAILABLE PROFILE KEYS (the ONLY values you may put in "profileKey"): ${profileKeys.map((k) => `"${k}"`).join(", ")}`
      : `AVAILABLE PROFILE KEYS: (none — the profile is empty, so you MUST use the "done" action for any field request)`;

    // RAG-lite — LOCAL VLM ONLY (privacy audit finding D9): pull the top
    // relevant snippets from the user's OWN uploaded documents (local vault).
    // These are the ONLY other values the model may type — and sanitizeAction()
    // re-verifies every "type" value against the stored vault text (see
    // vaultAllowsValue), same provenance bar as the profile. When the RESOLVED
    // endpoint is remote, vault text must NEVER enter this prompt: the block is
    // omitted, the vault-provenance cache is cleared, and vaultProvenanceLocalOnly
    // is disabled so sanitizeAction falls back to profile-only matching.
    const ragAllowed = isLocalVlmEndpoint(vlmEndpoint);
    vaultProvenanceLocalOnly = ragAllowed;
    const tRag0 = Date.now();
    let docSnippets = [];
    try {
      const vaultApi = await getDocVault();
      if (ragAllowed) {
        const { docs } = await vaultApi.loadVault();
        // Keep the synchronous provenance cache in sync for this capture's
        // parseAction()/sanitizeAction() pass.
        vaultApi.setVaultTextCache(docs.map((d) => d.text));
        docSnippets = vaultApi.retrieveVaultSnippets(docs, task, 3);
      } else {
        // Remote path: never populate the provenance cache; clear stale texts
        // from an earlier local capture so no vault value can pass the guard.
        vaultApi.setVaultTextCache([]);
      }
    } catch {
      docSnippets = [];
    }
    const tRag = Date.now() - tRag0;
    tRagMs = ragAllowed ? tRag : 0;
    const docKnowledgeBlock = docSnippets.length
      ? `DOCUMENT KNOWLEDGE (from the user's OWN uploaded files — the ONLY other source of fill values):
${docSnippets.map((s, i) => `  ${i + 1}. ${s.text}`).join("\n")}`
      : "";
    const docKnowledgeRule = ragAllowed
      ? ", OR in the DOCUMENT KNOWLEDGE block above (which comes from the user's OWN uploaded files)"
      : "";

    // NOTE: every "type" action is independently re-verified server-side
    // against the real profile in sanitizeAction() — a value/profileKey that
    // doesn't check out is rejected before it ever reaches the browser, no
    // matter what the model outputs. See sanitizeAction()'s "Anti-Hallucination
    // Guard" comment for the incident this defends against.
    const systemPrompt =
      `You are a privacy-preserving browser agent. You receive a sanitized screenshot of the current viewport plus a structural description of the page. Some regions are deliberately blacked out or pixelated for privacy — never try to read them or guess what they contained.

Reply with a SINGLE JSON action object and nothing else.

AVAILABLE ACTIONS:
  {"action":"click","x":N,"y":N}
  {"action":"type","selector":"<css_selector>","value":"<string>","profileKey":"<string>"}
  {"action":"scroll","direction":"up"|"down"}
  {"action":"navigate","url":"<url>"}
  {"action":"done","summary":"<string>"}

CHOOSING THE ACTION:
- If the user asks a question, or asks you to summarize / describe / read / explain the page, do NOT interact with the page. Reply {"action":"done","summary":"<your real answer>"} and put the actual answer text in "summary" — it is shown directly to the user. Keep it under 400 characters.
- If the user asks you to click, press, open or select something visible, use "click".
- If the user asks you to fill in a form field, use "type" and follow the PROFILE RULES below.
- If the thing the user wants is not visible in the screenshot yet, use "scroll".

CLICK COORDINATES:
"x" and "y" MUST be in the pixel coordinate system of the screenshot image you were given, with the origin at its top-left corner. Aim for the centre of the target control. The page structure below includes "imageSize" — your x MUST be between 0 and imageSize.width, and your y between 0 and imageSize.height. Read the real position of the control off the image every time. NEVER copy the coordinates from the example at the end of this prompt; they are placeholders and will click the wrong thing.

${profileBlock}

${allowedKeysBlock}

${docKnowledgeBlock}

PROFILE RULES (these govern the "type" action only):
1. To fill a field, you MUST find the exact matching information in the USER PROFILE above${docKnowledgeRule}.
2. If (and only if) the information is present, output: {"action": "type", "selector": "<css_selector>", "value": "<matching_value>", "profileKey": "<exact_key_from_AVAILABLE_PROFILE_KEYS>"}
3. "profileKey" should name the matching USER PROFILE entry (same words, any casing or spacing — e.g. "fullName" is fine for "Full Name"). Never invent a key that is not in the list. Never attach a real key to a field it does not belong to (e.g. do not put a "Job Title" value into a Name field). If the value comes from DOCUMENT KNOWLEDGE and no profile key matches the field, you may use a descriptive dynamic key (any key is allowed) or omit "profileKey".
4. If the information is NOT in the USER PROFILE or DOCUMENT KNOWLEDGE (no listed key or snippet matches the field), you MUST NOT guess, invent, or use placeholder data (like "John Doe"). Output: {"action": "done", "summary": "Profile missing information. Please add it in Settings."}
5. Every "type" action is independently re-checked against the real profile or the stored document text before execution. An action whose value or profileKey cannot be verified against either is discarded and nothing is typed — guessing never helps, it only wastes the turn. When in doubt, use "done".

EXAMPLES:
- "Fill my name", profile has Name "Alice": {"action": "type", "selector": "#name", "value": "Alice", "profileKey": "Name"}
- "Fill my address", profile is empty: {"action": "done", "summary": "Profile missing information. Please add it in Settings."}
- "Summarize this page": {"action": "done", "summary": "A scholarship application form asking for personal and academic details. Some fields are redacted for privacy."}
- "Click the login button" (shape only — you must substitute the button's REAL centre coordinates read off the image): {"action": "click", "x": 0, "y": 0}

Only use actions that do NOT require reading redacted screen regions.`;

    const vlmPayload = {
      model: vlmModel,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
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

    const sessionSecrets = await chrome.storage.session.get(["vlmApiKey"]);
    const vlmHeaders = buildVlmAuthHeaders(sessionSecrets.vlmApiKey, vlmEndpoint);
    const actionContext = { userProfile, fields: domScanResults.fields };

    const actionRaw = await requestVlmContent(vlmEndpoint, vlmHeaders, vlmPayload);
    action = parseAction(actionRaw, actionContext);

    // Small VLMs routinely answer with prose ("Sure, I can help with that…")
    // or a fenced block instead of a bare action. parseAction already digs a
    // JSON object out of that, so reaching here with no action means the reply
    // genuinely was not an action. Retry exactly once with a tightened
    // instruction — bounded, never a loop, so latency stays predictable.
    if (!action && typeof actionRaw === "string" && actionRaw.trim()) {
      const retryRaw = await requestVlmContent(vlmEndpoint, vlmHeaders, {
        ...vlmPayload,
        temperature: 0,
        messages: [
          ...vlmPayload.messages,
          { role: "assistant", content: actionRaw },
          {
            role: "user",
            content:
              "That was not valid. Reply with ONLY a single raw JSON action object. " +
              "No prose, no explanation, no markdown code fences. Start your reply with { and end it with }.",
          },
        ],
      });
      action = parseAction(retryRaw, actionContext);
      vlmRetried = true;
      if (!action) {
        vlmError = `VLM_BAD_RESPONSE: the model did not return a usable action. It said: "${safeExcerpt(retryRaw || actionRaw)}"`;
      }
    }
  } catch (fetchErr) {
    vlmError = fetchErr.message.includes("Failed to fetch")
      ? "VLM server unreachable. Is it running at " + vlmEndpoint + "?"
      : fetchErr.message;
  }

  const tVlm = Date.now() - t4;

  const receipt = buildPrivacyReceipt(tab, sanitizeResponse, {
    t0,
    tCapture,
    tDomScan,
    tInference,
    tVlm,
    vlmRetried,
    tRag: tRagMs,
  });

  // Store receipt in session storage (cleared on browser close, not persisted)
  await chrome.storage.session.set({ lastReceipt: receipt });

  return { pageStructure, action, sanitizedImage: sanitizeResponse.sanitizedImage, receipt, vlmError };
}

// ── VLM transport ─────────────────────────────────────────────────
// Two things routinely come back from a local Ollama that are NOT a JSON
// action object: an HTTP error whose body carries the real reason (e.g.
// {"error":{"message":"model runner has unexpectedly stopped…"}}), and a
// 200 whose content is prose. Feeding either straight into JSON.parse
// throws SyntaxError("Unexpected token 'S'…"), which classifyError could
// not recognise and the popup rendered as an unactionable "[UNKNOWN]".
// Every failure below is turned into a named, displayable message instead.

const VLM_EXCERPT_LIMIT = 160;

// Short, safe-to-display slice of whatever the server said. Base64 image
// payloads are stripped so a receipt or status line can never echo a frame.
function safeExcerpt(text) {
  return String(text ?? "")
    .replace(/data:[a-z/+.-]+;base64,[A-Za-z0-9+/=]+/gi, "[image]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, VLM_EXCERPT_LIMIT);
}

function describeVlmHttpError(status, statusText, body) {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || parsed?.error || parsed?.message || body;
  } catch {
    // Non-JSON error body (HTML error page, proxy notice) — excerpt it as-is.
  }
  const excerpt = safeExcerpt(detail);
  return `VLM API error: ${status} ${statusText}${excerpt ? ` — ${excerpt}` : ""}`;
}

// Returns the model's message content as a string. Throws with an explicit
// VLM_* message on transport, HTTP, or body-shape failure — never a bare
// SyntaxError.
async function requestVlmContent(vlmEndpoint, vlmHeaders, vlmPayload) {
  // Chrome sends Origin: chrome-extension://… — Ollama :11434 answers 403.
  // Always go through the local gateway for that host.
  if (isOllamaDirectEndpoint(vlmEndpoint)) {
    vlmEndpoint = DEFAULT_GATEWAY_VLM;
  }

  let response;
  try {
    response = await fetch(vlmEndpoint, {
      method: "POST",
      headers: vlmHeaders,
      body: JSON.stringify(vlmPayload),
      signal: AbortSignal.timeout(VLM_FETCH_TIMEOUT_MS),
    });
  } catch (err) {
    const name = err?.name || "";
    const msg = String(err?.message || err || "");
    if (name === "TimeoutError" || name === "AbortError" || msg.includes("aborted") || msg.includes("The operation was aborted")) {
      throw new Error(
        `VLM server timed out after ${VLM_FETCH_TIMEOUT_MS / 1000}s at ${vlmEndpoint}`
      );
    }
    throw err;
  }

  let body = await response.text();

  if (!response.ok && response.status === 403 && vlmEndpoint !== DEFAULT_GATEWAY_VLM) {
    response = await fetch(DEFAULT_GATEWAY_VLM, {
      method: "POST",
      headers: vlmHeaders,
      body: JSON.stringify(vlmPayload),
      signal: AbortSignal.timeout(VLM_FETCH_TIMEOUT_MS),
    });
    body = await response.text();
    chrome.storage.local.set({ vlmEndpoint: DEFAULT_GATEWAY_VLM }).catch(() => {});
  }

  if (!response.ok) {
    throw new Error(describeVlmHttpError(response.status, response.statusText, body));
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch {
    throw new Error(
      `VLM_BAD_RESPONSE: server did not return JSON. It sent: "${safeExcerpt(body)}"`
    );
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error(
      `VLM_BAD_RESPONSE: reply had no choices[0].message.content. Body: "${safeExcerpt(body)}"`
    );
  }
  return content;
}

// ── Face-redaction gate (MUST run before any VLM fetch) ───────────
// Privacy invariant: a live captured frame must not leave the device
// until local face redaction has completed (or the user turned the
// layer off). Fail closed — missing/partial sanitization is an error,
// not a reason to send the raw screenshot.

function assertReadyForVlm(sanitizeResponse, options = {}) {
  const faceDetectionEnabled = options.faceDetection !== false;
  const piiDetectionEnabled = options.piiDetection !== false;
  if (!sanitizeResponse || typeof sanitizeResponse !== "object") {
    throw new Error("FACE_REDACTION_REQUIRED: missing sanitization result");
  }
  if (sanitizeResponse.error) {
    throw new Error(sanitizeResponse.error);
  }
  if (typeof sanitizeResponse.sanitizedImage !== "string" || !sanitizeResponse.sanitizedImage) {
    throw new Error("FACE_REDACTION_REQUIRED: no sanitized image");
  }
  if (sanitizeResponse.sanitizedImage.indexOf("data:image/") !== 0) {
    throw new Error("FACE_REDACTION_REQUIRED: sanitized image is not an image data URL");
  }
  if (faceDetectionEnabled && sanitizeResponse.facePassComplete !== true) {
    throw new Error("FACE_REDACTION_REQUIRED: face redaction did not complete before VLM");
  }
  if (piiDetectionEnabled && sanitizeResponse.nerPassComplete !== true) {
    throw new Error("NER_REDACTION_REQUIRED: NER redaction of names/places/orgs did not complete before VLM");
  }
}

// Strip PER/ORG/LOC entity strings out of DOM field labels before those
// labels are serialized into the VLM page-structure payload. Entity text
// from the offscreen pass stays on-device (used here, never logged).
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactNerSpansInFields(fields, nerEntities) {
  if (!Array.isArray(fields)) return [];
  if (!Array.isArray(nerEntities) || nerEntities.length === 0) return fields;
  const needles = [];
  for (const e of nerEntities) {
    if (!e || typeof e.text !== "string") continue;
    const t = e.text.trim();
    if (t.length < 2) continue;
    const typ = e.entity_type;
    if (typ !== "PER" && typ !== "ORG" && typ !== "LOC") continue;
    needles.push(t);
  }
  if (!needles.length) return fields;
  return fields.map((f) => {
    if (!f || typeof f !== "object") return f;
    if (typeof f.label !== "string" || !f.label) return f;
    let label = f.label;
    for (const n of needles) {
      label = label.replace(new RegExp(escapeRegex(n), "gi"), "[REDACTED]");
    }
    return { ...f, label };
  });
}

// ── Action Safety Hardening ───────────────────────────────────────
// Every returned action is validated BEFORE it reaches the browser, so a
// malformed/untrusted model response can never mis-execute. Rejected shapes
// from the VLM path resolve to null (treated as "no action") rather than
// running against the page.

const ACTION_LIMITS = {
  selector: 256,
  value: 2000,
  summary: 500,
  url: 2048,
};

// Charset allowed in a CSS selector produced by our content-script or by the
// VLM. Many real selectors contain `#`, `.`, `[attr="x"]`, `:nth-of-type(n)`.
// Blocking everything else (script chars, controls, wildcards, etc.) keeps an
// untrusted selector from breaking out of querySelector's element-scoped world.
const SELECTOR_SAFE_RE = /^[\w#.[\]="':()>+ ,-]*$/;

// ── Anti-Hallucination Guard (defense-in-depth for "type" actions) ─
// Incident: eval-engineer measured that qwen2.5vl:7b, despite an explicit
// "MUST NOT guess/invent" system-prompt instruction, hallucinated a
// plausible-looking value (e.g. "Alice", "Software Engineer") in 2 of 3 live
// cases where the requested field had no real match in the user's saved
// profile (engineers/evaluation/work_done.md, "2026-08-28 — Re-verification
// of Task 2.5 gate", Finding #2). Prompt wording alone is probabilistic and
// already failed once, so a "type" action is never trusted on the model's
// word alone — it must be independently traceable to real profile data:
//   1. The model must self-report which profile key it used (`profileKey`),
//      and that key must actually exist in the CURRENT normalized profile.
//   2. The typed `value` must exactly match that key's real value (so the
//      model can't invent a key AND a value together).
//   3. If we know which page field the selector targets (from the DOM scan),
//      the claimed profileKey must plausibly correspond to that field's
//      label — this catches the subtler case where the model cites a REAL
//      key/value pair but attaches it to the wrong field (e.g. typing a
//      "Job Title" value into a "Full Name" field).
// Any failure here rejects the action the same way a malformed action would
// be rejected — it never reaches the browser.

function normalizeKeyForMatch(s) {
  return String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function keysCorrelate(profileKey, fieldLabel) {
  const a = normalizeKeyForMatch(profileKey);
  const b = normalizeKeyForMatch(fieldLabel);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

// VLM may emit "fullName" / "Full name" while the saved profile used "Full Name".
function resolveProfileKey(userProfile, profileKey) {
  if (!userProfile || typeof userProfile !== "object" || Array.isArray(userProfile)) return null;
  const raw = typeof profileKey === "string" ? profileKey.trim() : "";
  if (!raw) return null;
  if (Object.prototype.hasOwnProperty.call(userProfile, raw)) return raw;
  const want = normalizeKeyForMatch(raw);
  if (!want) return null;
  for (const k of Object.keys(userProfile)) {
    const have = normalizeKeyForMatch(k);
    if (have === want || have.includes(want) || want.includes(have)) return k;
  }
  return null;
}

function sanitizeAction(action, context = {}) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return null;
  if (typeof action.action !== "string") return null;

  switch (action.action) {
    case "click": {
      if (typeof action.x !== "number" || typeof action.y !== "number") return null;
      if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return null;
      if (action.x < 0 || action.y < 0 || action.x > 65535 || action.y > 65535) return null;
      return { action: "click", x: Math.round(action.x), y: Math.round(action.y) };
    }

    case "type": {
      if (typeof action.selector !== "string" || typeof action.value !== "string") return null;
      const selector = action.selector.trim();
      if (!selector || selector.length > ACTION_LIMITS.selector) return null;
      if (!SELECTOR_SAFE_RE.test(selector)) return null;
      if (action.value.length > ACTION_LIMITS.value) return null;

      // Fail CLOSED: a "type" value is trusted ONLY when it is traceable to
      // real user data. Two provenance routes:
      //   1. PROFILE — the claimed profileKey resolves in the CURRENT
      //      normalized profile AND the value exactly matches that key's value
      //      (existing anti-hallucination rule, case/whitespace-insensitive).
      //   2. VAULT (RAG-lite) — the value exactly appears as a substring in
      //      the user's OWN stored document text (aegisDocVault cache). Same
      //      bar as the profile: never invented, always traceable.
      // No verified provenance → rejected, exactly like any malformed action.
      const userProfile = context.userProfile;
      const profileOk = userProfile && typeof userProfile === "object" && !Array.isArray(userProfile);

      const profileKey = profileOk ? resolveProfileKey(userProfile, action.profileKey) : null;
      const expectedValue = profileKey ? String(userProfile[profileKey] ?? "").trim() : "";
      const profileMatch =
        !!profileKey && !!expectedValue &&
        expectedValue.toLowerCase() === action.value.trim().toLowerCase();

      const vaultMatch = vaultAllowsValue(action.value);
      if (!profileMatch && !vaultMatch) return null;

      const fields = context.fields;
      if (Array.isArray(fields)) {
        const field = fields.find((f) => f && f.selector === selector);
        if (field?.label) {
          if (profileMatch && !keysCorrelate(profileKey, field.label)) return null;
          // A vault-sourced fill may still carry a profileKey claim; if that
          // claim resolves to a real key, it must correlate with the field's
          // label too (catches: doc value + real key attached to wrong field).
          const claimed = profileOk ? resolveProfileKey(userProfile, action.profileKey) : null;
          if (!profileMatch && claimed && !keysCorrelate(claimed, field.label)) return null;
        }
      }

      return {
        action: "type",
        selector,
        value: action.value,
        profileKey: profileKey || null,
        source: profileMatch ? "profile" : "vault",
      };
    }

    case "scroll": {
      if (action.direction !== "up" && action.direction !== "down") return null;
      return { action: "scroll", direction: action.direction };
    }

    case "navigate": {
      if (typeof action.url !== "string" || action.url.length > ACTION_LIMITS.url) return null;
      let url;
      try { url = new URL(action.url); } catch { return null; }
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      return { action: "navigate", url: url.toString() };
    }

    case "done": {
      const summary = typeof action.summary === "string" ? action.summary.slice(0, ACTION_LIMITS.summary) : "";
      return { action: "done", summary };
    }

    default:
      return null;
  }
}

// ── Action Parser ──────────────────────────────────────────────────

// Scan out every balanced {...} run, tracking string state so a brace inside
// a quoted value does not end the object. The old greedy /\{[\s\S]*\}/ match
// swallowed trailing commentary ("…} Let me know if…") and failed to parse;
// this also survives leading prose and multiple objects in one reply.
function balancedJsonObjects(text) {
  const found = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}" && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        found.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return found;
}

// Curly quotes are a common small-model artifact and are not valid JSON.
const SMART_QUOTES = /[\u201c\u201d\u2018\u2019]/g;

function jsonCandidatesFrom(raw) {
  const text = String(raw).trim();
  const snippets = [];

  // Prefer a fenced block when present — its contents are the model's
  // intended payload, and prose usually sits outside the fence.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) snippets.push(...balancedJsonObjects(fenced[1]));
  snippets.push(...balancedJsonObjects(text));

  const out = [];
  for (const snippet of snippets) {
    out.push(snippet);
    const straightened = snippet.replace(SMART_QUOTES, '"');
    if (straightened !== snippet) out.push(straightened);
  }
  return out;
}

function parseAction(raw, context = {}) {
  if (typeof raw !== "string" || !raw.trim()) return null;

  // Only a sanitized action is accepted — malformed/untrusted → null.
  // sanitizeAction() and the profileKey anti-hallucination guard are
  // unchanged; this only widens what we are willing to *read*.
  for (const snippet of jsonCandidatesFrom(raw)) {
    let candidate;
    try {
      candidate = JSON.parse(snippet);
    } catch {
      continue;
    }
    const safe = sanitizeAction(candidate, context);
    if (safe) return safe;
  }
  return null;
}

// ── Error Classification ───────────────────────────────────────────

function classifyError(err) {
  const msg = err?.message || "";
  if (err?.errorCode === "NO_CONTENT_SCRIPT") return "NO_CONTENT_SCRIPT";
  if (
    msg.includes("NO_CONTENT_SCRIPT") ||
    msg.includes("Receiving end does not exist") ||
    msg.includes("Could not establish connection")
  ) {
    return "NO_CONTENT_SCRIPT";
  }
  if (msg.includes("No active tab")) return "NO_ACTIVE_TAB";
  if (msg.includes("FACE_REDACTION") || msg.includes("FACE_MODEL")) {
    return "FACE_REDACTION_REQUIRED";
  }
  if (msg.includes("NER_REDACTION") || msg.includes("NER_MODEL")) {
    return "NER_REDACTION_REQUIRED";
  }
  if (msg.includes("cannot be sent to a remote AI")) return "STRUCTURE_REMOTE_REJECTED";
  if (msg.includes("STRUCTURE_EMPTY_TEXT")) return "STRUCTURE_EMPTY_TEXT";
  if (msg.includes("STRUCTURE_TOO_LARGE")) return "STRUCTURE_TOO_LARGE";
  if (msg.includes("STRUCTURE_RATE_LIMITED")) return "STRUCTURE_RATE_LIMITED";
  if (msg.includes("STRUCTURE_CONSENT_REQUIRED")) return "STRUCTURE_CONSENT_REQUIRED";
  if (msg.includes("timed out")) return "TIMEOUT";
  if (msg.includes("VLM_BAD_RESPONSE")) return "VLM_BAD_RESPONSE";
  if (msg.includes("VLM")) return "BACKEND_UNAVAILABLE";
  if (msg.includes("Inference worker failed")) return "INIT_FAILED";
  if (
    msg.includes("no available backend") ||
    msg.includes("Failed to fetch dynamically imported module") ||
    msg.includes("blob:chrome-extension") ||
    msg.includes("blob URL path disabled") ||
    msg.includes("inlined WASM factory missing") ||
    msg.includes("ort-wasm")
  ) {
    return "INIT_FAILED";
  }
  if (msg.includes("offscreen")) return "OFFSCREEN_ERROR";
  // A bare JSON SyntaxError used to fall through to UNKNOWN and reach the
  // popup as an unactionable "[UNKNOWN] Unexpected token 'S'". Any JSON parse
  // failure that gets this far came from a model asset download or a server
  // reply that was not JSON — name it so the user knows where to look.
  if (
    msg.includes("is not valid JSON") ||
    msg.includes("Unexpected token") ||
    msg.includes("Unexpected end of JSON") ||
    msg.includes("JSON.parse")
  ) {
    return "BAD_JSON";
  }
  return "UNKNOWN";
}

// ── Action Executor ────────────────────────────────────────────────

async function handleExecuteAction(action, tabId) {
  if (!action) return { error: "No action provided" };

  // Defense-in-depth: re-validate even though CAPTURE_AND_SANITIZE already
  // sanitized the action, because EXECUTE_ACTION is message-receiving and may
  // be triggered directly with an untrusted action object. Re-fetch the
  // current profile AND refresh the vault-text cache so a "type" action's
  // value/profileKey is re-checked against real data here too, not just
  // trusted from the earlier pass. Empty vault cache degrades the guard to
  // profile-only (fail closed for vault-sourced values).
  await refreshVaultCacheBestEffort();
  const { userProfile: rawProfile } = await chrome.storage.local.get(["userProfile"]);
  const safe = sanitizeAction(action, { userProfile: normalizeProfile(rawProfile) });
  if (!safe) {
    return { error: "Action rejected by safety validator (malformed or untrusted)" };
  }

  // Validate action shape before executing
  const VALID_ACTIONS = ["click", "type", "scroll", "navigate", "done"];
  if (!VALID_ACTIONS.includes(safe.action)) {
    return { error: `Unknown action: ${safe.action}. Valid: ${VALID_ACTIONS.join(", ")}` };
  }

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const targetTabId = tabId || tab?.id;
  if (!targetTabId) throw new Error("No active tab");

  const targetTab = { id: targetTabId, url: tab?.url };

  let execResult;
  switch (safe.action) {
    case "click":
      execResult = await sendTabMessage(targetTab, { type: "EXECUTE_CLICK", x: safe.x, y: safe.y });
      break;

    case "type":
      execResult = await sendTabMessage(targetTab, { type: "EXECUTE_TYPE", selector: safe.selector, value: safe.value });
      break;

    case "scroll":
      execResult = await sendTabMessage(targetTab, { type: "EXECUTE_SCROLL", direction: safe.direction });
      break;

    case "navigate":
      await chrome.tabs.update(targetTabId, { url: safe.url });
      execResult = { ok: true, navigated: safe.url };
      break;

    case "done":
      sendTabMessage(targetTab, { type: "CLEAR_REDACTION_OVERLAY" }).catch(() => {});
      execResult = { ok: true, summary: safe.summary };
      break;
  }

  if (execResult && !execResult.error) {
    const domain = tab?.url ? new URL(tab.url).hostname : "unknown";
    await writeAuditLog({
      domain,
      action: safe.action === "type" ? `autofill (${safe.profileKey || "field"})` : safe.action === "done" ? "completed" : safe.action,
      fields: safe.action === "type" ? 1 : 0,
      time: new Date().toLocaleString(),
    });
  }

  return execResult;
}

// ── Extension Install ──────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    // Verified working — see docs/SERVER_SETUP.md
    vlmEndpoint: DEFAULT_GATEWAY_VLM,
    vlmModel: DEFAULT_VLM_MODEL,
    detectionEnabled: true,
    faceDetection: true,
    passwordDetection: true,
    piiDetection: true,
  });
  try {
    chrome.contextMenus?.create?.({
      id: "aegis_autofill_context",
      title: "Fill form from Aegis profile",
      contexts: ["page", "editable"],
    });
  } catch {
    // Duplicate id after reload is fine.
  }
  // Unpacked Reload fires onInstalled (reason "update"). Best-effort
  // re-inject so existing file:// / http(s) tabs can be messaged without
  // a manual refresh. Failures are swallowed; sendTabMessage still retries.
  reinjectContentScriptsBestEffort();
});

chrome.commands?.onCommand?.addListener(async (command) => {
  if (command !== "autofill_page") return;
  try {
    await handleProfilePrefill();
  } catch {
    // Tab may not have a content script yet.
  }
});

chrome.contextMenus?.onClicked?.addListener(async (info, tab) => {
  if (info.menuItemId !== "aegis_autofill_context" || !tab?.id) return;
  try {
    await handleProfilePrefill();
  } catch {
    // Same as the keyboard shortcut.
  }
});

async function reinjectContentScriptsBestEffort() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    return;
  }
  for (const tab of tabs) {
    if (!tab?.id || !isInjectableTabUrl(tab.url)) continue;
    try {
      await injectContentScript(tab.id);
    } catch {
      // Restricted scheme, missing file-URL access, or discarded tab.
    }
  }
}
