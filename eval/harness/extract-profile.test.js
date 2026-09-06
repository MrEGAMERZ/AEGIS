/**
 * extract-profile.test.js — speech/document parser + never-store
 */

const assert = require("assert");
const path = require("path");
const { pathToFileURL } = require("url");

async function main() {
  const mod = await import(pathToFileURL(path.join(__dirname, "..", "..", "src", "shared", "extract-profile.js")).href);
  const { extractProfileFromText, toUserProfileFields } = mod;

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

  const speech = extractProfileFromText("My name is Ananya Krishnan and email is ananya@example.com phone 9876543210");
  check("speech extracts name", speech.fullName && speech.fullName.includes("Ananya"));
  check("speech extracts email", speech.email === "ananya@example.com");
  check("speech extracts phone", speech.phone === "9876543210");

  const json = extractProfileFromText(JSON.stringify({ "Full Name": "Ravi", Email: "ravi@test.com" }));
  check("JSON Full Name → fullName", json.fullName === "Ravi");
  check("JSON Email → email", json.email === "ravi@test.com");

  const dirty = extractProfileFromText("Name: Safe Person\nAadhaar: 2345 6789 0123\nPAN: ABCDE1234F\nEmail: ok@x.com");
  check("keeps email", dirty.email === "ok@x.com");
  check("drops aadhaar key", !Object.keys(dirty).some((k) => /aadhaar/i.test(k)));
  check("drops PAN-shaped value", !Object.values(dirty).some((v) => /ABCDE1234F/.test(String(v))));

  const mapped = toUserProfileFields({ fullName: "Ananya", email: "a@b.com" });
  check("maps to Full Name", mapped["Full Name"] === "Ananya");
  check("maps to Email", mapped.Email === "a@b.com");

  // ── D4: licence / UPI / passport / bank-account never-store coverage ──
  // Acceptance fixture: "DL: MH12 12345678901", "upi://rahul@oksbi",
  // "Passport L1234567" → no stored field for those.
  const docDirty = extractProfileFromText(
    "Name: Rahul Verma\nDL: MH12 12345678901\nUPI: upi://rahul@oksbi\nPassport: L1234567\nAccount: 50100234567890\nEmail: rv@example.com"
  );
  check("D4: keeps name from doc text", docDirty.fullName && docDirty.fullName.includes("Rahul"));
  check("D4: keeps email from doc text", docDirty.email === "rv@example.com");
  check("D4: no DL-shaped value stored", !Object.values(docDirty).some((v) => /MH12\s?12345678901/.test(String(v))));
  check("D4: no UPI handle stored", !Object.values(docDirty).some((v) => /rahul@oksbi/.test(String(v))));
  check("D4: no passport value stored", !Object.values(docDirty).some((v) => /L1234567/.test(String(v))));
  check("D4: no bank account value stored", !Object.values(docDirty).some((v) => /50100234567890/.test(String(v))));

  // Audit's D4 verification: a benign KEY carrying a DL-shaped VALUE is still
  // redacted by the value regex (accept over-redaction in doc context).
  const dlJson = extractProfileFromText(JSON.stringify({ fullName: "MH02-20150012345", email: "x@y.com" }));
  check("D4: benign-key DL-shaped value dropped", !Object.values(dlJson).some((v) => /MH02-20150012345/.test(String(v))));
  check("D4: benign-key account value dropped", !Object.values(extractProfileFromText(JSON.stringify({ fullName: "50100234567890" }))).some((v) => /50100234567890/.test(String(v))));
  check("D4: email still survives JSON path", dlJson.email === "x@y.com");

  // Refinements must not over-redact legitimate, previously-extractable data:
  const phoneKept = extractProfileFromText("My phone is 9876543210");
  check("D4: 10-digit [6-9] phone still extracted (bank regex exclusion)", phoneKept.phone === "9876543210");
  const emailKept = extractProfileFromText("Contact ananya@example.com");
  check("D4: email still extracted (UPI regex excludes dotted TLD)", emailKept.email === "ananya@example.com");

  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
