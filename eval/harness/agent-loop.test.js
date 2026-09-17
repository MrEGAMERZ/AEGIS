/**
 * Aegis — Multi-step agent loop contract (bounded replan after each action).
 *
 * USAGE: node eval/harness/agent-loop.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC_PATH = path.join(__dirname, "..", "..", "src", "background", "background.js");
const POPUP_PATH = path.join(__dirname, "..", "..", "src", "popup", "popup.js");
const source = fs.readFileSync(SRC_PATH, "utf8");
const popupSrc = fs.readFileSync(POPUP_PATH, "utf8");

const sandbox = {
  chrome: {
    action: { onClicked: { addListener: () => {} } }, sidePanel: { setPanelBehavior: async () => {} }, runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: { local: { set: async () => {}, get: async () => ({}) } },
    action: { onClicked: { addListener: () => {} } },
    sidePanel: { setPanelBehavior: async () => {} },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  source +
    "\n;globalThis.__EXPORTS__ = { MAX_AGENT_STEPS, AGENT_STEP_DELAY_MS, agentLoopStopAfterCapture, agentLoopStopAfterExecute };",
  sandbox,
  { filename: SRC_PATH }
);
const {
  MAX_AGENT_STEPS,
  AGENT_STEP_DELAY_MS,
  agentLoopStopAfterCapture,
  agentLoopStopAfterExecute,
} = sandbox.__EXPORTS__;

let pass = 0;
let fail = 0;
function check(name, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}

console.log("Multi-step agent loop contract\n");

console.log("1. Constants");
check("MAX_AGENT_STEPS is bounded 8–12", MAX_AGENT_STEPS >= 8 && MAX_AGENT_STEPS <= 12);
check("AGENT_STEP_DELAY_MS is positive", AGENT_STEP_DELAY_MS > 0 && AGENT_STEP_DELAY_MS <= 2000);
check("popup.js matches MAX_AGENT_STEPS", popupSrc.includes(`MAX_AGENT_STEPS = ${MAX_AGENT_STEPS}`));
check("popup replans in a for-loop", /for\s*\(\s*let step = 1;\s*step <= MAX_AGENT_STEPS/.test(popupSrc));

console.log("\n2. Stop after capture (sanitize / VLM)");
check(
  "sanitize failure stops",
  agentLoopStopAfterCapture({ error: "FACE_REDACTION_REQUIRED", errorCode: "FACE_REDACTION_REQUIRED" }).stop === true
);
check(
  "VLM error stops",
  agentLoopStopAfterCapture({ vlmError: "VLM_BAD_RESPONSE: no action" }).stop === true
);
check(
  "missing action stops",
  agentLoopStopAfterCapture({ action: null }).stop === true
);
check(
  "valid action continues",
  agentLoopStopAfterCapture({ action: { action: "click", x: 1, y: 2 } }).stop === false
);

console.log("\n3. Stop after execute");
check(
  "execute error stops",
  agentLoopStopAfterExecute({
    step: 1,
    maxSteps: MAX_AGENT_STEPS,
    action: { action: "click" },
    execResult: { error: "bad" },
  }).stop === true
);
check(
  "done stops success",
  agentLoopStopAfterExecute({
    step: 3,
    maxSteps: MAX_AGENT_STEPS,
    action: { action: "done", summary: "filled form" },
    execResult: { ok: true },
  }).phase === "done"
);
check(
  "fill_many stops after one batch (no 90s-per-field loop)",
  agentLoopStopAfterExecute({
    step: 1,
    maxSteps: MAX_AGENT_STEPS,
    action: { action: "fill_many", fields: [{ action: "type" }, { action: "type" }] },
    execResult: { ok: true, filled: 2 },
  }).phase === "done"
);
check(
  "max steps stops after last execute",
  agentLoopStopAfterExecute({
    step: MAX_AGENT_STEPS,
    maxSteps: MAX_AGENT_STEPS,
    action: { action: "type" },
    execResult: { ok: true },
  }).phase === "max_steps"
);
check(
  "non-terminal action continues when under cap",
  agentLoopStopAfterExecute({
    step: 2,
    maxSteps: MAX_AGENT_STEPS,
    action: { action: "type" },
    execResult: { ok: true },
  }).stop === false
);

console.log(`\n${pass + fail} checks: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
