#!/usr/bin/env node
/** Quick debug: inspect NER pipeline tokenizer after local load */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(ROOT, "dist");
const PORT = 8772;
const DBG = 9537;

const HTML = `<!doctype html><body><script type="module">
window.__d = { status: "start" };
const w = new Worker("/src/inference/inference.worker.js", { type: "module" });
w.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === "INIT_DONE") {
    const { pipeline, env } = await import("/src/vendor/transformers.min.js");
    env.allowLocalModels = true;
    env.allowRemoteModels = false;
    env.localModelPath = new URL("/src/vendor/models/", location.href).href;
    env.useBrowserCache = false;
    const p = await pipeline("token-classification", "distilbert-ner", { device: "wasm", dtype: "q8" });
    window.__d = {
      status: "done",
      keys: Object.keys(p),
      tokenizerType: typeof p.tokenizer,
      tokenizerName: p.tokenizer?.constructor?.name,
      tokenizerKeys: p.tokenizer ? Object.keys(p.tokenizer).slice(0, 20) : null,
      hasCall: typeof p.tokenizer === "function",
      hasTokenizerCall: typeof p.tokenizer?._call === "function",
    };
    try {
      const r = await p("Ananya Krishnan", { aggregation_strategy: "simple" });
      window.__d.results = r;
      window.__d.inferOk = true;
    } catch (err) {
      window.__d.inferOk = false;
      window.__d.inferErr = err.message;
    }
  }
};
w.postMessage({ type: "INIT" });
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
const child = spawn(chrome, [
  `--remote-debugging-port=${DBG}`,
  "--remote-allow-origins=*",
  "--headless=new",
  `http://127.0.0.1:${PORT}/`,
]);
await new Promise((r) => setTimeout(r, 1500));
const ver = await fetch(`http://127.0.0.1:${DBG}/json/version`).then((r) => r.json());
const ws = new WebSocket(ver.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.addEventListener("open", res);
  ws.addEventListener("error", rej);
});
let id = 1;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const my = id++;
    pending.set(my, { resolve, reject });
    ws.send(JSON.stringify({ id: my, method, params }));
  });
const pages = await fetch(`http://127.0.0.1:${DBG}/json/list`).then((r) => r.json());
const page = pages.find((t) => String(t.url || "").includes("8772")) || pages[0];
const pageWs = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => {
  pageWs.addEventListener("open", res);
  pageWs.addEventListener("error", rej);
});
const pagePending = new Map();
let pageId = 1;
pageWs.addEventListener("message", (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pagePending.has(msg.id)) {
    const { resolve, reject } = pagePending.get(msg.id);
    pagePending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const pageSend = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const my = pageId++;
    pagePending.set(my, { resolve, reject });
    pageWs.send(JSON.stringify({ id: my, method, params }));
  });
await pageSend("Runtime.enable");
for (let i = 0; i < 120; i++) {
  const { result } = await pageSend("Runtime.evaluate", {
    expression: "window.__d",
    returnByValue: true,
  });
  if (result?.value?.status === "done") {
    console.log(JSON.stringify(result.value, null, 2));
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}
child.kill();
server.close();
process.exit(0);
