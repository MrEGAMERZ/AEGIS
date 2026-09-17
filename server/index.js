// AEGIS Backend — local VLM gateway
// Runs on the operator's laptop. Exposes an OpenAI-compatible endpoint that
// the AEGIS extension talks to. Forwards requests to a local VLM runtime
// (Ollama / LM Studio / llama.cpp server / vLLM) and normalizes the VLM's
// output into the single-action JSON contract the extension expects.

const http = require("http");

// ── Config ───────────────────────────────────────────────────────────
const CONFIG = {
  port: Number(process.env.PORT || 8000),
  host: process.env.HOST || "127.0.0.1",
  upstreamBaseUrl: process.env.UPSTREAM_BASE_URL || "http://localhost:11434/v1",
  // Internal model name used when calling Ollama. Not shown externally.
  upstreamModel: process.env.UPSTREAM_MODEL || "qwen2.5vl:7b",
  // Display name shown in /health, logs, and the extension popup.
  displayModel: "SARA-Distillation-0.5B",
  upstreamApiKey: process.env.UPSTREAM_API_KEY || "",
  mock: process.env.MOCK === "1" || process.argv.includes("--mock"),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 120000),
};

// ── Logging ──────────────────────────────────────────────────────────
function log(level, msg, extra) {
  const ts = new Date().toISOString();
  const suffix = extra ? ` ${JSON.stringify(extra)}` : "";
  console.log(`[${ts}] ${level} ${msg}${suffix}`);
}

// ── Action extraction ────────────────────────────────────────────────
// VLMs frequently wrap JSON in prose or markdown fences. Extract the first
// valid action object so the extension can JSON.parse the content directly.
const VALID_ACTIONS = ["click", "type", "scroll", "navigate", "done", "fill_many", "key_press", "hover", "extract_text", "clear", "focus", "wait", "select"];

function normalizeAction(obj) {
  if (!obj || typeof obj !== "object") return null;
  const action = obj.action;
  if (!VALID_ACTIONS.includes(action)) return null;

  switch (action) {
    case "click":
      if (typeof obj.x !== "number" || typeof obj.y !== "number") return null;
      return { action, x: obj.x, y: obj.y };
    case "type":
    case "select": {
      if (typeof obj.selector !== "string" || typeof obj.value !== "string") return null;
      const typed = { action, selector: obj.selector, value: obj.value };
      // Keep profileKey so the extension can prove the value came from
      // the on-device profile (sanitizeAction fail-closed without it).
      if (typeof obj.profileKey === "string" && obj.profileKey.trim()) {
        typed.profileKey = obj.profileKey.trim();
      }
      return typed;
    }
    case "scroll":
      if (obj.direction !== "up" && obj.direction !== "down") return null;
      return { action, direction: obj.direction };
    case "navigate":
      if (typeof obj.url !== "string") return null;
      return { action, url: obj.url };
    case "done":
      return { action, summary: typeof obj.summary === "string" ? obj.summary : "Task complete" };
    case "key_press":
      return { action, key: typeof obj.key === "string" ? obj.key : "Enter" };
    case "hover":
    case "extract_text":
    case "clear":
    case "focus":
      if (typeof obj.selector !== "string") return null;
      return { action, selector: obj.selector };
    case "wait":
      return { action, ms: typeof obj.ms === "number" ? obj.ms : 1000 };
    default:
      return null;
  }
}

function extractAction(raw) {
  if (!raw) return null;

  // Direct parse
  try {
    const direct = normalizeAction(JSON.parse(raw));
    if (direct) return direct;
  } catch {}

  // Markdown code fence
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try {
      const fenced = normalizeAction(JSON.parse(fence[1].trim()));
      if (fenced) return fenced;
    } catch {}
  }

  // First balanced {...} block in the string
  const start = raw.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const ch = raw[i];
      if (escaped) { escaped = false; continue; }
      if (ch === "\\") { escaped = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            const block = normalizeAction(JSON.parse(raw.slice(start, i + 1)));
            if (block) return block;
          } catch {}
          break;
        }
      }
    }
  }

  return null;
}

// ── Image dimension sniffing ─────────────────────────────────────────
// qwen2.5vl's vision encoder panics on images with any dimension under 28px
// ("height:1 or width:1 must be larger than factor:28") and crashes the whole
// Ollama model runner — bricking every subsequent request until the model is
// reloaded. Reject such payloads here with a clean 400 before they ever reach
// the VLM. PNG/JPEG header sniffing only; no image library needed.
const MIN_IMAGE_DIM = 28;

function imageSizeFromBuffer(buf) {
  if (!buf || buf.length < 8) return null;
  // PNG: 8-byte signature + IHDR chunk (length 4 + "IHDR" + width 4 + height 4).
  if (
    buf.length >= 24 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e &&
    buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a &&
    buf[6] === 0x1a && buf[7] === 0x0a &&
    buf[12] === 0x49 && buf[13] === 0x48 && buf[14] === 0x44 && buf[15] === 0x52
  ) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan for SOFn markers (exclude DHT 0xC4 / JPG 0xC8 / DAC 0xCC):
  // height(2) then width(2), both big-endian.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length; i++) {
      if (buf[i] !== 0xff) continue;
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
    }
  }
  return null;
}

function imageSizeFromDataUrl(url) {
  if (typeof url !== "string" || !url.startsWith("data:image/")) return null;
  const comma = url.indexOf(",");
  if (comma === -1) return null;
  try {
    return imageSizeFromBuffer(Buffer.from(url.slice(comma + 1), "base64"));
  } catch {
    return null;
  }
}

// Returns the first degenerate image (any axis < MIN_IMAGE_DIM) found in the
// payload, or null. Handles OpenAI-style content blocks and Ollama-style
// `images` arrays (raw base64 or data URLs).
function findDegenerateImage(payload) {
  const messages = Array.isArray(payload?.messages) ? payload.messages : [];
  for (let m = 0; m < messages.length; m++) {
    const content = messages[m]?.content;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === "image_url" && part.image_url) {
          const size = imageSizeFromDataUrl(part.image_url.url);
          if (size && (size.width < MIN_IMAGE_DIM || size.height < MIN_IMAGE_DIM)) {
            return { messageIndex: m, ...size };
          }
        }
      }
    } else if (Array.isArray(messages[m]?.images)) {
      for (const img of messages[m].images) {
        let size = null;
        if (typeof img === "string" && img.startsWith("data:image/")) {
          size = imageSizeFromDataUrl(img);
        } else if (typeof img === "string") {
          try { size = imageSizeFromBuffer(Buffer.from(img, "base64")); } catch {}
        }
        if (size && (size.width < MIN_IMAGE_DIM || size.height < MIN_IMAGE_DIM)) {
          return { messageIndex: m, ...size };
        }
      }
    }
  }
  return null;
}

// ── Upstream call ────────────────────────────────────────────────────
async function callUpstream(payload) {
  const url = `${CONFIG.upstreamBaseUrl.replace(/\/$/, "")}/chat/completions`;
  const headers = { "Content-Type": "application/json" };
  if (CONFIG.upstreamApiKey) headers.Authorization = `Bearer ${CONFIG.upstreamApiKey}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.requestTimeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`Upstream ${res.status}: ${errBody.slice(0, 500)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
    log("INFO", "upstream call finished", { latencyMs: Date.now() - started });
  }
}

// ── Mock VLM (for testing the pipeline without a model installed) ───
function mockCompletion(payload) {
  const lastMsg = payload.messages?.[payload.messages.length - 1];
  const textPart = Array.isArray(lastMsg?.content)
    ? lastMsg.content.find((p) => p.type === "text")?.text || ""
    : lastMsg?.content || "";
  const taskMatch = textPart.match(/Task:\s*(.+)/i);
  const task = taskMatch ? taskMatch[1].trim() : "";
  const structureMatch = textPart.match(/Page structure:\s*([\s\S]*?)\n\nTask:/);
  let structure = null;
  if (structureMatch) {
    try { structure = JSON.parse(structureMatch[1]); } catch {}
  }

  // Fake a deterministic action based on page structure
  let action;
  const fields = structure?.fields || [];
  const emptyField = fields.find((f) => f.required !== false && !f.filled);
  if (task.toLowerCase().includes("scroll")) {
    action = { action: "scroll", direction: "down" };
  } else if (emptyField && emptyField.type !== "password") {
    action = { action: "click", x: 400, y: 500 };
  } else if (fields.length > 0 || structure?.url) {
    action = { action: "click", x: 400, y: 500 };
  } else {
    action = { action: "done", summary: `Completed: ${task || "unknown task"}` };
  }

  return {
    id: "mock-" + Date.now(),
    object: "chat.completion",
    model: payload.model || "mock",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: JSON.stringify(action) },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// ── HTTP helpers ─────────────────────────────────────────────────────
function sendJson(res, status, body, extraHeaders) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > 64 * 1024 * 1024) {
        reject(new Error("Body too large (max 64MB)"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

// ── Handlers ─────────────────────────────────────────────────────────
async function handleHealth(res) {
  const health = {
    status: "ok",
    mock: CONFIG.mock,
    model: CONFIG.displayModel,
    upstream: { baseUrl: CONFIG.upstreamBaseUrl, model: CONFIG.displayModel },
    upstreamReachable: false,
  };
  if (!CONFIG.mock) {
    try {
      const r = await fetch(`${CONFIG.upstreamBaseUrl.replace(/\/$/, "")}/models`, {
        signal: AbortSignal.timeout(3000),
      });
      health.upstreamReachable = r.ok;
    } catch {}
  }
  sendJson(res, 200, health);
}

async function handleModels(res) {
  if (CONFIG.mock) {
    return sendJson(res, 200, { object: "list", data: [{ id: "mock", object: "model" }] });
  }
  try {
    const r = await fetch(`${CONFIG.upstreamBaseUrl.replace(/\/$/, "")}/models`, {
      headers: CONFIG.upstreamApiKey ? { Authorization: `Bearer ${CONFIG.upstreamApiKey}` } : {},
    });
    const data = await r.json();
    sendJson(res, r.status, data);
  } catch (e) {
    sendJson(res, 502, { error: { message: `Upstream unreachable: ${e.message}` } });
  }
}

async function handleChatCompletions(req, res) {
  const started = Date.now();
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJson(res, 400, { error: { message: `Invalid JSON body: ${e.message}` } });
  }

  try {
    // Reject degenerate images BEFORE the VLM sees them: qwen2.5vl's image
    // processor panics on any axis < MIN_IMAGE_DIM and kills the Ollama
    // runner, which then 500s every request until the model reloads.
    if (!CONFIG.mock) {
      const degenerate = findDegenerateImage(payload);
      if (degenerate) {
        log("WARN", "rejected degenerate image", degenerate);
        return sendJson(res, 400, {
          error: {
            message:
              `IMAGE_TOO_SMALL: image is ${degenerate.width}x${degenerate.height}px (message ${degenerate.messageIndex}), ` +
              `below the VLM minimum of ${MIN_IMAGE_DIM}px per axis. The VLM image processor would crash — ` +
              `this payload was not forwarded.`,
          },
        });
      }
    }
    if (!CONFIG.mock && payload && typeof payload === "object" && !payload.model) {
      payload.model = CONFIG.upstreamModel;
    }
    const data = CONFIG.mock ? mockCompletion(payload) : await callUpstream(payload);
    const raw = data.choices?.[0]?.message?.content ?? "";
    
    // Chat mode: preserve full text so the sidepanel can show it.
    // Agent mode: strip to just the action JSON so the extension's JSON.parse succeeds.
    const isChatMode = (url.searchParams?.get?.("mode") === "chat") ||
                       (payload?.messages?.length > 2) ||
                       (payload?.messages?.some?.(m => m.role === "system" && m.content?.includes("AEGIS")));
    
    if (!isChatMode) {
      const action = extractAction(raw);
      if (action) {
        data.choices[0].message.content = JSON.stringify(action);
      }
    }

    const latencyMs = Date.now() - started;
    log("INFO", "chat completion served", {
      model: payload.model,
      action: action?.action || null,
      actionParsed: !!action,
      latencyMs,
    });
    sendJson(res, 200, data, { "X-Aegis-Latency-Ms": String(latencyMs) });
  } catch (e) {
    log("ERROR", "chat completion failed", { error: e.message });
    sendJson(res, e.message.startsWith("Upstream") ? 502 : 500, {
      error: { message: e.message },
    });
  }
}

// ── Server ───────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host || `localhost:${CONFIG.port}`}`);

  try {
    if (req.method === "GET" && url.pathname === "/health") return await handleHealth(res);
    if (req.method === "GET" && url.pathname === "/v1/models") return await handleModels(res);
    if (req.method === "POST" && url.pathname === "/v1/chat/completions")
      return await handleChatCompletions(req, res);
    sendJson(res, 404, { error: { message: `No route: ${req.method} ${url.pathname}` } });
  } catch (e) {
    log("ERROR", "unhandled error", { error: e.message });
    if (!res.headersSent) sendJson(res, 500, { error: { message: e.message } });
  }
});

// Only auto-listen when run directly (`node server/index.js`). When required
// as a module (eval harness), expose the pure helpers without side effects.
if (require.main === module) {
  server.listen(CONFIG.port, CONFIG.host, () => {
    log("INFO", "AEGIS backend listening", {
      host: CONFIG.host,
      port: CONFIG.port,
      mock: CONFIG.mock,
      upstream: CONFIG.upstreamBaseUrl,
      model: CONFIG.upstreamModel,
    });
    if (!CONFIG.mock) {
      log("WARN", "Make sure the VLM runtime is up (e.g. `ollama serve` and the model is pulled)");
    }
  });
}

// Exported for eval/harness/server-image-guard.test.js — pure helpers only;
// harmless when run directly (module.exports is otherwise unused).
module.exports = { imageSizeFromBuffer, imageSizeFromDataUrl, findDegenerateImage, MIN_IMAGE_DIM };
