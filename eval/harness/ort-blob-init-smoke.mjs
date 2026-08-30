#!/usr/bin/env node
/**
 * Smoke: load unpacked extension in Chrome for Testing / Chrome, open the
 * offscreen page, spawn the real module Worker, post INIT, assert faceModelReady.
 *
 * Usage:
 *   node eval/harness/ort-blob-init-smoke.mjs
 *
 * Exit 0 on INIT_DONE + faceModelReady; non-zero otherwise.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 9522 + Math.floor(Math.random() * 40);
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ort-smoke-"));
const TIMEOUT_MS = 120_000;

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/chrome",
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

async function waitForJson(url, attempts = 40) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP endpoint not ready: ${url}`);
}

function makeCdpClient(wsUrl) {
  if (typeof WebSocket === "undefined") {
    throw new Error("Need Node 22+ global WebSocket");
  }
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = new Set();

  const ready = new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (e) => reject(e));
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
      return;
    }
    for (const fn of listeners) fn(msg);
  });

  return {
    ready,
    on(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
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
        }, TIMEOUT_MS);
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

async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("FAIL: no Chrome binary found");
    process.exit(2);
  }
  console.log("Chrome:", chromePath);
  console.log("Extension root:", ROOT);
  console.log("User data:", USER_DATA);

  const child = spawn(
    chromePath,
    [
      `--remote-debugging-port=${PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${USER_DATA}`,
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
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

  try {
    const ver = await waitForJson(`http://127.0.0.1:${PORT}/json/version`);
    console.log("Browser:", ver.Browser);

    // Discover extension id via chrome-extension targets or management page.
    await new Promise((r) => setTimeout(r, 1500));
    const targets = await waitForJson(`http://127.0.0.1:${PORT}/json/list`);
    let extId = null;
    for (const t of targets) {
      const m = String(t.url || "").match(/^chrome-extension:\/\/([a-p]{32})\//);
      if (m) {
        extId = m[1];
        break;
      }
    }
    if (!extId) {
      // Fallback: open extensions page and scrape — often blocked by policy.
      console.error("FAIL: no chrome-extension:// target; extension may be policy-blocked.");
      console.error("Targets:", targets.map((t) => t.url).join(" | ") || "(none)");
      if (stderr) console.error("Chrome stderr (tail):\n", stderr.slice(-2000));
      process.exit(3);
    }
    console.log("Extension id:", extId);

    const offscreenUrl = `chrome-extension://${extId}/src/offscreen/offscreen.html`;
    const client = makeCdpClient(ver.webSocketDebuggerUrl);
    await client.ready;

    const { targetId } = await client.send("Target.createTarget", { url: offscreenUrl });
    const { sessionId } = await client.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Page.enable", {}, sessionId);

    // Wait for document ready
    for (let i = 0; i < 40; i++) {
      const { result } = await client.send(
        "Runtime.evaluate",
        { expression: "document.readyState", returnByValue: true },
        sessionId
      );
      if (result.value === "complete" || result.value === "interactive") break;
      await new Promise((r) => setTimeout(r, 250));
    }

    const probeExpr = `(() => new Promise((resolve) => {
      const workerUrl = chrome.runtime.getURL("src/inference/inference.worker.js");
      const w = new Worker(workerUrl, { type: "module" });
      const timer = setTimeout(() => {
        try { w.terminate(); } catch {}
        resolve({ ok: false, error: "INIT timed out after 90s" });
      }, 90000);
      w.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === "INIT_PROGRESS") {
          console.log("[smoke]", d.status || "INIT_PROGRESS");
          return;
        }
        if (d.type === "INIT_DONE") {
          clearTimeout(timer);
          try { w.terminate(); } catch {}
          resolve({
            ok: !!d.faceModelReady,
            faceModelReady: !!d.faceModelReady,
            faceModelError: d.faceModelError || null,
            backend: d.backend || null,
          });
          return;
        }
        if (d.type === "ERROR") {
          clearTimeout(timer);
          try { w.terminate(); } catch {}
          resolve({ ok: false, error: d.error || "worker ERROR" });
        }
      };
      w.onerror = (e) => {
        clearTimeout(timer);
        resolve({
          ok: false,
          error: (e && (e.message || (e.error && e.error.message))) || "worker onerror",
        });
      };
      w.postMessage({ type: "INIT" });
    }))()`;

    const { result, exceptionDetails } = await client.send(
      "Runtime.evaluate",
      {
        expression: probeExpr,
        awaitPromise: true,
        returnByValue: true,
        timeout: TIMEOUT_MS,
      },
      sessionId
    );

    client.close();

    if (exceptionDetails) {
      console.error("FAIL: evaluate exception", JSON.stringify(exceptionDetails, null, 2));
      process.exit(4);
    }

    const out = result && result.value;
    console.log("INIT result:", JSON.stringify(out, null, 2));
    if (!out || !out.ok || !out.faceModelReady) {
      console.error("FAIL: faceModelReady is not true");
      process.exit(5);
    }
    console.log("PASS: INIT_DONE faceModelReady=true (no blob import failure)");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err && err.message ? err.message : err);
    if (stderr) console.error("Chrome stderr (tail):\n", stderr.slice(-2000));
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
