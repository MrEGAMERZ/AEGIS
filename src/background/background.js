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
});

// Keys that must never be written to chrome.storage.local (F-11 / session-secret rule).
const FORBIDDEN_LOCAL_SECRET_KEYS = ["vlmApiKey", "apiKey", "authorization", "token", "secret"];

function sanitizeLocalConfig(config) {
  if (!config || typeof config !== "object" || Array.isArray(config)) return {};
  const out = {};
  for (const [k, v] of Object.entries(config)) {
    if (FORBIDDEN_LOCAL_SECRET_KEYS.includes(k)) continue;
    out[k] = v;
  }
  return out;
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

// ── Scan + Overlay (no VLM) ────────────────────────────────────────
// Used by the popup's "Scan page" button. Runs the DOM scan and shows
// the redaction overlay in the active tab — no screenshot, no VLM call.

async function handleScanAndOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  const domScanResults = await sendTabMessage(tab, { type: "DOM_SCAN" });

  // Show overlay in the content script
  await sendTabMessage(tab, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
  });

  return {
    fieldCount: domScanResults.fields?.length || 0,
    dpr: domScanResults.dpr || 1,
    url: tab.url,
  };
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

// Two frames at 60Hz — enough for an overlay clear to composite before capture.
const OVERLAY_CLEAR_PAINT_MS = 32;

async function handleCaptureAndSanitize(task) {
  const t0 = Date.now();

  // 1. Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab");

  // 2. Capture screenshot.
  // Drop any overlay left by a previous run first — captureVisibleTab records
  // whatever is composited, so our own tinted boxes and "🔒" badges would be
  // baked into the image the VLM reasons over. The short wait lets the
  // clear actually paint before the frame is grabbed.
  // Guarded by isInjectableTabUrl so a restricted scheme still fails later at
  // DOM_SCAN with NO_CONTENT_SCRIPT rather than here with a vaguer error.
  if (isInjectableTabUrl(tab.url)) {
    await sendTabMessage(tab, { type: "CLEAR_REDACTION_OVERLAY" }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, OVERLAY_CLEAR_PAINT_MS));
  }

  const t1 = Date.now();
  const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" });
  const tCapture = Date.now() - t1;

  // 3. DOM scan (includes dpr). Auto-injects the content script once if
  // the tab was orphaned by an extension reload (file:// included).
  const t2 = Date.now();
  const domScanResults = await sendTabMessage(tab, { type: "DOM_SCAN" });
  const tDomScan = Date.now() - t2;

  // Show redaction overlay immediately after DOM scan, before inference
  // (gives visual feedback while the offscreen pipeline runs)
  sendTabMessage(tab, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
  }).catch(() => {}); // non-critical, don't let overlay failure block pipeline

  // 4. Offscreen: inference + masking (MUST complete before any VLM call)
  const config = await chrome.storage.local.get([
    "vlmEndpoint", "vlmModel", "userProfile", "faceDetection", "piiDetection",
  ]);
  const faceDetectionEnabled = config.faceDetection !== false;
  const piiDetectionEnabled = config.piiDetection !== false;

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

  // Hard privacy gate: refuse the VLM call unless live face + NER passes ran.
  assertReadyForVlm(sanitizeResponse, {
    faceDetection: faceDetectionEnabled,
    piiDetection: piiDetectionEnabled,
  });

  // Refresh overlays with live field anchors + face boxes from sanitize
  // (physical px; content script scales by dpr). Non-critical.
  const faceRegions = (sanitizeResponse.maskedRegions || []).filter((r) => r.type === "face");
  sendTabMessage(tab, {
    type: "SHOW_REDACTION_OVERLAY",
    fields: domScanResults.fields || [],
    faces: faceRegions,
    dpr: sanitizeResponse.dpr || domScanResults.dpr || 1,
  }).catch(() => {});

  // 5. Build structural context payload
  // Default: Ollama running locally (verified working — see docs/SERVER_SETUP.md)
  const vlmEndpoint = config.vlmEndpoint || "http://localhost:11434/v1/chat/completions";
  const vlmModel    = config.vlmModel    || "qwen2.5vl:7b";
  // userProfile is set by the popup Settings tab — may be empty on first run.
  // normalizeProfile() accepts the popup's raw string OR a JSON object/JSON
  // string, so the VLM always sees real key: value pairs — never char indices.
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

PROFILE RULES (these govern the "type" action only):
1. To fill a field, you MUST find the exact matching information in the USER PROFILE above.
2. If (and only if) the information is present, output: {"action": "type", "selector": "<css_selector>", "value": "<profile_value>", "profileKey": "<exact_key_from_AVAILABLE_PROFILE_KEYS>"}
3. "profileKey" MUST be copied EXACTLY, character-for-character, from the AVAILABLE PROFILE KEYS list above. Never invent a profileKey. Never attach a real profileKey to a field it does not belong to (e.g. do not put a "Job Title" value into a Name field).
4. If the information is NOT in the USER PROFILE (no listed key matches the field), you MUST NOT guess, invent, or use placeholder data (like "John Doe"). Output: {"action": "done", "summary": "Profile missing information. Please add it in Settings."}
5. Every "type" action is independently re-checked against the real profile before execution. An action whose value or profileKey cannot be verified is discarded and nothing is typed — guessing never helps, it only wastes the turn. When in doubt, use "done".

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
    // vlmRetried: the model's first reply was not a usable action and cost a
    // second round trip — the single biggest swing in the vlm timing below.
    vlmRetried,
    latencyMs: { capture: tCapture, domScan: tDomScan, inference: tInference, vlm: tVlm },
    totalMs: Date.now() - t0,
  };

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
  const response = await fetch(vlmEndpoint, {
    method: "POST",
    headers: vlmHeaders,
    body: JSON.stringify(vlmPayload),
  });

  const body = await response.text();

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

      // Fail CLOSED: no verified profile context means we cannot prove this
      // value came from the user's real data, so it is treated as unsafe —
      // same outcome as any other sanitizeAction rejection.
      const userProfile = context.userProfile;
      if (!userProfile || typeof userProfile !== "object" || Array.isArray(userProfile)) return null;

      const profileKey = typeof action.profileKey === "string" ? action.profileKey.trim() : "";
      if (!profileKey || !Object.prototype.hasOwnProperty.call(userProfile, profileKey)) return null;

      const expectedValue = String(userProfile[profileKey] ?? "").trim();
      if (!expectedValue || expectedValue.toLowerCase() !== action.value.trim().toLowerCase()) return null;

      const fields = context.fields;
      if (Array.isArray(fields)) {
        const field = fields.find((f) => f && f.selector === selector);
        if (field?.label && !keysCorrelate(profileKey, field.label)) return null;
      }

      return { action: "type", selector, value: action.value, profileKey };
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
  if (msg.includes("timed out")) return "TIMEOUT";
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
  // current profile so a "type" action's value/profileKey is re-checked
  // against real data here too, not just trusted from the earlier pass.
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

  switch (safe.action) {
    case "click":
      return sendTabMessage(targetTab, { type: "EXECUTE_CLICK", x: safe.x, y: safe.y });

    case "type":
      return sendTabMessage(targetTab, { type: "EXECUTE_TYPE", selector: safe.selector, value: safe.value });

    case "scroll":
      return sendTabMessage(targetTab, { type: "EXECUTE_SCROLL", direction: safe.direction });

    case "navigate":
      await chrome.tabs.update(targetTabId, { url: safe.url });
      return { ok: true, navigated: safe.url };

    case "done":
      // Clear overlay when agent reports task complete
      sendTabMessage(targetTab, { type: "CLEAR_REDACTION_OVERLAY" }).catch(() => {});
      return { ok: true, summary: safe.summary };
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
  // Unpacked Reload fires onInstalled (reason "update"). Best-effort
  // re-inject so existing file:// / http(s) tabs can be messaged without
  // a manual refresh. Failures are swallowed; sendTabMessage still retries.
  reinjectContentScriptsBestEffort();
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
