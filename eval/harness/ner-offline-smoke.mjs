#!/usr/bin/env node
/**
 * Offline NER smoke — proves the fail-closed NER gate survives a dead network.
 *
 * Before this, DETECT_NER pulled ~67MB of DistilBERT weights from
 * huggingface.co plus ~22MB of WASM from cdn.jsdelivr.net on first run. NER is
 * a fail-closed gate, so a venue with no wifi meant no VLM call at all.
 *
 * Method:
 *   1. Serve dist/ (the packaged artifact, not the repo) over loopback, so a
 *      file missing from the build fails here rather than at demo time.
 *   2. Launch Chrome with --host-resolver-rules mapping EVERY host to a closed
 *      port, excluding loopback. Any attempt to reach huggingface.co or
 *      cdn.jsdelivr.net gets ECONNREFUSED.
 *   3. Auto-attach to every target (including the module Worker) and record
 *      each requestWillBeSent, so an off-box fetch is caught even if some
 *      fallback silently swallowed it.
 *   4. Run the real inference.worker.js: INIT, then DETECT_NER on text with a
 *      known PERSON, and require real entities back.
 *
 * PASS requires both: entities returned AND zero non-loopback requests.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import os from "node:os";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const PORT = 8771;
const DBG_PORT = 9536;
const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "aegis-ner-offline-"));
const CDP_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 240_000;

const CHROME_CANDIDATES = [
  "/Users/rehan/.cache/puppeteer/chrome/mac_arm-152.0.7977.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

// Text with an unambiguous PERSON/LOC so a working model must return entities.
// A model that silently failed open would return [] and fail this harness.
const NER_TEXT = "Ananya Krishnan lives in Bangalore and works at Infosys.";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
};

const HTML = `<!doctype html>
<html><body>
<script type="module">
window.__ner = { status: "starting" };
const w = new Worker("/src/inference/inference.worker.js", { type: "module" });
const fail = (status, error) => { window.__ner = { status, ok: false, error }; };
const t = setTimeout(() => fail("timeout", "no NER_DETECTED within budget"), ${RUN_TIMEOUT_MS - 20000});
let initDoneAt = 0;
const t0 = Date.now();
w.onmessage = (e) => {
  const d = e.data || {};
  if (d.type === "INIT_PROGRESS") {
    window.__ner = { status: "progress", detail: d.status };
    return;
  }
  if (d.type === "INIT_DONE") {
    initDoneAt = Date.now();
    window.__ner = { status: "init_done", faceModelReady: !!d.faceModelReady };
    // detectNER takes {text, rect} items — a bare string is skipped for having
    // no measurable bbox, which would silently look like "model found nothing".
    w.postMessage({
      type: "DETECT_NER",
      payload: { texts: [{ text: ${JSON.stringify(NER_TEXT)}, rect: { x: 10, y: 20, width: 300, height: 18 } }] },
      id: 1,
    });
    return;
  }
  if (d.type === "NER_DETECTED") {
    clearTimeout(t);
    window.__ner = {
      status: "done",
      ok: Array.isArray(d.entities) && d.entities.length > 0,
      entities: d.entities || [],
      nerModelReady: !!d.nerModelReady,
      initMs: initDoneAt - t0,
      nerMs: Date.now() - initDoneAt,
      totalMs: Date.now() - t0,
    };
    try { w.terminate(); } catch {}
    return;
  }
  if (d.type === "ERROR") {
    clearTimeout(t);
    window.__ner = {
      status: "error",
      ok: false,
      error: d.error || "ERROR",
      originalType: d.originalType || null,
      stack: d.stack || null,
    };
  }
};
w.onerror = (e) => {
  clearTimeout(t);
  fail("onerror", e.message || (e.error && e.error.message) || "onerror");
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
      const filePath = path.join(DIST, rel);
      if (!filePath.startsWith(DIST) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404);
        res.end("missing");
        return;
      }
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      });
      fs.createReadStream(filePath).pipe(res);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function waitJson(url, n = 60) {
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

function makeCdp(wsUrl, onEvent) {
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
      return;
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
        }, CDP_TIMEOUT_MS);
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

const isLoopback = (url) =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url) ||
  /^(blob|data|chrome-extension|chrome|about|wss?):/.test(url);

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error("FAIL: dist/ missing — run ./scripts/build-dist.sh first");
    process.exit(2);
  }
  const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!chrome) {
    console.error("FAIL: no Chrome binary found");
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
      "--no-default-browser-check",
      "--disable-gpu",
      // Every hostname resolves to a closed port; loopback is exempt so the
      // local file server still answers. This is the network block.
      "--host-resolver-rules=MAP * 127.0.0.1:9,EXCLUDE localhost,EXCLUDE 127.0.0.1",
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

  const requests = [];
  try {
    const ver = await waitJson(`http://127.0.0.1:${DBG_PORT}/json/version`);
    const client = makeCdp(ver.webSocketDebuggerUrl, (msg) => {
      if (msg.method === "Network.requestWillBeSent") {
        const url = msg.params?.request?.url || "";
        requests.push(url);
      }
      // Workers show up as new targets; enable Network on each so a fetch from
      // inside the module Worker is recorded too.
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params?.args || [])
          .map((a) => a.value ?? a.description ?? a.unserializableValue ?? "")
          .join(" ");
        if (text.trim()) console.log(`  [console.${msg.params.type}] ${text}`);
      }
      if (msg.method === "Runtime.exceptionThrown") {
        const d = msg.params?.exceptionDetails;
        console.log(`  [exception] ${d?.text} ${d?.exception?.description || ""}`);
      }
      if (msg.method === "Target.attachedToTarget") {
        const sid = msg.params?.sessionId;
        if (sid) {
          client.send("Network.enable", {}, sid).catch(() => {});
          client.send("Runtime.enable", {}, sid).catch(() => {});
          client.send("Runtime.runIfWaitingForDebugger", {}, sid).catch(() => {});
        }
      }
    });
    await client.ready;
    await client.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    });

    const pages = await waitJson(`http://127.0.0.1:${DBG_PORT}/json/list`);
    const page = pages.find((t) => String(t.url || "").includes("smoke.html")) || pages[0];
    if (!page) throw new Error("no page target");
    const { sessionId } = await client.send("Target.attachToTarget", {
      targetId: page.id,
      flatten: true,
    });
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("Network.enable", {}, sessionId);
    await client.send("Target.setAutoAttach", {
      autoAttach: true,
      waitForDebuggerOnStart: false,
      flatten: true,
    }, sessionId);

    const started = Date.now();
    let out = null;
    let lastDetail = null;
    while (Date.now() - started < RUN_TIMEOUT_MS) {
      const { result } = await client.send(
        "Runtime.evaluate",
        { expression: "window.__ner", returnByValue: true },
        sessionId
      );
      out = result && result.value;
      if (out && out.detail && out.detail !== lastDetail) {
        lastDetail = out.detail;
        console.log(`  … ${out.detail}`);
      }
      if (out && ["done", "error", "onerror", "timeout"].includes(out.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    client.close();

    const external = [...new Set(requests.filter((u) => !isLoopback(u)))];

    console.log("\nNER result:", JSON.stringify(out, null, 2));
    console.log(`\nrequests observed: ${requests.length}`);
    console.log(`non-loopback requests: ${external.length}`);
    for (const u of external) console.log(`  EXTERNAL ${u}`);

    let failed = false;
    if (!out || out.status !== "done" || !out.ok) {
      console.error("FAIL: NER did not return entities with the network blocked");
      failed = true;
    }
    if (external.length > 0) {
      console.error("FAIL: extension attempted a non-loopback request");
      failed = true;
    }
    if (failed) {
      if (stderr) console.error(stderr.slice(-2000));
      process.exit(5);
    }
    const labels = (out.entities || []).map((e) => `${e.entity || e.entity_group}:${e.word}`);
    console.log(`\nentities (${out.entities.length}): ${labels.join(", ")}`);
    console.log(`init ${out.initMs}ms | ner ${out.nerMs}ms | total ${out.totalMs}ms`);
    console.log("\nPASS: NER ran fully offline from dist/ with zero external requests");
    process.exit(0);
  } catch (err) {
    console.error("FAIL:", err.message || err);
    if (stderr) console.error(stderr.slice(-2000));
    process.exit(1);
  } finally {
    cleanup();
  }
}

main();
