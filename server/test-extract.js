const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const start = src.indexOf("const VALID_ACTIONS");
const end = src.indexOf("// ── Upstream call");
const code = src.slice(start, end);
const extractAction = new Function(code + "\nreturn extractAction;")();

const cases = [
  ['{"action":"click","x":10,"y":20}', "click"],
  ['Here is the action:\n```json\n{"action":"scroll","direction":"down"}\n```', "scroll"],
  ['I will click the button. {"action":"click","x":350,"y":310} thanks', "click"],
  ['{"action":"type","selector":"#email","value":"user@example.com"}', "type"],
  ['{"action":"type","selector":"#email","value":"user@example.com","profileKey":"Email"}', "type"],
  ['{"action":"done","summary":"Form submitted"}', "done"],
  ['Result: {"action":"navigate","url":"https://example.com/dashboard"}', "navigate"],
  ["no json here", null],
  ['{"action":"hack","x":1}', null],
  ['{"action":"click"}', null],
  ['{"action":"click","x":"350","y":310}', null],
];

let pass = 0;
for (const [input, expected] of cases) {
  const got = extractAction(input);
  const ok =
    (expected === null && got === null) ||
    (expected !== null && got && got.action === expected);
  console.log(ok ? "PASS" : "FAIL", JSON.stringify(input.slice(0, 45)), "->", JSON.stringify(got));
  if (ok) pass++;
}

const withKey = extractAction(
  '{"action":"type","selector":"#email","value":"user@example.com","profileKey":"Email"}'
);
const keyOk = withKey && withKey.profileKey === "Email";
console.log(keyOk ? "PASS" : "FAIL", "profileKey passthrough", JSON.stringify(withKey));
if (keyOk) pass++;
const total = cases.length + 1;

console.log(`${pass}/${total} passed`);
process.exit(pass === total ? 0 : 1);
