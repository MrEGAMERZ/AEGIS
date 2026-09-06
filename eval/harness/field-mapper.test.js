/**
 * field-mapper.test.js — classifyField + never_store against real source
 *
 *   node eval/harness/field-mapper.test.js
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC_PATH = path.join(__dirname, "..", "..", "src", "content", "field-mapper.js");
const source = fs.readFileSync(SRC_PATH, "utf8");

function makeEl(props = {}) {
  return {
    tagName: "INPUT",
    type: "text",
    id: "",
    name: "",
    placeholder: "",
    autocomplete: "",
    labels: props.label ? [{ textContent: props.label }] : [],
    getAttribute(k) {
      if (k === "autocomplete") return this.autocomplete || "";
      if (k === "aria-label") return props.ariaLabel || "";
      return "";
    },
    ...props,
  };
}

const sandbox = {
  window: {},
  console,
  CSS: { escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&") },
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: SRC_PATH });
const { classifyField, buildSelector, isNeverStoreKey } = sandbox.window.AegisFieldMapper;

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

check("aadhaar id is never_store", classifyField(makeEl({ id: "aadhaar-number" })).key === "never_store");
check("pan name is never_store", classifyField(makeEl({ name: "pan_number" })).key === "never_store");
check("cvv is never_store", classifyField(makeEl({ id: "cvv" })).key === "never_store");
check("isNeverStoreKey true", isNeverStoreKey("never_store") === true);
check("isNeverStoreKey false for email", isNeverStoreKey("email") === false);

check("autocomplete email", classifyField(makeEl({ autocomplete: "email" })).key === "email");
check("autocomplete tel", classifyField(makeEl({ autocomplete: "tel" })).key === "phone");
check("label Email → email", classifyField(makeEl({ label: "Email" })).key === "email");
check("label Full Name → fullName", classifyField(makeEl({ label: "Full Name" })).key === "fullName");
check("unmapped field is null", classifyField(makeEl({ id: "notes" })).key === null);

const withId = makeEl({ id: "email" });
check("buildSelector prefers #id", buildSelector(withId) === "#email");

console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
process.exit(fail > 0 ? 1 : 0);
