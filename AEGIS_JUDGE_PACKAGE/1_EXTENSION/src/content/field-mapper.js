// Field Mapper — classifies form fields into canonical profile keys.
// Plain script (content scripts cannot use ES modules). Exposes window.AegisFieldMapper.
//
// Classification outcomes:
//   { key: "<canonical>" }   mappable, fillable from the on-device profile
//   { key: "never_store" }   sensitive identifier (Aadhaar/PAN/etc) — NEVER saved
//                            to the profile, NEVER transmitted. Redacted only.
//   { key: null }            not mappable (agent/VLM decides what to do)

(() => {
  "use strict";

  // ── Canonical profile keys (stored on-device only) ────────────────

  const PROFILE_KEYS = [
    "fullName",
    "firstName",
    "lastName",
    "email",
    "phone",
    "dob",
    "gender",
    "addressLine1",
    "addressLine2",
    "city",
    "state",
    "pincode",
    "country",
    "nationality",
    "college",
    "rollNumber",
    "course",
    "branch",
    "guardianName",
    "occupation",
    "annualIncome",
  ];

  const KEY_LABELS = {
    fullName: "Full name",
    firstName: "First name",
    lastName: "Last name",
    email: "Email",
    phone: "Phone number",
    dob: "Date of birth",
    gender: "Gender",
    addressLine1: "Address line 1",
    addressLine2: "Address line 2",
    city: "City",
    state: "State",
    pincode: "PIN code",
    country: "Country",
    nationality: "Nationality",
    college: "College / institution",
    rollNumber: "Roll / enrollment number",
    course: "Course / program",
    branch: "Branch / department",
    guardianName: "Guardian / parent name",
    occupation: "Occupation",
    annualIncome: "Annual income",
  };

  // ── Never-store identifiers (Aadhaar Act compliance — see docs) ───

  const NEVER_STORE_PATTERNS = [
    /aadhaar|aadhar|uidai/i,
    /\bpan\b|pan[_-]?number|permanent\s*account/i,
    /passport/i,
    /licen[cs]e\s*(no|number|num)/i,
    /voter\s*(id|no|number)/i,
    /account\s*(no|number|num)/i,
    /\bcvv\b|\bcsc\b|card\s*(no|number|num)/i,
    /ifsc|swift\s*(code)?/i,
    /\bupi\s*(pin|id)\b/i,
    /\bssn\b|social\s*security/i,
    /tax\s*id|tin\b/i,
  ];

  // ── Autocomplete attribute → canonical key ────────────────────────

  const AUTOCOMPLETE_MAP = {
    name: "fullName",
    "given-name": "firstName",
    "family-name": "lastName",
    email: "email",
    tel: "phone",
    "tel-national": "phone",
    bday: "dob",
    "bday-day": null, // present but too granular to store usefully
    "bday-month": null,
    "bday-year": null,
    sex: "gender",
    "street-address": "addressLine1",
    "address-line1": "addressLine1",
    "address-line2": "addressLine2",
    "address-level2": "city",
    "address-level1": "state",
    "postal-code": "pincode",
    country: "country",
    "country-name": "country",
    organization: "college",
    "organization-title": "occupation",
  };

  // ── Keyword rules (matched against label/name/id/placeholder) ─────
  // Order matters: first match wins. Full-name rules must precede name-part rules.

  const KEYWORD_RULES = [
    { key: "fullName", patterns: [/full\s*name/i, /complete\s*name/i, /applicant\s*name/i, /candidate\s*name/i, /student\s*name/i, /^name$/i, /name\s*\(?\s*as\s*per/i] },
    { key: "firstName", patterns: [/first\s*name/i, /given\s*name/i] },
    { key: "lastName", patterns: [/last\s*name/i, /surname/i, /family\s*name/i] },
    { key: "guardianName", patterns: [/guardian/i, /father'?s?\s*name/i, /mother'?s?\s*name/i, /parent\s*name/i] },
    { key: "email", patterns: [/e-?mail/i] },
    { key: "phone", patterns: [/phone/i, /mobile/i, /contact\s*(no|number)/i, /whats?app/i, /\btel\b/i] },
    { key: "dob", patterns: [/date\s*of\s*birth/i, /\bd\.?o\.?b\.?\b/i, /birth\s*date/i] },
    { key: "gender", patterns: [/gender/i, /\bsex\b/i] },
    { key: "addressLine1", patterns: [/address\s*(line)?\s*1/i, /street\s*address/i, /^address$/i, /residential\s*address/i, /permanent\s*address/i, /correspondence\s*address/i] },
    { key: "addressLine2", patterns: [/address\s*(line)?\s*2/i] },
    { key: "pincode", patterns: [/pin\s*code/i, /\bpincode\b/i, /postal\s*code/i, /\bzip\b/i] },
    { key: "city", patterns: [/city/i, /town\b/i, /district/i] },
    { key: "state", patterns: [/state\b/i, /province/i] },
    { key: "country", patterns: [/country/i, /nationality/i] },
    { key: "nationality", patterns: [/nationality/i] },
    { key: "college", patterns: [/college/i, /institut/i, /universit/i, /school\s*name/i] },
    { key: "rollNumber", patterns: [/roll\s*(no|number)/i, /enrolment|enrollment\s*(no|number)?/i, /registration\s*(no|number)/i, /reg\s*no/i, /student\s*id/i] },
    { key: "course", patterns: [/course/i, /program(\s*name)?/i, /degree/i] },
    { key: "branch", patterns: [/branch/i, /department/i, /specialization|specialisation/i, /\bstream\b/i] },
    { key: "occupation", patterns: [/occupation/i, /profession/i, /designation/i, /job\s*title/i] },
    { key: "annualIncome", patterns: [/income/i, /salary/i] },
  ];

  // ── CSS selector builder (moved here so both mapper and consumers share it)

  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    if (el.className && typeof el.className === "string") {
      const cls = el.className.trim().split(/\s+/).map(CSS.escape).join(".");
      return `${el.tagName.toLowerCase()}.${cls}`;
    }
    const path = [];
    let current = el;
    while (current && current !== document.body) {
      let selector = current.tagName.toLowerCase();
      if (current.id) {
        selector = `#${CSS.escape(current.id)}`;
        path.unshift(selector);
        break;
      }
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const idx = siblings.indexOf(current) + 1;
          selector += `:nth-of-type(${idx})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

  // ── Classification ────────────────────────────────────────────────

  function fieldText(el, includePlaceholder = true) {
    return [
      el.labels
        ? Array.from(el.labels)
            .map((l) => l.textContent)
            .join(" ")
        : "",
      el.name,
      el.id,
      el.getAttribute("aria-label"),
      includePlaceholder ? el.placeholder : "",
      el.getAttribute("title"),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function classifyField(el) {
    // Worst-case net: the placeholder of a name field often reads
    // "As per Aadhaar / PAN" — an instruction, not the field's identity.
    // Never-store evidence must come from label/name/id/aria/title only.
    const idText = fieldText(el, false);
    const text = fieldText(el);

    // 1. Never-store identifiers win over everything (compliance rule)
    for (const pattern of NEVER_STORE_PATTERNS) {
      if (pattern.test(idText)) return { key: "never_store", reason: `identifier pattern: ${pattern}` };
    }

    // 2. Autocomplete attribute (most reliable signal)
    const ac = (el.autocomplete || "").toLowerCase();
    for (const [token, key] of Object.entries(AUTOCOMPLETE_MAP)) {
      if (ac === token || ac.split(/\s+/).includes(token)) {
        return { key, reason: `autocomplete="${token}"` };
      }
    }

    // 3. Keyword rules on label/name/id/placeholder
    for (const rule of KEYWORD_RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) {
          return { key: rule.key, reason: `keyword: ${pattern}` };
        }
      }
    }

    return { key: null, reason: null };
  }

  // ── Export ────────────────────────────────────────────────────────

  window.AegisFieldMapper = {
    classifyField,
    buildSelector,
    PROFILE_KEYS,
    KEY_LABELS,
    isNeverStoreKey: (key) => key === "never_store",
  };
})();
