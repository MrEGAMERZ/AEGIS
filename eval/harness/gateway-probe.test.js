/**
 * gateway-probe.test.js — probeRealGateway + resolveVlmEndpoint + TIMEOUT
 *
 *   node eval/harness/gateway-probe.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC_PATH = path.join(__dirname, "..", "..", "src", "background", "background.js");
const source = fs.readFileSync(SRC_PATH, "utf8");

const storage = {};
const sandbox = {
  chrome: {
    runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      getContexts: async () => [],
      sendMessage: async () => ({}),
    },
    storage: {
      local: {
        get: async (keys) => {
          if (Array.isArray(keys)) {
            const out = {};
            for (const k of keys) out[k] = storage[k];
            return out;
          }
          return { ...storage };
        },
        set: async (obj) => Object.assign(storage, obj),
      },
      session: {
        get: async () => ({}),
        set: async () => {},
        remove: async () => {},
      },
    },
    commands: { onCommand: { addListener: () => {} } },
    contextMenus: { create: () => {}, onClicked: { addListener: () => {} } },
    tabs: { query: async () => [], sendMessage: async () => ({}) },
  },
  console,
  AbortSignal: { timeout: () => ({}) },
  fetch: async () => sandbox.__health,
};
vm.createContext(sandbox);
vm.runInContext(
  source +
    "\n;globalThis.__EXPORTS__ = { probeRealGateway, probeGatewayHealth, resolveVlmEndpoint, classifyError, DEFAULT_GATEWAY_VLM, DEFAULT_OLLAMA_VLM };",
  sandbox,
  { filename: SRC_PATH }
);
const {
  probeRealGateway,
  probeGatewayHealth,
  resolveVlmEndpoint,
  classifyError,
  DEFAULT_GATEWAY_VLM,
  DEFAULT_OLLAMA_VLM,
} = sandbox.__EXPORTS__;

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    console.log("  PASS ", name);
    pass++;
  } else {
    console.log("  FAIL ", name, extra || "");
    fail++;
  }
}

async function main() {
  sandbox.__health = { ok: true, json: async () => ({ status: "ok", mock: false, upstreamReachable: true }) };
  check("real gateway probe returns :8000", (await probeRealGateway()) === DEFAULT_GATEWAY_VLM);

  sandbox.__health = { ok: true, json: async () => ({ status: "ok", mock: false, upstreamReachable: false }) };
  check("gateway without Ollama is not a working VLM", (await probeRealGateway()) === null);

  sandbox.__health = { ok: true, json: async () => ({ status: "ok", mock: true }) };
  check("mock health is ignored", (await probeRealGateway()) === null);

  sandbox.__health = { ok: false, json: async () => ({}) };
  check("non-ok health is ignored", (await probeRealGateway()) === null);

  sandbox.fetch = async () => {
    throw new Error("ECONNREFUSED");
  };
  check("down gateway is ignored", (await probeRealGateway()) === null);

  sandbox.fetch = async () => ({ ok: true, json: async () => ({ status: "ok", mock: false, upstreamReachable: true }) });
  const resolved = await resolveVlmEndpoint(DEFAULT_OLLAMA_VLM);
  check("resolve upgrades stored Ollama URL to gateway", resolved === DEFAULT_GATEWAY_VLM);

  sandbox.fetch = async () => {
    throw new Error("down");
  };
  const storedGateway = await resolveVlmEndpoint("http://localhost:8000/v1/chat/completions");
  check(
    "resolve keeps stored :8000 when probe fails",
    storedGateway === DEFAULT_GATEWAY_VLM,
    storedGateway
  );

  check(
    "classifyError maps timed out to TIMEOUT",
    classifyError({ message: "VLM server timed out after 120s at http://localhost:8000/v1/chat/completions" }) ===
      "TIMEOUT"
  );

  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
