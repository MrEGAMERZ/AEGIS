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

  const { extractLabeledFieldsFromText, mergeProfileFieldMaps, resolveProfileKeyFromLabel } = mod;

  const fixture = `Full Name: Mohammad Rehan
Email: mohammadrehan432432@gmail.com
Phone: 8008667486
Date of Birth: 2006-03-22
Father's Name: Imran Ahmed
Mother's Name: Sameera Begum
Blood Group: B+
Job Title: GenAI Developer Intern
Organization: Lensara Technology
College: Presidency University
Year of Study: 2
GitHub: https://github.com/MrEGAMERZ
Project description: Built AEGIS on-device redaction.
Aadhaar: 2345 6789 0123
`;
  const rich = extractProfileFromText(fixture);
  check("rich pack extracts fullName", rich.fullName === "Mohammad Rehan");
  check("rich pack extracts fatherName", rich.fatherName === "Imran Ahmed");
  check("rich pack extracts motherName", rich.motherName === "Sameera Begum");
  check("rich pack extracts bloodGroup", rich.bloodGroup === "B+");
  check("rich pack extracts jobTitle", /GenAI/i.test(rich.jobTitle || ""));
  check("rich pack extracts organization", rich.organization === "Lensara Technology");
  check("rich pack extracts yearOfStudy", rich.yearOfStudy === "2");
  check("rich pack extracts many fields (≥12)", Object.keys(rich).length >= 12, JSON.stringify(Object.keys(rich)));
  check("rich pack drops Aadhaar", !Object.values(rich).some((v) => /2345/.test(String(v))));

  const labeled = extractLabeledFieldsFromText("**Website:** https://rehandev.live\nSkills: Python, JS");
  check("markdown bold label → website", labeled.website === "https://rehandev.live");
  check("Skills line kept", labeled.skills === "Python, JS");

  check("resolve Father's Name → fatherName", resolveProfileKeyFromLabel("Father's Name") === "fatherName");
  check("resolve PIN Code → pincode", resolveProfileKeyFromLabel("PIN Code") === "pincode");

  const merged = mergeProfileFieldMaps(
    { fullName: "FromRegex", email: "a@b.com", bloodGroup: "B+" },
    { fullName: "FromAI", skills: "Python" }
  );
  check("merge: AI overrides same key", merged["Full Name"] === "FromAI");
  check("merge: regex-only key kept", merged["Blood Group"] === "B+");
  check("merge: AI-only key kept", merged.Skills === "Python");
  check("merge: shared email kept", merged.Email === "a@b.com");

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

  const hindiDev = extractProfileFromText("मेरा नाम राहुल शर्मा है ईमेल rahul@example.com फोन 9876543210");
  check("Hindi Devanagari extracts name", hindiDev.fullName && /राहुल/.test(hindiDev.fullName), hindiDev.fullName);
  check("Hindi speech still extracts email", hindiDev.email === "rahul@example.com");
  check("Hindi speech still extracts phone", hindiDev.phone === "9876543210");
  const hinglish = extractProfileFromText("mera naam Priya Sharma email priya@test.com");
  check("Hinglish mera naam extracts name", hinglish.fullName && /Priya/.test(hinglish.fullName), hinglish.fullName);

  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
