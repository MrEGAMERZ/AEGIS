// Shared speech / document → profile fields.
// Never persist Aadhaar, PAN, CVV, passport, UPI, or bank numbers.

export const PROFILE_KEYS = [
  "fullName", "firstName", "lastName", "email", "phone", "dob", "gender",
  "addressLine1", "addressLine2", "city", "state", "pincode", "country",
  "nationality", "college", "university", "rollNumber", "course", "branch",
  "yearOfStudy", "guardianName", "fatherName", "motherName", "emergencyContact",
  "bloodGroup", "occupation", "jobTitle", "organization", "annualIncome",
  "skills", "languages", "website", "github", "projectDescription", "cgpa",
  "semester", "department",
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
  university: "University",
  rollNumber: "Roll Number",
  course: "Course",
  branch: "Branch",
  yearOfStudy: "Year of Study",
  guardianName: "Guardian Name",
  fatherName: "Father's Name",
  motherName: "Mother's Name",
  emergencyContact: "Emergency Contact",
  bloodGroup: "Blood Group",
  occupation: "Occupation",
  jobTitle: "Job Title",
  organization: "Organization",
  annualIncome: "Annual Income",
  skills: "Skills",
  languages: "Languages",
  website: "Website",
  github: "GitHub",
  projectDescription: "Project Description",
  cgpa: "CGPA",
  semester: "Semester",
  department: "Department",
};

const NEVER_STORE_KEY = /aadhaar|uidai|pan\b|cvv|cvc|passport|upi|ssn|bank.?account|credit.?card|debit.?card|licen[cs]e|driving|dl\b|voter|elector|account.?no|account.?number|card.?number|ifsc|iban|swift/i;
const AADHAAR_RE = /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/;
const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;

const DL_RE = /[A-Z]{2}[- ]?\d{13}|[A-Z]{2}[- ]?\d{2}[- ]?\d{11}/;
const UPI_RE = /[\w.\-]{2,}@[a-z]{2,}(?![.\w])/;
const PASSPORT_RE = /\b[A-Z][1-9]\d{6,7}\b/;
const BANK_ACCOUNT_RE = /\b(?!([6-9]\d{9})\b)\d{9,18}\b/;

// Labels that are section headers / noise, not field names.
const SKIP_LABELS = /^(contact|education|address|family|project|projects|resume|demo|how this maps|suggested|use|fields marked|identity|section)$/i;

const LABEL_ALIASES = {
  name: "fullName",
  fullname: "fullName",
  fathersname: "fatherName",
  fathername: "fatherName",
  mothersname: "motherName",
  mothername: "motherName",
  dateofbirth: "dob",
  birthdate: "dob",
  pincode: "pincode",
  pin: "pincode",
  zip: "pincode",
  zipcode: "pincode",
  mobilenumber: "phone",
  mobile: "phone",
  phonenumber: "phone",
  tel: "phone",
  address: "addressLine1",
  streetaddress: "addressLine1",
  addressline1: "addressLine1",
  addressline2: "addressLine2",
  institution: "college",
  year: "yearOfStudy",
  yearofstudy: "yearOfStudy",
  job: "jobTitle",
  title: "jobTitle",
  company: "organization",
  org: "organization",
  employer: "organization",
  income: "annualIncome",
  salary: "annualIncome",
  project: "projectDescription",
  projectdescription: "projectDescription",
  gpa: "cgpa",
  blood: "bloodGroup",
  bloodgroup: "bloodGroup",
  emergency: "emergencyContact",
  emergencycontact: "emergencyContact",
  guardian: "guardianName",
  language: "languages",
  mothertongue: "languages",
};

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

function normalizeLabelToken(label) {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function cleanLabel(raw) {
  return String(raw || "")
    .replace(/[*_#`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanValue(raw) {
  return String(raw || "")
    .replace(/^\*+|\*+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a document label to a PROFILE_KEYS entry, or null if unknown. */
export function resolveProfileKeyFromLabel(label) {
  const cleaned = cleanLabel(label);
  if (!cleaned || SKIP_LABELS.test(cleaned)) return null;
  const token = normalizeLabelToken(cleaned);
  if (!token || NEVER_STORE_KEY.test(cleaned)) return null;
  if (LABEL_ALIASES[token]) return LABEL_ALIASES[token];
  for (const k of PROFILE_KEYS) {
    const a = normalizeLabelToken(k);
    const b = normalizeLabelToken(labelFor(k));
    if (token === a || token === b) return k;
  }
  for (const k of PROFILE_KEYS) {
    const a = normalizeLabelToken(k);
    const b = normalizeLabelToken(labelFor(k));
    if (token.length >= 4 && (a.includes(token) || token.includes(a) || b.includes(token) || token.includes(b))) {
      return k;
    }
  }
  return null;
}

/**
 * Pull every safe Label: value / Label — value line from document text.
 * Known labels map to PROFILE_KEYS; others keep a readable Title Case key
 * so the profile table can show them.
 */
export function extractLabeledFieldsFromText(text) {
  const extracted = {};
  if (!text || typeof text !== "string") return extracted;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 600) continue;
    // Skip markdown table / heading-only lines.
    if (/^\|/.test(line) || /^#{1,6}\s/.test(line) || /^---+$/.test(line)) continue;

    // Strip markdown emphasis so "**Website:** https://…" becomes "Website: …".
    const normalized = line.replace(/\*{1,2}/g, "").replace(/_{1,2}/g, "").trim();
    const m = normalized.match(
      /^([A-Za-z][A-Za-z0-9 .'/()&-]{0,48}?)\s*[:=\-–—]\s+(.+)$/
    );
    if (!m) continue;

    const label = cleanLabel(m[1]);
    const val = cleanValue(m[2]);
    if (!label || !val || val.length > 2000) continue;
    if (SKIP_LABELS.test(label) || NEVER_STORE_KEY.test(label) || isNeverStoreValue(val)) continue;
    // Skip URLs used as labels / obvious noise.
    if (/^https?:\/\//i.test(label)) continue;
    if (/^(use|suggested|fields marked|identity numbers)/i.test(label)) continue;

    const known = resolveProfileKeyFromLabel(label);
    if (known) {
      if (!extracted[known]) extracted[known] = val;
    } else if (!extracted[label]) {
      extracted[label] = val;
    }
  }
  return extracted;
}

function firstCapture(text, re) {
  const m = String(text || "").match(re);
  return m && m[1] ? m[1].trim() : "";
}

function applySpokenIndicCues(extracted, text) {
  if (!extracted.fullName) {
    const name =
      firstCapture(text, /मेरा\s*नाम[\s:]*([\u0900-\u097F A-Za-z]{2,40})/) ||
      firstCapture(text, /(?:mera\s+naam|meraa\s+naam)[\s:]*([A-Za-z\s]{3,35})/i);
    const cleaned = name.replace(/hai|है|and|email|phone|city|शहर/gi, "").trim();
    if (cleaned.length >= 2) extracted.fullName = cleaned;
  }
  if (!extracted.city) {
    const city =
      firstCapture(text, /शहर[\s:]*([\u0900-\u097F A-Za-z]{2,24})/) ||
      firstCapture(text, /(?:rehta\s*hoon|rahta\s*hun|I\s+live\s+in)[\s:]*([A-Za-z\s]{3,24})/i);
    if (city) extracted.city = city.replace(/hai|है|in|is/gi, "").trim();
  }
  if (!extracted.email) {
    const hiEmail = firstCapture(text, /(?:ईमेल|इमेल)\s*(?:है|:)?\s*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    if (hiEmail) extracted.email = hiEmail;
  }
}

export function extractProfileFromText(text) {
  const extracted = {};
  if (!text || typeof text !== "string") return extracted;

  try {
    const json = JSON.parse(text);
    if (json && typeof json === "object" && !Array.isArray(json)) {
      for (const [rawKey, rawVal] of Object.entries(json)) {
        if (rawVal == null) continue;
        const val = String(rawVal).trim();
        if (!val || NEVER_STORE_KEY.test(rawKey) || isNeverStoreValue(val)) continue;
        const known = resolveProfileKeyFromLabel(rawKey) ||
          (PROFILE_KEYS.includes(rawKey) ? rawKey : null);
        if (known) extracted[known] = val;
        else if (KEY_LABELS[rawKey]) extracted[rawKey] = val;
        else extracted[cleanLabel(rawKey) || rawKey] = val;
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

  // Spoken Hindi / Hinglish. Chrome hi-IN often returns Devanagari, not Latin.
  applySpokenIndicCues(extracted, text);

  // Generic Label: value lines — the main path for rich PDFs / markdown packs.
  Object.assign(extracted, extractLabeledFieldsFromText(text));

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
    const display = KEY_LABELS[k] || k;
    const val = String(v).trim();
    if (!val) continue;
    out[display] = val;
  }
  return out;
}

/**
 * Merge two profile field maps. Later entries win on the same display key.
 * Used so on-device Label:value extract always runs, then local AI fills gaps
 * / overrides without wiping the rest.
 */
export function mergeProfileFieldMaps(...maps) {
  const out = {};
  for (const map of maps) {
    if (!map || typeof map !== "object") continue;
    Object.assign(out, toUserProfileFields(map));
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
