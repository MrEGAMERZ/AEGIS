#!/usr/bin/env node
/**
 * TP08 face recall smoke — applicant photo on a viewport-sized frame.
 * node eval/harness/face-tp08-smoke.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const PORT = 8773 + Math.floor(Math.random() * 50);
const DBG_PORT = 9538 + Math.floor(Math.random() * 50);
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-face-tp08-"));
const RUN_TIMEOUT_MS = 120000;

const CHROME_CANDIDATES = [
  "/Users/rehan/.cache/puppeteer/chrome/mac_arm-152.0.7977.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

const VIEW_W = 1280;
const VIEW_H = 900;
const PHOTO_X = 40;
const PHOTO_Y = 120;
const PHOTO_SIZE = 220;

const HTML = `<!doctype html><html><body>
<script type="module">
window.__face = { status: "boot" };
try {
  const photo = await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("photo load failed"));
    img.src = "/eval/test-pages/assets/applicant-face.jpg";
  });
  const c = document.createElement("canvas");
  c.width = ${VIEW_W};
  c.height = ${VIEW_H};
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#eef2f7";
  ctx.fillRect(0, 0, ${VIEW_W}, ${VIEW_H});
  ctx.fillStyle = "#fff";
  ctx.fillRect(20, 80, 280, 420);
  ctx.drawImage(photo, ${PHOTO_X}, ${PHOTO_Y}, ${PHOTO_SIZE}, ${PHOTO_SIZE});
  const imageDataUrl = c.toDataURL("image/png");
  window.__face = { status: "frame-ready" };
  const w = new Worker("/src/inference/inference.worker.js", { type: "module" });
  const fail = (status, error) => { window.__face = { status, ok: false, error }; };
  const timer = setTimeout(() => fail("timeout", "no FACES_DETECTED"), ${RUN_TIMEOUT_MS - 10000});
  w.onmessage = (e) => {
    const d = e.data || {};
    if (d.type === "INIT_DONE") {
      w.postMessage({ type: "DETECT_FACES", payload: { imageDataUrl }, id: 1 });
      return;
    }
    if (d.type === "FACES_DETECTED") {
      clearTimeout(timer);
      const faces = d.faces || [];
      const region = [${PHOTO_X}, ${PHOTO_Y}, ${PHOTO_X + PHOTO_SIZE}, ${PHOTO_Y + PHOTO_SIZE}];
      const overlap = (bb) => !(bb[2] < region[0] || bb[0] > region[2] || bb[3] < region[1] || bb[1] > region[3]);
      const onPhoto = faces.filter((f) => f.bbox && overlap(f.bbox));
      window.__face = { status: "done", ok: onPhoto.length > 0, faces, onPhoto, photoRegion: region };
      try { w.terminate(); } catch {}
      return;
    }
    if (d.type === "ERROR") {
      clearTimeout(timer);
      fail("error", d.error || "ERROR");
    }
  };
  w.onerror = (e) => {
    clearTimeout(timer);
    fail("onerror", e.message || (e.error && e.error.message) || "worker onerror");
  };
  w.postMessage({ type: "INIT" });
} catch (e) {
  window.__face = { status: "page-error", ok: false, error: e.message, stack: (e.stack || "").split("\\n").slice(0, 5) };
}
</script></body></html>`;

function serveFile(res, fp) {
  const ext = path.extname(fp);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".wasm": "application/wasm",
    ".onnx": "application/octet-stream",
    ".jpg": "image/jpeg",
    ".png": "image/png",
  };
  res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
  fs.createReadStream(fp).pipe(res);
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === "/" || req.url === "/smoke.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(HTML);
        return;
      }
      const rel = decodeURIComponent(req.url.split("?")[0]);
      for (const base of [DIST, ROOT]) {
        const fp = path.join(base, rel.replace(/^\//, ""));
        if (fp.startsWith(ROOT) && fs.existsSync(fp) && fs.statSync(fp).isFile()) {
          serveFile(res, fp);
          return;
        }
      }
      res.writeHead(404);
      res.end("missing");
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function waitJson(url, n = 60) {
  for (let i = 0; i < n; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
    } catch { /* */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("CDP not ready");
}

function makeCdp(wsUrl, onEvent) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const pending = new Map();
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
    if (msg.method && onEvent) onEvent(msg);
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
        }, RUN_TIMEOUT_MS);
      });
    },
    close() {
      try { ws.close(); } catch { /* */ }
    },
  };
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error("FAIL: dist/ missing");
    process.exit(2);
  }
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    console.error("FAIL: no Chrome binary");
    process.exit(2);
  }

  const server = await serve();
  const child = spawn(
    chrome,
    [
      `--remote-debugging-port=${DBG_PORT}`,
      "--remote-allow-origins=*",
      `--user-data-dir=${USER_DATA}`,
      "--headless=new",
      "--no-first-run",
      "--disable-gpu",
      `http://127.0.0.1:${PORT}/smoke.html`,
    ],
    { stdio: "ignore" }
  );

  const cleanup = () => {
    try { child.kill("SIGKILL"); } catch {}
    try { server.close(); } catch {}
    try { fs.rmSync(USER_DATA, { recursive: true, force: true }); } catch {}
  };
  process.on("exit", cleanup);

  try {
    const ver = await waitJson(`http://127.0.0.1:${DBG_PORT}/json/version`);
    const client = makeCdp(ver.webSocketDebuggerUrl, (msg) => {
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params?.args || []).map((a) => a.value ?? a.description ?? "").join(" ");
        if (text.trim()) console.log(`  [console.${msg.params.type}] ${text}`);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        console.log(`  [exception] ${d?.text} ${d?.exception?.description || ""}`);
      }
    });
    await client.ready;
    await client.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });

    const pages = await waitJson(`http://127.0.0.1:${DBG_PORT}/json/list`);
    const page = pages.find((t) => String(t.url || "").includes("smoke.html")) || pages[0];
    const { sessionId } = await client.send("Target.attachToTarget", { targetId: page.id, flatten: true });
    await client.send("Runtime.enable", {}, sessionId);

    const started = Date.now();
    let out = null;
    while (Date.now() - started < RUN_TIMEOUT_MS) {
      const { result } = await client.send(
        "Runtime.evaluate",
        { expression: "window.__face", returnByValue: true, awaitPromise: true },
        sessionId
      );
      out = result?.value;
      if (out?.status && out.status !== "boot") {
        console.log(`  … ${out.status}${out.error ? ": " + out.error : ""}`);
      }
      if (out && ["done", "error", "onerror", "timeout", "page-error"].includes(out.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    client.close();

    console.log("\nFace result:", JSON.stringify(out, null, 2));
    if (!out || out.status !== "done" || !out.ok) {
      process.exit(5);
    }
    console.log(`PASS: ${out.onPhoto.length} face(s) on TP08 photo at ${VIEW_W}×${VIEW_H}`);
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err.message || err);
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
