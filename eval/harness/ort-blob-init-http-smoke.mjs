#!/usr/bin/env node
/**
 * HTTP + module-Worker smoke for BlazeFace INIT (no chrome.* needed).
 * Serves the repo root, opens a page that constructs the real
 * inference.worker.js, posts INIT, asserts faceModelReady.
 *
 * Proves the patched ort.min.js does not die on blob: dynamic import.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 8768;
const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ort-http-"));
const TIMEOUT_MS = 120_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".json": "application/json",
};

const HTML = `<!doctype html>
<html><body>
<script type="module">
window.__ortSmoke = { status: "starting" };
const w = new Worker("/src/inference/inference.worker.js", { type: "module" });
const t = setTimeout(() => {
  window.__ortSmoke = { status: "timeout", ok: false };
}, 90000);
w.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === "INIT_PROGRESS") {
    window.__ortSmoke = { status: "progress", detail: d.status };
    return;
  }
  if (d.type === "INIT_DONE") {
    clearTimeout(t);
    window.__ortSmoke = {
      status: "done",
      ok: !!d.faceModelReady,
      faceModelReady: !!d.faceModelReady,
      faceModelError: d.faceModelError || null,
      backend: d.backend || null,
    };
    try { w.terminate(); } catch {}
    return;
  }
  if (d.type === "ERROR") {
    clearTimeout(t);
    window.__ortSmoke = { status: "error", ok: false, error: d.error || "ERROR" };
  }
};
w.onerror = (e) => {
  clearTimeout(t);
  window.__ortSmoke = {
    status: "onerror",
    ok: false,
    error: e.message || (e.error && e.error.message) || "onerror",
  };
};
w.postMessage({ type: "INIT" });
</script>
</body></html>`;

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/smoke.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML);
        return;
      }
      const rel = decodeURIComponent(req.url.split("?")[0]);
      const filePath = path.join(ROOT, rel);
      if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function waitJson(url, n = 40) {
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("CDP not ready");
}

function makeCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", rej);
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });
  return {
    ready,
    send(method, params = {}, sessionId) {
      const my = id++;
      const payload = { id: my, method, params };
      if (sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(my, { resolve, reject });
        setTimeout(() => {
          if (pending.has(my)) {
            pending.delete(my);
            reject(new Error("timeout " + method));
          }
        }, TIMEOUT_MS);
      });
    },
    close() {
      try {
        ws.close();
      } catch {
        /* */
      }
    },
  };
}

async function main() {
  if (!fs.existsSync(CHROME)) {
    console.error("FAIL: Chrome not found");
    process.exit(2);
  }
  const server = await serve();
  const dbgPort = 9533;
  const child = spawn(
    CHROME,
    [
      `--remote-debugging-port=${dbgPort}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${USER_DATA}`,
      "--headless=new",
      "--no-first-run",
      "--disable-gpu",
      `http://127.0.0.1:${PORT}/smoke.html`,
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );
  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += String(d);
  });

  const cleanup = () => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* */
    }
    try {
      server.close();
    } catch {
      /* */
    }
    try {
      fs.rmSync(USER_DATA, { recursive: true, force: true });
    } catch {
      /* */
    }
  };
  process.on("exit", cleanup);

  try {
    const ver = await waitJson(`http://127.0.0.1:${dbgPort}/json/version`);
    const client = makeCdp(ver.webSocketDebuggerUrl);
    await client.ready;

    // Attach to the existing page
    const pages = await waitJson(`http://127.0.0.1:${dbgPort}/json/list`);
    const page = pages.find((t) => String(t.url || "").includes("smoke.html")) || pages[0];
    if (!page) throw new Error("no page target");
    const { sessionId } = await client.send("Target.attachToTarget", {
      targetId: page.id,
      flatten: true,
    });
    await client.send("Runtime.enable", {}, sessionId);

    const started = Date.now();
    let out = null;
    while (Date.now() - started < 100_000) {
      const { result } = await client.send(
        "Runtime.evaluate",
        { expression: "window.__ortSmoke", returnByValue: true },
        sessionId
      );
      out = result && result.value;
      if (out && (out.status === "done" || out.status === "error" || out.status === "onerror" || out.status === "timeout")) {
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    client.close();
    console.log("INIT result:", JSON.stringify(out, null, 2));
    if (!out || !out.ok || !out.faceModelReady) {
      console.error("FAIL: faceModelReady not true");
      if (stderr) console.error(stderr.slice(-1500));
      process.exit(5);
    }
    console.log("PASS: HTTP module-Worker INIT_DONE faceModelReady=true");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err.message || err);
    if (stderr) console.error(stderr.slice(-1500));
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
