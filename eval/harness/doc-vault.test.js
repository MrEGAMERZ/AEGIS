/**
 * Aegis — doc-vault + STRUCTURE_DOCUMENT_TEXT + RAG-lite fill guard
 * eval/harness/doc-vault.test.js
 *
 * PURPOSE
 * -------
 * Unit/regression coverage for the AI structuring + dynamic profile layer:
 *   1. STRUCTURE validation: dynamic keys (NOT the fixed 21) survive; injected
 *      Aadhaar/PAN are dropped at key AND value level; length caps + field cap
 *      + "non-empty string only" rules hold (acceptance criterion 1).
 *   2. Remote rejection: STRUCTURE_DOCUMENT_TEXT refuses (no VLM chat request)
 *      when the resolved endpoint is remote (acceptance criterion 2).
 *   3. Vault: store (with Aadhaar scrub), trim (10 docs / byte cap, oldest
 *      dropped), retrieveVaultSnippets keyword retrieval — "What university
 *      did she attend" returns the university sentence (criterion 3), and
 *      GET_DOC_VAULT returns names + char counts, never text.
 *   4. sanitizeAction provenance: a "type" value traceable to vault text is
 *      ALLOWED; an invented value is still REJECTED (fail closed, criterion 4).
 *
 * It loads the REAL src/background/doc-vault.js AND src/background/background.js
 * into one sandboxed Node VM (minimal chrome.* + fetch stubs) — no copies, no
 * drift. background.js parses fine because its doc-vault loading is a lazy
 * dynamic import inside a function (never executed here: doc-vault.js is
 * pre-loaded into the same sandbox, so getDocVault() short-circuits).
 *
 * USAGE: node eval/harness/doc-vault.test.js
 * DEPENDENCIES: none (fs, path, vm).
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..", "..");
const VAULT_PATH = path.join(ROOT, "src", "background", "doc-vault.js");
const BACKGROUND_PATH = path.join(ROOT, "src", "background", "background.js");

const vaultSrc = fs.readFileSync(VAULT_PATH, "utf8");
const backgroundSrc = fs.readFileSync(BACKGROUND_PATH, "utf8");

// ── In-memory chrome.storage mock (shared by both modules) ────────────────
const storageMap = {};
const SESSION_STORE = {};
const store = {
  async get(keys) {
    const out = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (k in storageMap) out[k] = storageMap[k];
    }
    return out;
  },
  async set(obj) {
    Object.assign(storageMap, obj);
  },
};
const sessionStore = {
  async get(keys) {
    const out = {};
    for (const k of Array.isArray(keys) ? keys : [keys]) {
      if (k in SESSION_STORE) out[k] = SESSION_STORE[k];
    }
    return out;
  },
  async set(obj) {
    Object.assign(SESSION_STORE, obj);
  },
};

// ── chrome.* stubs needed to drive handleCaptureAndSanitize end-to-end ────
const SANITIZE_OK = {
  sanitizedImage: "data:image/png;base64,iVBORw0KGgo=",
  facePassComplete: true,
  nerPassComplete: true,
  maskedRegions: [],
  backend: "wasm",
  dpr: 1,
};
const DOM_SCAN_OK = {
  fields: [
    { type: "text_input", label: "Full Name", selector: "#name_input" },
    { type: "text_input", label: "University", selector: "#uni_input" },
  ],
  dpr: 1,
  viewport: { width: 1280, height: 720 },
};
const tabsStub = {
  query: async () => [{ id: 7, url: "https://example.com/form" }],
  captureVisibleTab: async () => "data:image/png;base64,iVBORw0KGgo=",
  sendMessage: async (_tabId, message) => {
    if (message && message.type === "DOM_SCAN") return DOM_SCAN_OK;
    return { ok: true };
  },
};

// ── fetch stub: counts chat POSTs; returns structured-doc JSON for chat ───
// Vision (CAPTURE_AND_SANITIZE) payloads get a done action so parseAction
// succeeds; structure payloads get the structured-doc reply. Every chat body
// is captured for D9 payload assertions.
let chatCalls = 0;
let probeCalls = 0;
const capturedChatBodies = [];
const FETCH_CHAT_REPLY =
  '{"skills":"React, Node.js","university":"IIT Bombay","motherTongue":"Tamil","aadhaarNumber":"2345 6789 0123"}';
async function fetchStub(url, init) {
  const u = String(url || "");
  if (u.includes("/health")) {
    probeCalls++;
    return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
  }
  if (u.includes("/chat/completions")) {
    chatCalls++;
    let bodyObj = null;
    try {
      bodyObj = JSON.parse(String(init?.body || "{}"));
    } catch {
      bodyObj = null;
    }
    capturedChatBodies.push(bodyObj || {});
    const isVision = Array.isArray(bodyObj?.messages?.find?.((m) => Array.isArray(m.content))?.content);
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      text: async () =>
        JSON.stringify({
          choices: [
            {
              message: {
                content: isVision
                  ? '{"action":"done","summary":"ok"}'
                  : FETCH_CHAT_REPLY,
              },
            },
          ],
        }),
    };
  }
  return { ok: false, status: 404, statusText: "Not Found", text: async () => "" };
}

const sandbox = {
  URL, // isLocalVlmEndpoint() does new URL() — without this every endpoint
  // (even localhost:8000) looks "remote" and the fail-closed guard rejects.
  AbortSignal,
  setTimeout,
  chrome: {
    runtime: {
      getURL: () => "chrome-extension://fake-id/",
      onMessage: { addListener: () => {} },
      onInstalled: { addListener: () => {} },
      getContexts: async () => [{ contextType: "OFFSCREEN_DOCUMENT" }],
      sendMessage: async (message) => {
        if (message && message.type === "SANITIZE") return SANITIZE_OK;
        return { ok: true };
      },
    },
    tabs: tabsStub,
    storage: { local: store, session: sessionStore },
  },
  fetch: fetchStub,
  console,
};

vm.createContext(sandbox);
vm.runInContext(vaultSrc, sandbox, { filename: VAULT_PATH });
vm.runInContext(
  backgroundSrc +
    "\n;globalThis.__EXPORTS__ = { sanitizeAction, parseAction, normalizeProfile, isLocalVlmEndpoint, classifyError, handleStructureDocumentText, handleGetDocVault, handleCaptureAndSanitize, handleClearDocVault };",
  sandbox,
  { filename: BACKGROUND_PATH }
);

const V = sandbox.AegisDocVault;
const {
  sanitizeAction,
  parseAction,
  normalizeProfile,
  isLocalVlmEndpoint,
  classifyError,
  handleStructureDocumentText,
  handleGetDocVault,
  handleCaptureAndSanitize,
  handleClearDocVault,
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

async function expectReject(promise, assertFn) {
  try {
    const r = await promise;
    check("expected rejection, got a result", false, JSON.stringify(r));
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    assertFn(msg);
  }
}

const RESUME_TEXT = `Ananya Krishnan
Email: ananya@example.com
Phone: 9876543210

EDUCATION
University: IIT Bombay (Indian Institute of Technology), 2022-2026
B.Tech in Computer Science

SKILLS
React, Node.js, Python, TensorFlow

Languages: Tamil, English, Hindi`;

function memStore(seed) {
  const map = Object.assign({}, seed);
  return {
    map,
    get: async (keys) => {
      const out = {};
      for (const k of Array.isArray(keys) ? keys : [keys]) if (k in map) out[k] = map[k];
      return out;
    },
    set: async (obj) => Object.assign(map, obj),
  };
}

async function main() {
  console.log("doc-vault.test.js — AI structuring + dynamic profile + RAG-lite\n");

  // ── A. STRUCTURE validation (pure) ─────────────────────────────────
  console.log("A. Structured-document validation (criterion 1)");

  {
    const parsed = V.parseStructuredFields(
      'Here is the structured data:\n```json\n{"fullName":"Ananya Krishnan","email":"ananya@example.com","skills":"React, Node.js","university":"IIT Bombay","motherTongue":"Tamil"}\n```\nHope this helps!'
    );
    check("parseStructuredFields digs JSON out of prose + fence", parsed !== null, JSON.stringify(parsed));
    check("dynamic key 'skills' parsed", parsed && parsed.skills === "React, Node.js");
    check("dynamic key 'university' parsed", parsed && parsed.university === "IIT Bombay");
    check("dynamic key 'motherTongue' parsed", parsed && parsed.motherTongue === "Tamil");
  }

  {
    const parsed = {
      skills: "React, Node.js",
      university: "IIT Bombay",
      motherTongue: "Tamil",
      aadhaarNumber: "2345 6789 0123", // sensitive KEY → dropped
      idNumber: "2345 6789 9012", // Aadhaar-shaped VALUE (starts 2-9) → dropped
      panRef: "ABCDE1234F", // PAN-shaped value → dropped
      emptyValue: "   ",
      nonString: 42,
      ["x".repeat(41)]: "v", // KEY over 40 chars → dropped
      longValue: "y".repeat(501),
    };
    const { fields, dropped } = V.validateStructuredFields(parsed);
    check("dynamic keys survive validation", fields.skills === "React, Node.js" && fields.university === "IIT Bombay" && fields.motherTongue === "Tamil");
    check("never-store KEY dropped (aadhaarNumber)", !("aadhaarNumber" in fields));
    check("Aadhaar-shaped VALUE dropped (idNumber)", !("idNumber" in fields));
    check("PAN-shaped VALUE dropped (panRef)", !("panRef" in fields));
    check("empty value dropped", !("emptyValue" in fields));
    check("non-string value dropped (fail closed)", !("nonString" in fields));
    check("key over 40 chars dropped", !("longKey" in fields));
    check("value over 500 chars dropped", !("longValue" in fields));
    check("dropped count matches (7 non-kept)", dropped === 7, `dropped=${dropped}`);
  }

  {
    const many = {};
    for (let i = 0; i < 65; i++) many[`field${i}`] = `value${i}`;
    const { fields, dropped } = V.validateStructuredFields(many);
    check("field cap ≤ 60 enforced", Object.keys(fields).length === 60, `got ${Object.keys(fields).length}`);
    check("excess fields counted as dropped", dropped === 5, `dropped=${dropped}`);
  }

  {
    const r = V.validateStructuredFields(null);
    check("null parsed → empty fields, fail closed", r && Object.keys(r.fields).length === 0);
    const r2 = V.validateStructuredFields([1, 2]);
    check("array parsed → empty fields, fail closed", r2 && Object.keys(r2.fields).length === 0);
  }

  {
    // D4 — licence/UPI/passport/bank never-store on the STRUCTURED path.
    const parsed = {
      drivingLicence: "MH12 12345678901", // NEVER_STORE key (driving/licen[cs]e)
      dlNumber: "MH12 12345678901", // NEVER_STORE key (dl\b)
      upiHandle: "rahul@oksbi", // NEVER_STORE key (upi)
      passportNo: "L1234567", // NEVER_STORE key (passport)
      acctNo: "50100234567890", // NEVER_STORE key (account.?no)
      ifscCode: "SBIN0001234", // NEVER_STORE key (ifsc)
      documentRef: "MH12 12345678901", // benign key; DL-shaped VALUE → dropped
      proofId: "50100234567890", // benign key; bank VALUE → dropped
      upiRef: "upi://rahul@oksbi", // benign key; UPI VALUE → dropped
      fullName: "Rahul Verma",
      phoneNumber: "9876543210", // mobile must SURVIVE (bank regex exclusion)
    };
    const { fields } = V.validateStructuredFields(parsed);
    check("D4: DL key dropped (drivingLicence)", !("drivingLicence" in fields));
    check("D4: dl key dropped (dlNumber)", !("dlNumber" in fields));
    check("D4: UPI key dropped (upiHandle)", !("upiHandle" in fields));
    check("D4: passport key dropped (passportNo)", !("passportNo" in fields));
    check("D4: bank key dropped (acctNo)", !("acctNo" in fields));
    check("D4: ifsc key dropped (ifscCode)", !("ifscCode" in fields));
    check("D4: DL-shaped VALUE dropped under benign key (documentRef)", !("documentRef" in fields));
    check("D4: bank VALUE dropped under benign key (proofId)", !("proofId" in fields));
    check("D4: UPI VALUE dropped under benign key (upiRef)", !("upiRef" in fields));
    check("D4: benign value survives", fields.fullName === "Rahul Verma");
    check("D4: 10-digit [6-9] phone survives (not a bank account)", fields.phoneNumber === "9876543210", JSON.stringify(fields.phoneNumber));
  }

  // ── B. STRUCTURE handler: consent gate + remote guard + local path ──
  console.log("\nB. STRUCTURE_DOCUMENT_TEXT handler (D3 consent + criterion 2)");

  {
    // D3 — consent is enforced in the BACKGROUND. Default OFF: no stored
    // docConsent flag and no msg.consented → refused with ZERO VLM requests.
    V.structureRateReset();
    storageMap.vlmEndpoint = "http://localhost:8000/v1/chat/completions";
    delete storageMap.docConsent;
    delete storageMap.vlmModel;
    storageMap.userProfile = {};
    SESSION_STORE.vlmApiKey = "";
    chatCalls = 0;
    probeCalls = 0;

    await expectReject(handleStructureDocumentText({ text: RESUME_TEXT }), (msg) => {
      check(
        "consent absent (no flag, no msg.consented) → STRUCTURE_CONSENT_REQUIRED",
        msg.includes("STRUCTURE_CONSENT_REQUIRED"),
        msg
      );
      check("consent absent → no VLM chat request was made", chatCalls === 0, `chatCalls=${chatCalls}`);
      check(
        "classifyError maps consent refusal",
        classifyError({ message: msg }) === "STRUCTURE_CONSENT_REQUIRED",
        classifyError({ message: msg })
      );
    });

    V.structureRateReset();
    storageMap.docConsent = false;
    await expectReject(handleStructureDocumentText({ text: RESUME_TEXT, consented: false }), (msg) =>
      check("consent=false (msg + storage) → refused", msg.includes("STRUCTURE_CONSENT_REQUIRED"), msg)
    );
    check("consent=false → still zero chat requests", chatCalls === 0, `chatCalls=${chatCalls}`);

    // Stored flag is the source of truth fallback (frontend toggle writes it).
    V.structureRateReset();
    storageMap.docConsent = true;
    const viaStorage = await handleStructureDocumentText({ text: RESUME_TEXT, consented: false });
    check(
      "storage docConsent=true → consented (source of truth)",
      viaStorage && !viaStorage.error && viaStorage.fields.skills === "React, Node.js",
      JSON.stringify(viaStorage && viaStorage.fields)
    );
    check("storage-consented request hit the VLM transport", chatCalls === 1, `chatCalls=${chatCalls}`);
    delete storageMap.docConsent;

    // Rate limiter stays even after consent passes.
    V.structureRateReset();
    storageMap.docConsent = true;
    chatCalls = 0;
    const ok1 = await handleStructureDocumentText({ text: RESUME_TEXT, consented: true });
    await expectReject(handleStructureDocumentText({ text: RESUME_TEXT, consented: true }), (msg) =>
      check("rate limiter still gates STRUCTURE calls", msg.includes("STRUCTURE_RATE_LIMITED"), msg)
    );
    check("rate-limited call made no additional chat request", chatCalls === 1, `chatCalls=${chatCalls}`);
    delete storageMap.docConsent;
    V.structureRateReset();
  }

  {
    V.structureRateReset();
    storageMap.vlmEndpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    delete storageMap.vlmModel;
    storageMap.userProfile = {};
    SESSION_STORE.vlmApiKey = "";
    chatCalls = 0;
    probeCalls = 0;

    await expectReject(handleStructureDocumentText({ text: RESUME_TEXT, consented: true }), (msg) => {
      check(
        "remote endpoint → rejected with explicit message",
        msg.includes("Document text cannot be sent to a remote AI"),
        msg
      );
      check("remote endpoint → no VLM chat request was made", chatCalls === 0, `chatCalls=${chatCalls}`);
      check(
        "classifyError maps remote rejection",
        classifyError({ message: msg }) === "STRUCTURE_REMOTE_REJECTED",
        classifyError({ message: msg })
      );
    });
  }

  {
    V.structureRateReset();
    storageMap.vlmEndpoint = "http://localhost:8000/v1/chat/completions";
    SESSION_STORE.vlmApiKey = "";
    chatCalls = 0;

    const r = await handleStructureDocumentText({ text: RESUME_TEXT, consented: true });
    check("local endpoint → ok result", r && !r.error, JSON.stringify(r));
    check(
      "dynamic keys present (skills/university/motherTongue)",
      r && r.fields.skills === "React, Node.js" && r.fields.university === "IIT Bombay" && r.fields.motherTongue === "Tamil",
      JSON.stringify(r && r.fields)
    );
    check("aadhaarNumber dropped from STRUCTURE output", !(r && r.fields.aadhaarNumber), JSON.stringify(r && r.fields));
    check("VLM round trip occurred (transport used)", chatCalls === 1, `chatCalls=${chatCalls}`);
    check("latency measured", r && typeof r.latencyMs.vlm === "number" && typeof r.latencyMs.total === "number");
    check("isLocalVlmEndpoint: localhost true", isLocalVlmEndpoint("http://localhost:8000/v1/chat/completions"));
    check("isLocalVlmEndpoint: 127.0.0.1 true", isLocalVlmEndpoint("http://127.0.0.1:11434/v1/chat/completions"));
    check("isLocalVlmEndpoint: remote false", !isLocalVlmEndpoint("https://generativelanguage.googleapis.com/v1beta"));
    check("isLocalVlmEndpoint: garbage false", !isLocalVlmEndpoint("not a url"));
  }

  {
    V.structureRateReset();
    await expectReject(handleStructureDocumentText({ text: "   " }), (msg) =>
      check("empty text rejected", msg.includes("No document text provided"), msg)
    );
    V.structureRateReset();
    await expectReject(handleStructureDocumentText({ text: "x".repeat(60001) }), (msg) =>
      check("oversized text rejected", msg.includes("too large"), msg)
    );
  }

  // ── C. Vault (criterion 3) ─────────────────────────────────────────
  console.log("\nC. Local document vault");

  {
    const m = memStore();
    const dirty = "Name: Ananya\nAadhaar: 2345 6789 0123\nPAN: ABCDE1234F\nSkills: React";
    const res = await V.addDocToVault({ docName: "resume.txt", format: "text", text: dirty }, m);
    check("addDocToVault ok", res && res.ok, JSON.stringify(res));
    const storedText = m.map[V.VAULT_STORAGE_KEY][0].text;
    check("Aadhaar scrubbed at STORE time", !/2345\s?6789\s?0123/.test(storedText), storedText);
    check("PAN scrubbed at STORE time", !/ABCDE1234F/.test(storedText), storedText);
    check("non-sensitive text preserved", storedText.includes("Ananya") && storedText.includes("React"), storedText);
    check("doc meta present", res.doc && res.doc.docName === "resume.txt" && typeof res.doc.id === "string");
    check("charCount reported", res.doc && res.doc.charCount === storedText.length);
  }

  {
    const dirty = "Candidate: Priya\nDL: MH12 12345678901\nUPI: upi://rahul@oksbi\nPassport: L1234567\nAccount: 50100234567890\nSkills: React";
    const m = memStore();
    const res = await V.addDocToVault({ docName: "ids.txt", format: "text", text: dirty }, m);
    check("D4: addDocToVault ok for sensitive doc", res && res.ok, JSON.stringify(res));
    const storedText = m.map[V.VAULT_STORAGE_KEY][0].text;
    check("D4: DL redacted at STORE time", !/MH12\s?12345678901/.test(storedText), storedText);
    check("D4: UPI handle redacted at STORE time", !/rahul@oksbi/.test(storedText), storedText);
    check("D4: passport redacted at STORE time", !/L1234567/.test(storedText), storedText);
    check("D4: bank account redacted at STORE time", !/50100234567890/.test(storedText), storedText);
    check("D4: benign text preserved in vault", storedText.includes("Priya") && storedText.includes("React"), storedText);
  }

  {
    const m = memStore();
    for (let i = 0; i < 6; i++) {
      await V.addDocToVault({ docName: `doc${i}.txt`, text: `doc ${i} body` }, m);
    }
    const list = m.map[V.VAULT_STORAGE_KEY];
    check("vault capped at 5 docs (D6)", list.length === 5, `len=${list.length}`);
    check("oldest dropped first", !list.some((d) => d.docName === "doc0.txt"), JSON.stringify(list.map((d) => d.docName)));
  }

  {
    const docs = [
      { id: "a", docName: "old", extractedAt: "2026-01-01T00:00:00.000Z", text: "x".repeat(80) },
      { id: "b", docName: "new", extractedAt: "2026-02-01T00:00:00.000Z", text: "y".repeat(80) },
    ];
    const trimmed = V.trimVault(docs, { maxDocs: 10, maxBytes: 100 });
    check("byte cap drops oldest until under budget", trimmed.length === 1 && trimmed[0].id === "b", JSON.stringify(trimmed.map((d) => d.id)));
  }

  {
    const m = memStore();
    await V.addDocToVault({ docName: "resume.txt", format: "text", text: RESUME_TEXT }, m);
    const snippets = V.retrieveVaultSnippets(m.map[V.VAULT_STORAGE_KEY], "What university did she attend", 3);
    check("snippets returned", snippets.length > 0, `len=${snippets.length}`);
    check("snippet contains the university", snippets.some((s) => s.text.includes("IIT Bombay")), JSON.stringify(snippets));
    check("snippet ≤ 400 chars", snippets.every((s) => s.text.length <= 400), JSON.stringify(snippets.map((s) => s.text.length)));
    check("snippet carries docName", snippets.every((s) => s.docName === "resume.txt"));
    check("topK respected", snippets.length <= 3, `len=${snippets.length}`);
  }

  {
    const docs = [
      { docName: "letter.txt", text: "The university is Oxford. She studied at Oxford." },
      { docName: "notes.txt", text: "Nothing about universities here at all." },
    ];
    const snippets = V.retrieveVaultSnippets(docs, "university");
    check(
      "ranking prefers the doc containing the keyword",
      snippets.length > 0 && snippets[0].docName === "letter.txt" && snippets[0].score >= 1,
      JSON.stringify(snippets)
    );

    const none = V.retrieveVaultSnippets(docs, "the");
    check("stopword-only query → no snippets (no noise)", none.length === 0, JSON.stringify(none));
  }

  {
    storageMap[V.VAULT_STORAGE_KEY] = [
      { id: "d1", docName: "resume.txt", format: "text", extractedAt: "2026-09-01T00:00:00.000Z", text: RESUME_TEXT },
    ];
    const list = await handleGetDocVault();
    check("GET_DOC_VAULT returns docs list", list && list.docs && list.docs.length === 1);
    check(
      "GET_DOC_VAULT exposes name + charCount",
      list.docs[0].docName === "resume.txt" && list.docs[0].charCount === RESUME_TEXT.length,
      JSON.stringify(list.docs[0])
    );
    check("GET_DOC_VAULT never returns text", !("text" in list.docs[0]), JSON.stringify(list.docs[0]));
  }

  // ── D. sanitizeAction vault provenance (criterion 4) ────────────────
  console.log("\nD. sanitizeAction — vault-traceable 'type' provenance");

  const PAGE_FIELDS = [
    { type: "text_input", label: "Full Name", selector: "#name_input" },
    { type: "text_input", label: "University", selector: "#uni_input" },
    { type: "text_input", label: "Job Title", selector: "#title_input" },
  ];

  {
    V.setVaultTextCache([RESUME_TEXT]);

    const docSourced = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "IIT Bombay" },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check(
      "vault-traceable value, no profileKey → ALLOWED",
      docSourced && docSourced.action === "type" && docSourced.value === "IIT Bombay" && docSourced.source === "vault",
      JSON.stringify(docSourced)
    );

    const invented = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "Stanford University" },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("invented value (not in vault/profile) → REJECTED (fail closed)", invented === null, JSON.stringify(invented));

    const caseShift = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "  iit bombay  " },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("case/whitespace-insensitive vault match → ALLOWED", caseShift && caseShift.value === "  iit bombay  ", JSON.stringify(caseShift));

    const wrongField = sanitizeAction(
      { action: "type", selector: "#name_input", value: "IIT Bombay", profileKey: "Job Title" },
      { userProfile: normalizeProfile({ "Job Title": "Engineer" }), fields: PAGE_FIELDS }
    );
    check("vault value + claimed key on wrong field → REJECTED", wrongField === null, JSON.stringify(wrongField));

    const profilePath = normalizeProfile({ "Full Name": "Ananya Krishnan" });
    const viaProfile = sanitizeAction(
      { action: "type", selector: "#name_input", value: "Ananya Krishnan", profileKey: "Full Name" },
      { userProfile: profilePath, fields: PAGE_FIELDS }
    );
    check(
      "profile-exact match still ALLOWED with vault populated",
      viaProfile && viaProfile.source === "profile" && viaProfile.profileKey === "Full Name",
      JSON.stringify(viaProfile)
    );

    const singleChar = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "a" },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("degenerate 1-char value → REJECTED (length floor)", singleChar === null, JSON.stringify(singleChar));
  }

  {
    V.setVaultTextCache([]);
    const cold = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "IIT Bombay" },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("vault cache empty → doc value REJECTED (fail closed)", cold === null, JSON.stringify(cold));
  }

  {
    V.setVaultTextCache([RESUME_TEXT]);
    const ok = parseAction(
      'Sure! ```json\n{"action":"type","selector":"#uni_input","value":"IIT Bombay"}\n```',
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("parseAction recovers vault-sourced type from prose", ok && ok.action === "type" && ok.value === "IIT Bombay", JSON.stringify(ok));

    const bad = parseAction(
      'Sure! ```json\n{"action":"type","selector":"#uni_input","value":"Stanford University"}\n```',
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("parseAction still rejects invented value (fail closed)", bad === null, JSON.stringify(bad));

    V.setVaultTextCache([]);
  }

  // ── E. D9 — CAPTURE_AND_SANITIZE vault isolation on the REMOTE path ──
  console.log("\nE. D9 — CAPTURE_AND_SANITIZE RAG-lite is LOCAL-VLM-ONLY");

  async function runCapture(task) {
    capturedChatBodies.length = 0;
    const result = await handleCaptureAndSanitize(task);
    return { result, bodies: capturedChatBodies.slice() };
  }

  {
    // REMOTE endpoint + populated vault: the built VLM body must contain ZERO
    // vault text, tRag stays 0, and sanitizeAction must reject a vault-only
    // value (profile-only fallback) even if the cache is re-populated.
    storageMap.vlmEndpoint = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
    storageMap.userProfile = {};
    delete storageMap.docConsent;
    storageMap[V.VAULT_STORAGE_KEY] = [
      { id: "d1", docName: "resume.txt", format: "text", extractedAt: "2026-09-01T00:00:00.000Z", text: RESUME_TEXT },
    ];
    V.setVaultTextCache([RESUME_TEXT]); // simulate a warm cache before capture
    chatCalls = 0;
    probeCalls = 0;

    const { result, bodies } = await runCapture("What university did she attend?");
    const sent = bodies.map((b) => JSON.stringify(b)).join("\n");
    check("D9: remote capture still reaches the VLM transport", chatCalls === 1, `chatCalls=${chatCalls}`);
    check(
      "D9: remote VLM body has NO DOCUMENT KNOWLEDGE block (header absent)",
      !sent.includes("DOCUMENT KNOWLEDGE (from the user's OWN uploaded files"),
      ""
    );
    check("D9: remote VLM body has NO vault snippet text", !sent.includes("IIT Bombay") && !sent.includes("Ananya"), "");
    check("D9: remote capture returned an action (pipeline intact)", result.action && result.action.action === "done", JSON.stringify(result.action));
    check("D9: tRag = 0 on the remote path", result.receipt.latencyMs.rag === 0, JSON.stringify(result.receipt.latencyMs));

    V.setVaultTextCache([RESUME_TEXT]); // simulate future drift re-populating
    const rejected = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "IIT Bombay" },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("D9: remote path rejects a vault-only 'type' value (profile-only fallback)", rejected === null, JSON.stringify(rejected));

    const profileMatch = sanitizeAction(
      { action: "type", selector: "#name_input", value: "Ananya Krishnan", profileKey: "Full Name" },
      { userProfile: normalizeProfile({ "Full Name": "Ananya Krishnan" }), fields: PAGE_FIELDS }
    );
    check("D9: remote path still ALLOWS profile-exact values", profileMatch && profileMatch.source === "profile", JSON.stringify(profileMatch));
  }

  {
    // LOCAL endpoint + populated vault: DOCUMENT KNOWLEDGE must still be
    // present and vault values allowed — the demo feature is not broken.
    storageMap.vlmEndpoint = "http://localhost:8000/v1/chat/completions";
    storageMap.userProfile = {};
    storageMap[V.VAULT_STORAGE_KEY] = [
      { id: "d1", docName: "resume.txt", format: "text", extractedAt: "2026-09-01T00:00:00.000Z", text: RESUME_TEXT },
    ];
    chatCalls = 0;
    probeCalls = 0;

    const { result, bodies } = await runCapture("What university did she attend?");
    const sent = bodies.map((b) => JSON.stringify(b)).join("\n");
    check("D9: local capture VLM body HAS DOCUMENT KNOWLEDGE block", sent.includes("DOCUMENT KNOWLEDGE"), "");
    check("D9: local capture VLM body HAS the university snippet", sent.includes("IIT Bombay"), "");
    check(
      "D9: local capture reports a tRag field (0 on the VM is legitimate; remote is forced 0)",
      typeof result.receipt.latencyMs.rag === "number",
      JSON.stringify(result.receipt.latencyMs)
    );

    const accepted = sanitizeAction(
      { action: "type", selector: "#uni_input", value: "IIT Bombay" },
      { userProfile: {}, fields: PAGE_FIELDS }
    );
    check("D9: local path still ALLOWS a vault-traceable 'type' value", accepted && accepted.source === "vault", JSON.stringify(accepted));
  }

  // ── F. D6 — CLEAR_DOC_VAULT full purge ───────────────────────────
  console.log("\nF. D6 — vault caps + CLEAR_DOC_VAULT purge");

  check("D6: VAULT_MAX_DOCS = 5", V.VAULT_MAX_DOCS === 5, `got ${V.VAULT_MAX_DOCS}`);
  check("D6: VAULT_MAX_BYTES = 256 KB", V.VAULT_MAX_BYTES === 256 * 1024, `got ${V.VAULT_MAX_BYTES}`);

  {
    storageMap[V.VAULT_STORAGE_KEY] = [
      { id: "d1", docName: "resume.txt", format: "text", extractedAt: "2026-09-01T00:00:00.000Z", text: RESUME_TEXT },
    ];
    storageMap.userProfile = {
      "Full Name": "Ananya Krishnan",
      email: "a@b.com",
      _docSource1: "doc_abc123",
      _docSource2: "doc_def456",
    };
    V.setVaultTextCache([RESUME_TEXT]);
    const r = await handleClearDocVault();
    check("D6: CLEAR_DOC_VAULT ok", r && r.ok === true, JSON.stringify(r));
    const stored = await store.get([V.VAULT_STORAGE_KEY]);
    check("D6: vault emptied from storage", !stored[V.VAULT_STORAGE_KEY] || stored[V.VAULT_STORAGE_KEY].length === 0, JSON.stringify(stored));
    check("D6: vault provenance cache emptied", V.getCachedVaultTexts().length === 0);
    const prof = await store.get(["userProfile"]);
    check(
      "D6: all _docSource markers stripped from active profile",
      prof.userProfile && !Object.keys(prof.userProfile).some((k) => String(k).startsWith("_docSource")),
      JSON.stringify(prof.userProfile)
    );
    check("D6: non-marker profile fields preserved", prof.userProfile && prof.userProfile["Full Name"] === "Ananya Krishnan" && prof.userProfile.email === "a@b.com");
    check("D6: marker count reported", r.removedDocSourceMarkers === 2, `count=${r.removedDocSourceMarkers}`);
  }

  console.log(`\n${pass}/${pass + fail} passed, ${fail} failed.`);
  if (fail > 0) {
    console.log("doc-vault layer has a REGRESSION.");
    process.exit(1);
  }
  console.log("doc-vault layer CORRECT for all tested cases — tested against the REAL src/background/*.js, not a copy.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});