#!/usr/bin/env node
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const PORT = 8700 + Math.floor(Math.random() * 200);
const DBG = 9400 + Math.floor(Math.random() * 200);

const HTML = `<!doctype html><body><script type="module">
window.__d = { phase: "boot" };
import { pipeline, env } from "/src/vendor/transformers.min.js";
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.localModelPath = new URL("/src/vendor/models/", location.href).href;
env.useBrowserCache = false;
const wasm = env.backends?.onnx?.wasm;
const wasmUrl = new URL("/src/vendor/ort-wasm-simd-threaded.wasm", location.href).href;
if (wasm) {
  wasm.numThreads = 1;
  wasm.proxy = false;
  wasm.wasmPaths = { wasm: wasmUrl };
  const r = await fetch(wasmUrl);
  wasm.wasmBinary = await r.arrayBuffer();
}
const t0 = Date.now();
try {
  window.__d = { phase: "loading", ms: 0 };
  const p = await pipeline("token-classification", "distilbert-ner", { device: "wasm", dtype: "q8" });
  window.__d = { phase: "loaded", ms: Date.now() - t0, tok: typeof p.tokenizer };
  const o = await p("Ananya Krishnan lives in Bangalore", { aggregation_strategy: "simple" });
  window.__d = {
    phase: "done",
    ms: Date.now() - t0,
    tok: typeof p.tokenizer,
    n: o.length,
    entities: o.map((e) => e.entity_group + ":" + e.word),
  };
} catch (e) {
  window.__d = { phase: "err", ms: Date.now() - t0, err: e.message, stack: (e.stack || "").split("\\n").slice(0, 4) };
}
</script></body></html>`;

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.end(HTML);
    return;
  }
  const fp = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!fp.startsWith(DIST) || !fs.existsSync(fp)) {
    res.statusCode = 404;
    res.end("missing");
    return;
  }
  res.end(fs.readFileSync(fp));
});

const chrome =
  "/Users/rehan/.cache/puppeteer/chrome/mac_arm-152.0.7977.54/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing";

await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
const child = spawn(
  chrome,
  [
    `--remote-debugging-port=${DBG}`,
    "--remote-allow-origins=*",
    "--headless=new",
    "--host-resolver-rules=MAP * 127.0.0.1:9,EXCLUDE localhost,EXCLUDE 127.0.0.1",
    `http://127.0.0.1:${PORT}/`,
  ],
  { stdio: "ignore" }
);

await new Promise((r) => setTimeout(r, 1500));
const pages = await fetch(`http://127.0.0.1:${DBG}/json/list`).then((r) => r.json());
const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.id && pending.has(m.id)) {
    pending.get(m.id).resolve(m.result);
    pending.delete(m.id);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const my = id++;
    pending.set(my, { resolve, reject });
    ws.send(JSON.stringify({ id: my, method, params }));
    setTimeout(() => {
      if (pending.has(my)) {
        pending.delete(my);
        reject(new Error("timeout " + method));
      }
    }, 180000);
  });

await send("Runtime.enable");
await send("Log.enable");
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(String(ev.data));
  if (m.method === "Runtime.exceptionThrown") {
    console.log("EXCEPTION", m.params?.exceptionDetails?.text, m.params?.exceptionDetails?.exception?.description);
  }
  if (m.method === "Log.entryAdded") {
    console.log("LOG", m.params?.entry?.text);
  }
});
let final = null;
for (let i = 0; i < 100; i++) {
  const { result } = await send("Runtime.evaluate", { expression: "window.__d", returnByValue: true });
  const v = result?.value;
  if (v?.phase === "done" || v?.phase === "err") {
    final = v;
    break;
  }
  if (i % 4 === 0) console.log("…", v?.phase, v?.ms ?? "");
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(JSON.stringify(final, null, 2));
child.kill();
server.close();
process.exit(final?.phase === "done" ? 0 : 1);
