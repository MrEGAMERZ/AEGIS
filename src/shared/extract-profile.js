// Shared speech / document → profile fields.
// Never persist Aadhaar, PAN, CVV, passport, UPI, or bank numbers.

export const PROFILE_KEYS = [
  "fullName", "firstName", "lastName", "email", "phone", "dob", "gender",
  "addressLine1", "addressLine2", "city", "state", "pincode", "country",
  "nationality", "college", "rollNumber", "course", "branch", "guardianName",
  "occupation", "annualIncome",
];

export const KEY_LABELS = {
  fullName: "Full Name",
  firstName: "First Name",
  lastName: "Last Name",
  email: "Email",
  phone: "Phone",
  dob: "Date of Birth",
  gender: "Gender",
  addressLine1: "Address",
  addressLine2: "Address Line 2",
  city: "City",
  state: "State",
  pincode: "PIN Code",
  country: "Country",
  nationality: "Nationality",
  college: "College",
  rollNumber: "Roll Number",
  course: "Course",
  branch: "Branch",
  guardianName: "Guardian Name",
  occupation: "Occupation",
  annualIncome: "Annual Income",
};

const NEVER_STORE_KEY = /aadhaar|uidai|pan\b|cvv|cvc|passport|upi|ssn|bank.?account|credit.?card|debit.?card|licen[cs]e|driving|dl\b|voter|elector|account.?no|account.?number|card.?number|ifsc|iban|swift/i;
const AADHAAR_RE = /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/;
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;

// ── D4: document-context value patterns (privacy audit 2026-09-06) ──
// Driving licence (IN), UPI handle, passport, bank-account-ish numbers.
// Applied inside the stripNeverStore value checks (defense-in-depth; the
// input-side doc strip mirrors the same patterns). Over-redaction is the
// correct bias: deterministic, high-precision, privacy fails closed.
//   • DL: "MH0220150012345" and the spaced state-code form "MH12 12345678901".
//   • UPI: handle@bare-domain — a NEGATIVE lookahead blocks `@example.com`
//     emails so speech/JSON email extraction keeps working.
//   • Passport: IN format is 1 letter + 7 digits ("L1234567"); also accept
//     the 8-digit shape the audit specified.
//   • Bank: any 9–18 digit run EXCEPT the exact 10-digit [6-9] mobile shape
//     (Indian phones stay extractable; banks are never 6-9-start 10-digit).
const DL_RE = /[A-Z]{2}[- ]?\d{13}|[A-Z]{2}[- ]?\d{2}[- ]?\d{11}/;
const UPI_RE = /[\w.\-]{2,}@[a-z]{2,}(?![.\w])/;
const PASSPORT_RE = /\b[A-Z][1-9]\d{6,7}\b/;
const BANK_ACCOUNT_RE = /\b(?!([6-9]\d{9})\b)\d{9,18}\b/;

export function labelFor(key) {
  return KEY_LABELS[key] || key;
}

function isNeverStoreValue(value) {
  const s = String(value || "");
  return (
    AADHAAR_RE.test(s) ||
    PAN_RE.test(s) ||
    DL_RE.test(s) ||
    UPI_RE.test(s) ||
    PASSPORT_RE.test(s) ||
    BANK_ACCOUNT_RE.test(s)
  );
}

export function extractProfileFromText(text) {
  const extracted = {};
  if (!text || typeof text !== "string") return extracted;

  try {
    const json = JSON.parse(text);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const key of PROFILE_KEYS) {
        if (json[key]) extracted[key] = String(json[key]).trim();
        else if (json[KEY_LABELS[key]]) extracted[key] = String(json[KEY_LABELS[key]]).trim();
      }
      if (Object.keys(extracted).length > 0) return stripNeverStore(extracted);
    }
  } catch {
    // not JSON
  }

  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) extracted.email = emailMatch[0];

  const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) extracted.phone = phoneMatch[0].replace(/\D/g, "").slice(-10);

  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth\s*Date)[\s:]*(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/i);
  if (dobMatch) extracted.dob = dobMatch[1];

  const nameMatch = text.match(/(?:Full\s*Name|Name|Mera\s*naam|My\s*name\s*is)[\s:]*([A-Za-z\s]{3,35})/i);
  if (nameMatch) {
    const rawName = nameMatch[1].replace(/hai|is|and|email|phone|city/gi, "").trim();
    if (rawName.length >= 3) extracted.fullName = rawName;
  }

  const cityMatch = text.match(/(?:City|Location|Rehta\s*hoon|Raho)[\s:]*([A-Za-z\s]{3,20})/i);
  if (cityMatch) {
    const rawCity = cityMatch[1].replace(/hai|in|is/gi, "").trim();
    if (rawCity) extracted.city = rawCity;
  }

  const stateMatch = text.match(/(?:State)[\s:]*([A-Za-z\s]{3,20})/i);
  if (stateMatch) extracted.state = stateMatch[1].trim();

  const pinMatch = text.match(/(?:PIN|Pincode|Zip)[\s:]*(\d{6})/i);
  if (pinMatch) extracted.pincode = pinMatch[1];

  const collegeMatch = text.match(/(?:College|University|Institution)[\s:]*([A-Za-z\s]{3,40})/i);
  if (collegeMatch) extracted.college = collegeMatch[1].trim();

  const incomeMatch = text.match(/(?:Income|Salary)[\s:]*(\d{5,10})/i);
  if (incomeMatch) extracted.annualIncome = incomeMatch[1];

  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(/[:=]/);
    if (parts.length < 2) continue;
    const kLabel = parts[0].trim().toLowerCase();
    const val = parts.slice(1).join(":").trim();
    if (!val || NEVER_STORE_KEY.test(kLabel)) continue;
    for (const k of PROFILE_KEYS) {
      if (kLabel === k.toLowerCase() || kLabel === labelFor(k).toLowerCase()) {
        extracted[k] = val;
      }
    }
  }

  return stripNeverStore(extracted);
}

function stripNeverStore(extracted) {
  const out = {};
  for (const [k, v] of Object.entries(extracted)) {
    if (NEVER_STORE_KEY.test(k) || isNeverStoreValue(v)) continue;
    if (v) out[k] = v;
  }
  return out;
}

export function toUserProfileFields(extracted) {
  const out = {};
  for (const [k, v] of Object.entries(extracted || {})) {
    if (NEVER_STORE_KEY.test(k) || isNeverStoreValue(v)) continue;
    out[KEY_LABELS[k] || k] = String(v).trim();
  }
  return out;
}

export async function mergeIntoUserProfile(extracted) {
  const fields = toUserProfileFields(extracted);
  const stored = await chrome.storage.local.get("userProfile");
  const raw = stored.userProfile;
  const base = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw } : {};
  Object.assign(base, fields);
  await chrome.storage.local.set({ userProfile: base });
  return fields;
}
