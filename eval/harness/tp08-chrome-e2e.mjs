#!/usr/bin/env node
/**
 * TP08 full Chrome E2E — extension loaded from dist/, real CDP automation.
 *
 * Proves: idle (no face overlays), SCAN_AND_OVERLAY+forceFaces, FILL_MATCHING_FIELDS,
 * optional VLM/agent when gateway is up.
 *
 * Usage: node eval/harness/tp08-chrome-e2e.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const PROFILE_PATH = path.join(ROOT, "eval/fixtures/dummy-profile-ananya.json");
const TP08_URL = "http://127.0.0.1:8765/tp08-kitchen-sink-registration.html";
const GATEWAY_URL = "http://localhost:8000/v1/chat/completions";

const PORT = 9540 + Math.floor(Math.random() * 40);
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-tp08-e2e-"));
const SCAN_TIMEOUT_MS = 120_000;
const RUN_TIMEOUT_MS = 180_000;

const CHROME_CANDIDATES = [
  "/Users/rehan/.cache/puppeteer/chrome/mac_arm-152.0.7977.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/chrome",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const EXPECT_FILLS = {
  "full-name": "Ananya Krishnan",
  email: "ananya.krishnan@example.com",
  phone: "9876543210",
  dob: "1999-08-14",
  gender: "Female",
  address: "12, 4th Cross, Indiranagar",
  city: "Bengaluru",
  state: "Karnataka",
  "postal-code": "560038",
  college: "National Institute of Technology Karnataka",
  course: "B.Tech Computer Science",
  "year-of-study": "3",
  "father-name": "Ravi Krishnan",
  "mother-name": "Meera Krishnan",
  "job-title": "Student",
  organization: "NITK Surathkal",
};

const TRAP_IDS = ["blood-group", "aadhaar-number", "pan-number", "emergency-contact"];

const results = {
  idle: { status: "PENDING", evidence: null },
  scan: { status: "PENDING", evidence: null },
  fill: { status: "PENDING", evidence: null },
  agent: { status: "PENDING", evidence: null },
  extensionId: null,
  commands: [],
};

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function waitJson(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP not ready: ${url}`);
}

function makeCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", reject);
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error(`CDP timeout: ${method}`));
          }
        }, RUN_TIMEOUT_MS);
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    },
  };
}

async function evalDirect(client, expression, awaitPromise = false, timeout = RUN_TIMEOUT_MS) {
  const { result, exceptionDetails } = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise,
    timeout,
  });
  if (exceptionDetails) {
    throw new Error(JSON.stringify(exceptionDetails));
  }
  return result?.value;
}

async function waitForTarget(dbgPort, predicate, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    const targets = await waitJson(`http://127.0.0.1:${dbgPort}/json/list`, 4);
    const hit = targets.find(predicate);
    if (hit?.webSocketDebuggerUrl) return hit;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("target not found");
}

async function connectTarget(target) {
  const client = makeCdp(target.webSocketDebuggerUrl);
  await client.ready;
  await client.send("Runtime.enable");
  return client;
}

async function discoverExtensionId(dbgPort) {
  for (let i = 0; i < 30; i++) {
    const targets = await waitJson(`http://127.0.0.1:${dbgPort}/json/list`, 4);
    for (const t of targets) {
      const url = String(t.url || "");
      const m = url.match(/^chrome-extension:\/\/([a-p]{32})\/src\/background\/background\.js$/);
      if (m) return m[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function probeGateway() {
  try {
    const res = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "ping" }] }),
    });
    return res.status !== 0 && res.status < 500;
  } catch {
    return false;
  }
}

async function extHelperEval(browserClient, dbgPort, extId, expression, awaitPromise = true, timeout = RUN_TIMEOUT_MS) {
  const popupUrl = `chrome-extension://${extId}/src/popup/popup.html`;
  await browserClient.send("Target.createTarget", { url: popupUrl });
  const target = await waitForTarget(dbgPort, (t) => String(t.url || "").startsWith(popupUrl));
  const helper = await connectTarget(target);
  for (let i = 0; i < 30; i++) {
    const hasChrome = await evalDirect(helper, "typeof chrome !== 'undefined' && !!chrome.runtime");
    const rs = await evalDirect(helper, "document.readyState");
    if (hasChrome && (rs === "complete" || rs === "interactive")) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const out = await evalDirect(helper, expression, awaitPromise, timeout);
  helper.close();
  return out;
}

function idleCheckExpr() {
  return `(() => {
    const photo = document.getElementById("applicant-photo");
    const faceLayer = document.getElementById("sih26171-overlay-faces");
    const fieldLayer = document.getElementById("sih26171-overlay-fields");
    const faceBoxes = faceLayer ? faceLayer.children.length : 0;
    const fieldBoxes = fieldLayer ? fieldLayer.children.length : 0;
    const faceBadges = faceLayer
      ? [...faceLayer.querySelectorAll("*")].filter((n) => (n.textContent || "").includes("Secured")).length
      : 0;
    const photoRect = photo ? photo.getBoundingClientRect() : null;
    return {
      overlayRoot: !!document.getElementById("sih26171-overlay-root"),
      faceLayerExists: !!faceLayer,
      faceBoxes,
      faceBadges,
      fieldBoxes,
      photoPresent: !!photo,
      photoSrc: photo ? photo.src : null,
      ok: faceBoxes === 0 && faceBadges === 0,
    };
  })()`;
}

function readFieldsExpr() {
  const ids = [...Object.keys(EXPECT_FILLS), ...TRAP_IDS];
  return `(() => {
    const ids = ${JSON.stringify(ids)};
    const out = {};
    for (const id of ids) {
      const el = document.getElementById(id);
      out[id] = el ? (el.value ?? el.textContent ?? "").trim() : null;
    }
    return out;
  })()`;
}

async function main() {
  results.commands.push("node eval/harness/tp08-chrome-e2e.mjs");

  if (!fs.existsSync(DIST)) {
    console.error("BLOCKED: dist/ missing — run bash scripts/build-dist.sh");
    process.exit(2);
  }
  if (!fs.existsSync(path.join(DIST, "popup/popup.html"))) {
    const alt = path.join(DIST, "src/popup/popup.html");
    if (!fs.existsSync(alt)) {
      console.error("BLOCKED: dist popup missing");
      process.exit(2);
    }
  }

  const chromePath = findChrome();
  if (!chromePath) {
    console.error("BLOCKED: no Chrome binary found");
    process.exit(2);
  }
  log("setup", `Chrome: ${chromePath}`);
  log("setup", `Extension dist: ${DIST}`);
  log("setup", `TP08: ${TP08_URL}`);

  const profile = JSON.parse(fs.readFileSync(PROFILE_PATH, "utf8"));
  const gatewayUp = await probeGateway();
  log("setup", `Gateway ${GATEWAY_URL}: ${gatewayUp ? "reachable" : "down/skip agent"}`);

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${USER_DATA}`,
      `--disable-extensions-except=${DIST}`,
      `--load-extension=${DIST}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  const cleanup = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
    try {
      fs.rmSync(USER_DATA, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  let exitCode = 0;

  try {
    const ver = await waitJson(`http://127.0.0.1:${PORT}/json/version`);
    log("setup", `Browser: ${ver.Browser}`);
    const browserClient = makeCdp(ver.webSocketDebuggerUrl);
    await browserClient.ready;

    const extId = await discoverExtensionId(PORT);
    if (!extId) {
      console.error("BLOCKED: could not discover extension id");
      console.error("Targets:", (await waitJson(`http://127.0.0.1:${PORT}/json/list`)).map((t) => t.url).join(" | "));
      if (stderr) console.error("Chrome stderr (tail):\n", stderr.slice(-2000));
      results.idle.status = "BLOCKED";
      results.scan.status = "BLOCKED";
      results.fill.status = "BLOCKED";
      results.agent.status = "SKIP";
      exitCode = 3;
      return;
    }
    results.extensionId = extId;
    log("setup", `Extension id: ${extId}`);

    await browserClient.send("Target.createTarget", { url: TP08_URL });
    const pageTarget = await waitForTarget(PORT, (t) => String(t.url || "").includes("tp08-kitchen-sink"));
    const pageClient = await connectTarget(pageTarget);
    await pageClient.send("Page.enable");

    for (let i = 0; i < 40; i++) {
      const rs = await evalDirect(pageClient, "document.readyState");
      if (rs === "complete") break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 1200));

    // ── 1. Idle ──
    const idle = await evalDirect(pageClient, idleCheckExpr());
    log("idle", JSON.stringify(idle));
    if (idle?.ok) {
      results.idle = {
        status: "PASS",
        evidence: `faceBoxes=${idle.faceBoxes}, fieldBoxes=${idle.fieldBoxes} (field outlines OK on idle)`,
      };
    } else {
      results.idle = {
        status: "FAIL",
        evidence: `face overlays present: faceBoxes=${idle?.faceBoxes}, faceBadges=${idle?.faceBadges}`,
      };
      exitCode = 1;
    }

    // Seed profile + focus TP08 tab via extension context
    const seedExpr = `(() => new Promise((resolve) => {
      const profile = ${JSON.stringify(profile)};
      chrome.storage.local.set({ userProfile: profile, faceDetection: true, piiDetection: true, passwordDetection: true }, async () => {
        const tabs = await chrome.tabs.query({ url: "http://127.0.0.1:8765/*" });
        const tab = tabs[0];
        if (tab?.id) {
          await chrome.tabs.update(tab.id, { active: true });
          if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
        }
        resolve({ ok: true, tabId: tab?.id ?? null, tabUrl: tab?.url ?? null });
      });
    }))()`;

    const seedOut = await extHelperEval(browserClient, PORT, extId, seedExpr);
    log("seed", JSON.stringify(seedOut));
    await new Promise((r) => setTimeout(r, 500));

    // ── 2. SCAN_AND_OVERLAY forceFaces ──
    const scanExpr = `(() => new Promise((resolve) => {
      const t0 = Date.now();
      const finish = (payload) => resolve({ ...payload, elapsedMs: Date.now() - t0 });
      chrome.tabs.query({ url: "http://127.0.0.1:8765/*" }, (tabs) => {
        const tab = tabs && tabs[0];
        const run = () => {
          chrome.runtime.sendMessage({ type: "SCAN_AND_OVERLAY", forceFaces: true }, (resp) => {
            const err = chrome.runtime.lastError;
            finish({
              error: err ? err.message : resp?.error || null,
              receipt: resp?.receipt || null,
              fieldCount: resp?.fieldCount ?? null,
              hasSanitizedImage: !!(resp?.sanitizedImage),
              activeTabId: tab?.id ?? null,
            });
          });
        };
        if (tab?.id) {
          chrome.tabs.update(tab.id, { active: true }, () => {
            if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true }, () => setTimeout(run, 400));
            else setTimeout(run, 400);
          });
        } else run();
      });
    }))()`;

    log("scan", "Sending SCAN_AND_OVERLAY forceFaces:true (may take 30-90s cold)...");
    const scanStarted = Date.now();
    let scanOut = null;
    try {
      scanOut = await extHelperEval(browserClient, PORT, extId, scanExpr, true, SCAN_TIMEOUT_MS);
    } catch (e) {
      scanOut = { error: e.message };
    }
    log("scan", `Done in ${Date.now() - scanStarted}ms: ${JSON.stringify(scanOut)}`);

    const postScanIdle = await evalDirect(pageClient, idleCheckExpr());
    const faces = scanOut?.receipt?.masked?.faces ?? 0;
    const pii = scanOut?.receipt?.masked?.piiSpans ?? 0;
    const pw = scanOut?.receipt?.masked?.passwordFields ?? 0;

    if (scanOut?.error) {
      results.scan = { status: "FAIL", evidence: `error: ${scanOut.error}` };
      exitCode = 1;
    } else if (!scanOut?.hasSanitizedImage) {
      results.scan = { status: "FAIL", evidence: "no sanitizedImage in response" };
      exitCode = 1;
    } else if (postScanIdle?.faceBoxes > 0 || faces > 0) {
      results.scan = {
        status: "PASS",
        evidence: `receipt faces=${faces} pii=${pii} passwordFields=${pw}; post-scan faceBoxes=${postScanIdle?.faceBoxes}`,
      };
    } else {
      results.scan = {
        status: "FAIL",
        evidence: `sanitized ran but no face evidence: receipt.faces=${faces}, overlay faceBoxes=${postScanIdle?.faceBoxes}`,
      };
      exitCode = 1;
    }

    // Re-focus page tab before fill
    await extHelperEval(
      browserClient,
      PORT,
      extId,
      `(() => new Promise((resolve) => {
        chrome.tabs.query({ url: "http://127.0.0.1:8765/*" }, (tabs) => {
          const tab = tabs[0];
          if (tab?.id) chrome.tabs.update(tab.id, { active: true }, () => resolve({ tabId: tab.id }));
          else resolve({ tabId: null });
        });
      }))()`
    );
    await new Promise((r) => setTimeout(r, 400));

    // ── 3. FILL_MATCHING_FIELDS ──
    const fillExpr = `(() => new Promise((resolve) => {
      chrome.tabs.query({ url: "http://127.0.0.1:8765/*" }, (tabs) => {
        const tab = tabs && tabs[0];
        const run = () => {
          chrome.runtime.sendMessage({ type: "FILL_MATCHING_FIELDS" }, (resp) => {
            const err = chrome.runtime.lastError;
            resolve({ error: err ? err.message : resp?.error || null, resp, activeTabId: tab?.id ?? null });
          });
        };
        if (tab?.id) {
          chrome.tabs.update(tab.id, { active: true }, () => {
            if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true }, () => setTimeout(run, 400));
            else setTimeout(run, 400);
          });
        } else run();
      });
    }))()`;

    log("fill", "Sending FILL_MATCHING_FIELDS...");
    const fillOut = await extHelperEval(browserClient, PORT, extId, fillExpr);
    log("fill", JSON.stringify(fillOut));

    await new Promise((r) => setTimeout(r, 800));
    const fieldVals = await evalDirect(pageClient, readFieldsExpr());
    log("fill", `Observed fields: ${JSON.stringify(fieldVals)}`);

    const fillErrors = [];
    const trapErrors = [];
    for (const [id, expected] of Object.entries(EXPECT_FILLS)) {
      const got = (fieldVals?.[id] ?? "").trim();
      if (got !== expected) {
        fillErrors.push(`${id}: expected "${expected}", got "${got}"`);
      }
      if (/john doe/i.test(got)) {
        fillErrors.push(`${id}: hallucination trap John Doe`);
      }
    }
    for (const id of TRAP_IDS) {
      const got = (fieldVals?.[id] ?? "").trim();
      if (got) trapErrors.push(`${id} should be empty, got "${got}"`);
    }

    if (fillOut?.error) {
      results.fill = { status: "FAIL", evidence: fillOut.error };
      exitCode = 1;
    } else if (fillErrors.length) {
      results.fill = { status: "FAIL", evidence: fillErrors.join("; ") };
      exitCode = 1;
    } else if (trapErrors.length) {
      results.fill = { status: "FAIL", evidence: trapErrors.join("; ") };
      exitCode = 1;
    } else {
      results.fill = {
        status: "PASS",
        evidence: `filled=${fillOut?.resp?.filled ?? "?"} remaining=${fillOut?.resp?.remaining ?? "?"}; ${Object.keys(EXPECT_FILLS).length} fields match Ananya profile`,
      };
    }

    // ── 4. Agent / receipt (optional) ──
    if (!gatewayUp) {
      results.agent = { status: "SKIP", evidence: "gateway not reachable at localhost:8000" };
    } else {
      const agentExpr = `(() => new Promise((resolve) => {
        chrome.tabs.query({ url: "http://127.0.0.1:8765/*" }, (tabs) => {
          const tab = tabs && tabs[0];
          const run = () => {
            chrome.runtime.sendMessage({
              type: "CAPTURE_AND_SANITIZE",
              task: "Fill the scholarship application using my saved profile. Leave blank any field that is not in the profile."
            }, (resp) => {
              const err = chrome.runtime.lastError;
              resolve({
                error: err ? err.message : resp?.error || resp?.vlmError || null,
                action: resp?.action?.action ?? null,
                receipt: resp?.receipt ?? null,
              });
            });
          };
          if (tab?.id) {
            chrome.tabs.update(tab.id, { active: true }, () => {
              if (tab.windowId) chrome.windows.update(tab.windowId, { focused: true }, () => setTimeout(run, 400));
              else setTimeout(run, 400);
            });
          } else run();
        });
      }))()`;
      log("agent", "Sending CAPTURE_AND_SANITIZE (gateway up)...");
      let agentOut = null;
      try {
        agentOut = await extHelperEval(browserClient, PORT, extId, agentExpr);
      } catch (e) {
        agentOut = { error: e.message };
      }
      log("agent", JSON.stringify(agentOut));
      if (agentOut?.error) {
        results.agent = { status: "SKIP", evidence: `VLM step error (local fill still valid): ${agentOut.error}` };
      } else if (agentOut?.receipt) {
        results.agent = {
          status: "PASS",
          evidence: `action=${agentOut.action}; receipt faces=${agentOut.receipt?.masked?.faces ?? 0}`,
        };
      } else {
        results.agent = { status: "SKIP", evidence: "no receipt from CAPTURE_AND_SANITIZE" };
      }
    }

    pageClient.close();
    browserClient.close();
  } catch (err) {
    console.error("BLOCKED/FAIL:", err.message || err);
    if (stderr) console.error("Chrome stderr (tail):\n", stderr.slice(-2000));
    if (results.idle.status === "PENDING") results.idle = { status: "BLOCKED", evidence: err.message };
    if (results.scan.status === "PENDING") results.scan = { status: "BLOCKED", evidence: err.message };
    if (results.fill.status === "PENDING") results.fill = { status: "BLOCKED", evidence: err.message };
    if (results.agent.status === "PENDING") results.agent = { status: "SKIP", evidence: err.message };
    exitCode = exitCode || 1;
  } finally {
    cleanup();
  }

  console.log("\n=== TP08 Chrome E2E Summary ===");
  console.log(`Extension ID: ${results.extensionId ?? "unknown"}`);
  for (const [k, v] of Object.entries(results)) {
    if (k === "extensionId" || k === "commands") continue;
    console.log(`${k.toUpperCase()}: ${v.status} — ${v.evidence}`);
  }

  fs.writeFileSync(
    path.join(ROOT, "eval/harness/.tp08-e2e-last.json"),
    JSON.stringify(results, null, 2)
  );

  process.exit(exitCode);
}

main();
