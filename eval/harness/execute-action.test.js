/**
 * Aegis — Regression test for "The Hand" (Problem 4: Execute Action)
 * eval/harness/execute-action.test.js
 *
 * BACKGROUND
 * ----------
 * The VLM only ever sees the sanitized screenshot, and
 * chrome.tabs.captureVisibleTab() produces that image at PHYSICAL pixel
 * resolution (CSS px x devicePixelRatio). document.elementFromPoint() takes
 * CSS pixels. Before the fix logged in engineers/frontend/work_done.md
 * (2026-08-28, "Click coordinate frame"), executeClick() passed the model's
 * image-space coordinate straight into elementFromPoint(), so on any HiDPI
 * display (Retina, dpr=2) a click either hit the wrong element or fell
 * outside the viewport and returned null. No harness covered the action
 * executor at all, so this went unnoticed.
 *
 * WHAT THIS TESTS
 * ---------------
 * The REAL src/content/content.js is loaded into a sandboxed Node VM with a
 * minimal DOM stub. The test drives the actual chrome.runtime.onMessage
 * listener with EXECUTE_CLICK / EXECUTE_TYPE / EXECUTE_SCROLL messages — the
 * same message contract src/background/background.js uses in
 * handleExecuteAction(). There is no copied algorithm to drift out of sync.
 *
 * USAGE
 * -----
 *   node eval/harness/execute-action.test.js
 *
 * DEPENDENCIES: none (pure Node core modules only — fs, path, vm).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

// AEGIS_CONTENT_SRC lets a reviewer point this harness at an older copy of
// content.js to confirm the click tests below actually fail on the pre-fix
// version, rather than passing vacuously.
const SRC_PATH =
  process.env.AEGIS_CONTENT_SRC ||
  path.join(__dirname, "..", "..", "src", "content", "content.js");
const source = fs.readFileSync(SRC_PATH, "utf8");

// ── Minimal DOM stub ───────────────────────────────────────────────

function makeValueProto() {
  const proto = {};
  Object.defineProperty(proto, "value", {
    configurable: true,
    get() {
      return this._value === undefined ? "" : this._value;
    },
    set(v) {
      this._value = v;
      this.nativeSetterCalls = (this.nativeSetterCalls || 0) + 1;
    },
  });
  return proto;
}

const HTMLInputElement = { prototype: makeValueProto() };
const HTMLTextAreaElement = { prototype: makeValueProto() };

/** Create a fake element. `tag` is upper-case, matching real DOM tagName. */
function el(tag, props = {}) {
  const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const node = Object.create(proto);
  Object.assign(node, {
    tagName: tag,
    id: "",
    name: "",
    className: "",
    isContentEditable: false,
    clicks: 0,
    focuses: 0,
    scrollIntoViewCalls: 0,
    events: [],
    _closestMatch: null,
    click() {
      this.clicks++;
    },
    focus() {
      this.focuses++;
    },
    scrollIntoView() {
      this.scrollIntoViewCalls++;
    },
    dispatchEvent(e) {
      this.events.push(e);
      return true;
    },
    // buildSelector() walks parentElement when there is no id/name/class.
    parentElement: null,
    closest(sel) {
      // Test controls the answer via _closestMatch; default = no ancestor match.
      return this._closestMatch && sel ? this._closestMatch : null;
    },
  });
  Object.assign(node, props);
  return node;
}

/**
 * Load the real content.js into a fresh sandbox.
 * hooks: { dpr, elementFromPoint(x,y), querySelector(sel) }
 */
function loadContentScript(hooks = {}) {
  const dpr = hooks.dpr === undefined ? 1 : hooks.dpr;
  const calls = { elementFromPoint: [], scrollBy: [] };

  let messageListener = null;

  const documentStub = {
    documentElement: { appendChild() {} },
    body: {},
    getElementById: () => null,
    createElement: () => el("DIV"),
    querySelectorAll: () => [],
    querySelector: (sel) => (hooks.querySelector ? hooks.querySelector(sel) : null),
    elementFromPoint: (x, y) => {
      calls.elementFromPoint.push({ x, y });
      return hooks.elementFromPoint ? hooks.elementFromPoint(x, y) : null;
    },
    createTreeWalker: () => ({ nextNode: () => null }),
  };

  const windowStub = {
    devicePixelRatio: dpr,
    innerHeight: 800,
    scrollX: 0,
    scrollY: 0,
    addEventListener() {},
    getComputedStyle: () => ({ display: "block", visibility: "visible", opacity: "1" }),
    scrollBy: (opts) => {
      calls.scrollBy.push(opts);
    },
  };

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    document: documentStub,
    window: windowStub,
    devicePixelRatio: dpr,
    visualViewport: undefined,
    requestAnimationFrame: () => 0,
    setTimeout,
    clearTimeout,
    CSS: { escape: (s) => String(s) },
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    HTMLInputElement,
    HTMLTextAreaElement,
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    Event: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    InputEvent: class {
      constructor(type, init) {
        this.type = type;
        Object.assign(this, init || {});
      }
    },
    chrome: {
      action: { onClicked: { addListener: () => {} } }, sidePanel: { setPanelBehavior: async () => {} }, runtime: {
        onMessage: {
          addListener: (fn) => {
            messageListener = fn;
          },
        },
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: SRC_PATH });

  if (typeof messageListener !== "function") {
    throw new Error("content.js did not register a chrome.runtime.onMessage listener");
  }

  /** Drive the real listener and return what it passed to sendResponse. */
  function send(message) {
    let response;
    let captured = false;
    const returned = messageListener(message, null, (r) => {
      response = r;
      captured = true;
    });
    return { response, captured, returned };
  }

  return { send, calls, window: windowStub };
}

// ── Test runner ────────────────────────────────────────────────────

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

console.log("\nEXECUTE_CLICK — coordinate frame (Problem 4 / Visual Accuracy)\n");

// 1. dpr=1: model coordinate is already CSS px, used as-is.
{
  const button = el("BUTTON", { id: "login" });
  const ctx = loadContentScript({ dpr: 1, elementFromPoint: () => button });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 150, y: 300 });
  check(
    "dpr=1 probes the raw coordinate",
    ctx.calls.elementFromPoint[0].x === 150 && ctx.calls.elementFromPoint[0].y === 300,
    JSON.stringify(ctx.calls.elementFromPoint[0])
  );
  check("dpr=1 clicks the element", button.clicks === 1);
  check("dpr=1 reports ok", response && response.ok === true, JSON.stringify(response));
}

// 2. dpr=2: image-space coordinate MUST be divided by dpr before elementFromPoint.
{
  const button = el("BUTTON", { id: "login" });
  const ctx = loadContentScript({ dpr: 2, elementFromPoint: () => button });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 300, y: 600 });
  check(
    "dpr=2 scales image px -> CSS px (300,600 -> 150,300)",
    ctx.calls.elementFromPoint[0].x === 150 && ctx.calls.elementFromPoint[0].y === 300,
    JSON.stringify(ctx.calls.elementFromPoint[0])
  );
  check("dpr=2 clicks the element", button.clicks === 1);
  check("dpr=2 reports the image frame", response && response.frame === "image", JSON.stringify(response));
  check("dpr=2 echoes dpr back for debugging", response && response.dpr === 2);
}

// 3. Regression guard: the pre-fix bug. On dpr=2 an unscaled coordinate
//    lands outside the viewport and elementFromPoint returns null.
{
  const button = el("BUTTON", { id: "login" });
  const VIEWPORT_CSS_W = 700;
  const ctx = loadContentScript({
    dpr: 2,
    elementFromPoint: (x) => (x <= VIEWPORT_CSS_W ? button : null),
  });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 1200, y: 400 });
  check(
    "dpr=2 out-of-viewport image coord still resolves after scaling",
    response && response.ok === true,
    JSON.stringify(response)
  );
  check("…and physically clicks", button.clicks === 1);
}

// 4. Fallback: model answered in CSS px even though dpr=2.
{
  const button = el("BUTTON", { id: "submit" });
  const ctx = loadContentScript({
    dpr: 2,
    // Only the unscaled point hits anything.
    elementFromPoint: (x, y) => (x === 400 && y === 500 ? button : null),
  });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 400, y: 500 });
  check("falls back to the CSS frame when the image frame misses", response && response.frame === "css", JSON.stringify(response));
  check("…and still clicks exactly once", button.clicks === 1);
}

// 5. An html/body hit must not win over a real control in the other frame.
{
  const body = el("BODY");
  const button = el("BUTTON", { id: "real" });
  const ctx = loadContentScript({
    dpr: 2,
    elementFromPoint: (x) => (x === 200 ? body : button), // scaled hits body
  });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 400, y: 400 });
  check("body hit is skipped in favour of a real control", response && response.clicked === "BUTTON", JSON.stringify(response));
  check("body was not clicked", body.clicks === 0);
}

// 6. Climb from an inner text node's element to the actual control.
{
  const button = el("BUTTON", { id: "outer" });
  const span = el("SPAN", { _closestMatch: button });
  const ctx = loadContentScript({ dpr: 1, elementFromPoint: () => span });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 10, y: 10 });
  check("climbs from inner element to the clickable ancestor", button.clicks === 1 && span.clicks === 0, JSON.stringify(response));
}

// 7. Nothing anywhere -> explicit error, never a silent success.
{
  const ctx = loadContentScript({ dpr: 2, elementFromPoint: () => null });
  const { response } = ctx.send({ type: "EXECUTE_CLICK", x: 10, y: 10 });
  check("no element in either frame returns an error", response && typeof response.error === "string", JSON.stringify(response));
  check("error names both coordinate spaces", response && /image or CSS pixel space/.test(response.error));
}

// 8. Both frames probed before giving up on a HiDPI display.
{
  const ctx = loadContentScript({ dpr: 2, elementFromPoint: () => null });
  ctx.send({ type: "EXECUTE_CLICK", x: 100, y: 100 });
  check("dpr!=1 probes both frames", ctx.calls.elementFromPoint.length === 2, `probes=${ctx.calls.elementFromPoint.length}`);
}
{
  const ctx = loadContentScript({ dpr: 1, elementFromPoint: () => null });
  ctx.send({ type: "EXECUTE_CLICK", x: 100, y: 100 });
  check("dpr=1 probes once (no redundant work)", ctx.calls.elementFromPoint.length === 1, `probes=${ctx.calls.elementFromPoint.length}`);
}

console.log("\nEXECUTE_TYPE — form fill actually lands on the element\n");

// 9. Text input: native setter + input/change events (React/Vue compatible).
{
  const input = el("INPUT", { id: "full-name" });
  const ctx = loadContentScript({ dpr: 1, querySelector: () => input });
  const { response } = ctx.send({ type: "EXECUTE_TYPE", selector: "#full-name", value: "Ananya Sharma" });
  check("typed value reaches the element", input.value === "Ananya Sharma", JSON.stringify(input.value));
  check("uses the native value setter", input.nativeSetterCalls >= 1);
  check("dispatches input then change", input.events.map((e) => e.type).join(",") === "input,change", input.events.map((e) => e.type).join(","));
  check("input event is an InputEvent with inputType", input.events[0].inputType === "insertText");
  check("focuses the field", input.focuses === 1);
  check("scrolls the field into view so the fill is visible", input.scrollIntoViewCalls === 1);
  check("reports ok with typed length", response && response.ok === true && response.typed === "Ananya Sharma".length, JSON.stringify(response));
}

// 10. Missing element -> error, not a silent no-op.
{
  const ctx = loadContentScript({ dpr: 1, querySelector: () => null });
  const { response } = ctx.send({ type: "EXECUTE_TYPE", selector: "#nope", value: "x" });
  check("missing selector returns an error", response && /Element not found/.test(response.error || ""), JSON.stringify(response));
}

// 11. <select> — real registration forms use dropdowns.
{
  const select = el("SELECT", { id: "state" });
  select.options = [
    { value: "", text: "Choose…" },
    { value: "KA", text: "Karnataka" },
  ];
  const ctx = loadContentScript({ dpr: 1, querySelector: () => select });
  const { response } = ctx.send({ type: "EXECUTE_TYPE", selector: "#state", value: "Karnataka" });
  check("select matches an option by visible text", select.value === "KA", JSON.stringify(select.value));
  check("select dispatches input then change", select.events.map((e) => e.type).join(",") === "input,change");
  check("select reports ok", response && response.ok === true, JSON.stringify(response));
}
{
  const select = el("SELECT", { id: "state" });
  select.options = [{ value: "KA", text: "Karnataka" }];
  const ctx = loadContentScript({ dpr: 1, querySelector: () => select });
  const { response } = ctx.send({ type: "EXECUTE_TYPE", selector: "#state", value: "Atlantis" });
  check("select with no matching option errors", response && /No <option>/.test(response.error || ""), JSON.stringify(response));
}

// 12. contenteditable
{
  const div = el("DIV", { id: "bio", isContentEditable: true });
  const ctx = loadContentScript({ dpr: 1, querySelector: () => div });
  const { response } = ctx.send({ type: "EXECUTE_TYPE", selector: "#bio", value: "hello" });
  check("contenteditable receives text", div.textContent === "hello", JSON.stringify(div.textContent));
  check("contenteditable reports ok", response && response.ok === true, JSON.stringify(response));
}

console.log("\nEXECUTE_SCROLL\n");

// 13. Scroll direction maps to a signed delta.
{
  const ctx = loadContentScript({ dpr: 1 });
  const { response } = ctx.send({ type: "EXECUTE_SCROLL", direction: "down" });
  check("scroll down is a positive delta", ctx.calls.scrollBy[0].top > 0, JSON.stringify(ctx.calls.scrollBy[0]));
  check("scroll down reports ok", response && response.ok === true);
}
{
  const ctx = loadContentScript({ dpr: 1 });
  ctx.send({ type: "EXECUTE_SCROLL", direction: "up" });
  check("scroll up is a negative delta", ctx.calls.scrollBy[0].top < 0, JSON.stringify(ctx.calls.scrollBy[0]));
}

console.log("\nMessage contract with background.js\n");

// 14. All three executors must answer synchronously. background.js's
//     sendTabMessage() awaits chrome.tabs.sendMessage, which resolves with
//     whatever sendResponse got; returning true without responding would hang.
{
  const button = el("BUTTON", { id: "b" });
  const input = el("INPUT", { id: "i" });
  const ctx = loadContentScript({ dpr: 1, elementFromPoint: () => button, querySelector: () => input });
  for (const [label, msg] of [
    ["EXECUTE_CLICK", { type: "EXECUTE_CLICK", x: 1, y: 1 }],
    ["EXECUTE_TYPE", { type: "EXECUTE_TYPE", selector: "#i", value: "v" }],
    ["EXECUTE_SCROLL", { type: "EXECUTE_SCROLL", direction: "down" }],
  ]) {
    const { captured, returned } = ctx.send(msg);
    check(`${label} responds synchronously`, captured === true && returned === false, `captured=${captured} returned=${returned}`);
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail === 0) {
  console.log("The Hand: click/type/scroll execute against the real content.js message contract,");
  console.log("with click coordinates correctly translated from the VLM's image pixel space.");
}
process.exit(fail === 0 ? 0 : 1);
