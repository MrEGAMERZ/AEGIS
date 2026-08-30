/**
 * Aegis — Regression test for the "type" action anti-hallucination guard
 * eval/harness/sanitize-action.test.js
 *
 * BACKGROUND
 * ----------
 * eval-engineer measured (engineers/evaluation/work_done.md, "2026-08-28 —
 * Re-verification of Task 2.5 gate", Finding #2) that the live VLM
 * (qwen2.5vl:7b), despite an explicit "MUST NOT guess/invent" system-prompt
 * instruction, hallucinated a plausible-looking value in 2 of 3 live cases
 * where the requested form field had no real match in the user's saved
 * profile — e.g. inventing "Alice" or reusing "Software Engineer" (a REAL
 * profile value, but for the wrong field) instead of refusing.
 *
 * FIX: `sanitizeAction()` in src/background/background.js now treats every
 * "type" action's value as untrusted until independently verified against
 * the actual normalized profile — see the "Anti-Hallucination Guard" comment
 * directly above `sanitizeAction()` in that file for the full rationale.
 * This is the deterministic, code-level safety net (not a prompt tweak):
 * whatever the model outputs, an unverifiable "type" action is rejected the
 * same way any other malformed/untrusted action is rejected, and never
 * reaches the browser.
 *
 * UNLIKE eval/harness/normalize-profile.test.js (which embeds a manually
 * copied algorithm and warns about drift risk), this file loads the ACTUAL
 * `src/background/background.js` into a sandboxed Node VM (with a minimal
 * `chrome.*` stub so the file's top-level `chrome.runtime.onMessage
 * .addListener(...)` call doesn't throw) and tests the REAL, currently
 * shipped `sanitizeAction`/`parseAction` functions directly. There is no
 * copy to drift out of sync.
 *
 * USAGE
 * -----
 *   node eval/harness/sanitize-action.test.js
 *
 * DEPENDENCIES: none (pure Node core modules only — fs, path, vm).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC_PATH = path.join(__dirname, "..", "..", "src", "background", "background.js");
const source = fs.readFileSync(SRC_PATH, "utf8");

const sandbox = {
  chrome: {
    runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
    },
    storage: { local: { set: async () => {} } },
  },
  console,
};
vm.createContext(sandbox);
vm.runInContext(
  source + "\n;globalThis.__EXPORTS__ = { sanitizeAction, parseAction, normalizeProfile, classifyError };",
  sandbox,
  { filename: SRC_PATH }
);
const { sanitizeAction, parseAction, normalizeProfile, classifyError } = sandbox.__EXPORTS__;

const PAGE_FIELDS = [
  { type: "text_input", label: "Full Name", selector: "#name_input" },
  { type: "text_input", label: "Job Title", selector: "#title_input" },
];

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

console.log("Regression tests for sanitizeAction() anti-hallucination guard\n");

// ── 1. The exact incident from eval-engineer's live-model finding ──────────

// FIXED-2 equivalent: profile empty, model invents a value anyway.
{
  const action = { action: "type", selector: "#name_input", value: "Alice", profileKey: "Name" };
  const result = sanitizeAction(action, { userProfile: {}, fields: PAGE_FIELDS });
  check("empty profile + invented value -> REJECTED", result === null);
}

// FIXED-3 equivalent: profile has an UNRELATED real field; model reuses that
// real value/key for the WRONG field (the subtle case a naive "does this
// value exist anywhere in the profile" check would miss).
{
  const profile = normalizeProfile({ "Job Title": "Software Engineer" });
  const action = {
    action: "type",
    selector: "#name_input", // asking to fill "Full Name" field
    value: "Software Engineer",
    profileKey: "Job Title", // real key, but wrong field
  };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check(
    "real profile value attached to WRONG field -> REJECTED",
    result === null,
    JSON.stringify(result)
  );
}

// Model invents a profileKey that doesn't exist at all.
{
  const profile = normalizeProfile({ "Job Title": "Software Engineer" });
  const action = { action: "type", selector: "#name_input", value: "Alice", profileKey: "Full Name" };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check("profileKey not present in profile -> REJECTED", result === null);
}

// Model cites a real key but changes the value slightly (still hallucination).
{
  const profile = normalizeProfile({ "Full Name": "Alice Smith" });
  const action = { action: "type", selector: "#name_input", value: "Alice Jones", profileKey: "Full Name" };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check("real key but altered/wrong value -> REJECTED", result === null);
}

// No profileKey at all (old pre-fix action shape) -> fail closed, rejected.
{
  const profile = normalizeProfile({ "Full Name": "Alice Smith" });
  const action = { action: "type", selector: "#name_input", value: "Alice Smith" };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check("missing profileKey entirely -> REJECTED (fail closed)", result === null);
}

// No profile context object passed at all -> fail closed, rejected (never
// silently trust a "type" action with no way to verify it).
{
  const action = { action: "type", selector: "#name_input", value: "Alice Smith", profileKey: "Full Name" };
  const result = sanitizeAction(action);
  check("no context passed at all -> REJECTED (fail closed)", result === null);
}

// ── 2. Legitimate fills must still work (no regression on the happy path) ──

{
  const profile = normalizeProfile({ "Full Name": "Alice Smith" });
  const action = {
    action: "type",
    selector: "#name_input",
    value: "Alice Smith",
    profileKey: "Full Name",
  };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check(
    "genuine profile match, correct field -> ALLOWED",
    result && result.action === "type" && result.value === "Alice Smith" && result.profileKey === "Full Name",
    JSON.stringify(result)
  );
}

// Case-insensitive / whitespace-tolerant value matching (model reformats
// casing/whitespace slightly but the underlying value is genuinely correct).
{
  const profile = normalizeProfile({ "Full Name": "Alice Smith" });
  const action = {
    action: "type",
    selector: "#name_input",
    value: "  ALICE SMITH  ",
    profileKey: "Full Name",
  };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check("case/whitespace-insensitive genuine match -> ALLOWED", result !== null, JSON.stringify(result));
}

// Field-label correlation should tolerate reasonable key/label phrasing
// differences (e.g. profile key "Name" vs field label "Full Name").
{
  const profile = normalizeProfile({ Name: "Alice Smith" });
  const action = { action: "type", selector: "#name_input", value: "Alice Smith", profileKey: "Name" };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check(
    "loosely-matching key/label phrasing -> ALLOWED",
    result !== null,
    JSON.stringify(result)
  );
}

// When the selector isn't in the known fields list at all (can't verify
// field correlation), the value/profileKey check alone must still hold.
{
  const profile = normalizeProfile({ "Full Name": "Alice Smith" });
  const action = { action: "type", selector: "#unknown_field", value: "Alice Smith", profileKey: "Full Name" };
  const result = sanitizeAction(action, { userProfile: profile, fields: PAGE_FIELDS });
  check("unknown selector, but verified key+value -> ALLOWED", result !== null, JSON.stringify(result));
}

// ── 3. No regression on non-"type" actions or pre-existing shape checks ────

{
  const result = sanitizeAction({ action: "done", summary: "All set." });
  check("done action unaffected by the guard", result && result.action === "done" && result.summary === "All set.");
}

{
  const result = sanitizeAction({ action: "click", x: 10, y: 20 });
  check("click action unaffected by the guard", result && result.action === "click" && result.x === 10);
}

{
  const profile = normalizeProfile({ "Full Name": "Alice Smith" });
  const result = sanitizeAction(
    { action: "type", selector: "#name_input; DROP TABLE", value: "Alice Smith", profileKey: "Full Name" },
    { userProfile: profile, fields: PAGE_FIELDS }
  );
  check("unsafe selector charset still rejected (pre-existing check)", result === null);
}

// ── 4. parseAction() vs. real small-VLM output shapes ─────────────────────
//
// Incident (2026-08-28): a live Run Agent on tp08 surfaced
// "[UNKNOWN] Unexpected token 'S'" — a bare JSON.parse SyntaxError from a
// reply that began with prose ("Sure, ..."). parseAction must dig the action
// out of prose / markdown fences / trailing commentary, and must NEVER let a
// SyntaxError escape. sanitizeAction's guarantees below are unchanged: a
// recovered object still has to survive the anti-hallucination guard.

const GOOD_CTX = {
  userProfile: normalizeProfile({ "Full Name": "Alice Smith" }),
  fields: PAGE_FIELDS,
};

const PROSE_SHAPES = [
  ["bare object", '{"action":"click","x":150,"y":300}'],
  ["leading prose", 'Sure, I can help with that. {"action":"click","x":150,"y":300}'],
  ["json code fence", '```json\n{"action":"click","x":150,"y":300}\n```'],
  ["bare code fence", '```\n{"action":"click","x":150,"y":300}\n```'],
  ["fence plus commentary", 'Here is the action:\n```json\n{"action":"click","x":150,"y":300}\n```\nLet me know if you need more.'],
  ["trailing commentary", '{"action":"click","x":150,"y":300} This clicks the login button.'],
  ["prose both sides", 'Okay! {"action":"click","x":150,"y":300} Hope that helps.'],
  ["leading newline + prose", '\n\nSure thing.\n{"action":"click","x":150,"y":300}'],
];

for (const [label, raw] of PROSE_SHAPES) {
  const result = parseAction(raw, GOOD_CTX);
  check(
    `parseAction recovers a click from: ${label}`,
    result && result.action === "click" && result.x === 150 && result.y === 300,
    JSON.stringify(result)
  );
}

// Nested braces inside a string value must not terminate the object early.
{
  const raw = 'Sure! {"action":"done","summary":"Form has a {placeholder} in it"} done.';
  const result = parseAction(raw, GOOD_CTX);
  check(
    "parseAction handles braces inside a string value",
    result && result.action === "done" && result.summary === "Form has a {placeholder} in it",
    JSON.stringify(result)
  );
}

// Smart/curly quotes are a common small-model artifact and are not valid JSON.
{
  const raw = '{\u201caction\u201d:\u201cscroll\u201d,\u201cdirection\u201d:\u201cdown\u201d}';
  const result = parseAction(raw, GOOD_CTX);
  check("parseAction straightens curly quotes", result && result.action === "scroll" && result.direction === "down", JSON.stringify(result));
}

// A "Summarize this page" answer must survive as a done action (Problem 3).
{
  const raw = '```json\n{"action":"done","summary":"A scholarship application form."}\n```';
  const result = parseAction(raw, GOOD_CTX);
  check("parseAction recovers a summarize answer", result && result.action === "done" && /scholarship/.test(result.summary), JSON.stringify(result));
}

// Pure prose with no JSON at all -> null, never a thrown SyntaxError.
for (const [label, raw] of [
  ["pure prose", "Sure, I can help you fill out this form!"],
  ["empty string", ""],
  ["whitespace only", "   \n  "],
  ["null", null],
  ["undefined", undefined],
  ["non-string object", { action: "click", x: 1, y: 2 }],
  ["unclosed brace", 'Sure {"action":"click","x":1'],
]) {
  let threw = false;
  let result;
  try {
    result = parseAction(raw, GOOD_CTX);
  } catch {
    threw = true;
  }
  check(`parseAction returns null without throwing for: ${label}`, !threw && result === null, `threw=${threw} result=${JSON.stringify(result)}`);
}

// The guard still applies to anything recovered from prose — a hallucinated
// "type" wrapped in friendly prose must still be rejected.
{
  const raw = 'Sure! ```json\n{"action":"type","selector":"#name_input","value":"Bob Jones","profileKey":"Full Name"}\n```';
  const result = parseAction(raw, GOOD_CTX);
  check("prose-wrapped hallucinated type is STILL rejected", result === null, JSON.stringify(result));
}
{
  const raw = 'Sure! ```json\n{"action":"type","selector":"#name_input","value":"Alice Smith","profileKey":"Full Name"}\n```';
  const result = parseAction(raw, GOOD_CTX);
  check("prose-wrapped legitimate type is still allowed", result && result.action === "type" && result.value === "Alice Smith", JSON.stringify(result));
}

// classifyError must never return UNKNOWN for a JSON SyntaxError again.
{
  const syntaxErr = (() => { try { JSON.parse("Sure, I can help"); } catch (e) { return e; } })();
  check(
    "classifyError maps a raw JSON SyntaxError to BAD_JSON (not UNKNOWN)",
    classifyError(syntaxErr) === "BAD_JSON",
    `${syntaxErr.message} -> ${classifyError(syntaxErr)}`
  );
  check(
    "classifyError maps VLM_BAD_RESPONSE explicitly",
    classifyError({ message: 'VLM_BAD_RESPONSE: server did not return JSON. It sent: "Sure"' }) === "VLM_BAD_RESPONSE"
  );
}

console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
if (fail > 0) {
  console.log("sanitizeAction() anti-hallucination guard has a REGRESSION.");
  process.exit(1);
}
console.log("sanitizeAction() anti-hallucination guard is CORRECT for all tested cases — tested against the REAL src/background/background.js, not a copy.");
