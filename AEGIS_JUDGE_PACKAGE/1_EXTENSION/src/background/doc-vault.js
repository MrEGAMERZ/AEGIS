// src/background/doc-vault.js
// ─────────────────────────────────────────────────────────────────────────────
// Aegis — local document vault + RAG-lite retrieval + STRUCTURE_DOCUMENT_TEXT
// validation. Privacy boundary: EVERYTHING here stays on-device.
//
//   • Vault lives in chrome.storage.local under `aegisDocVault` (never synced,
//     never sent to any endpoint). Aadhaar/PAN/licence/UPI/passport/bank
//     numbers are scrubbed from the text at STORE time ("never persist
//     sensitive"). Capped at VAULT_MAX_DOCS docs / VAULT_MAX_BYTES bytes;
//     clearVault() provides the full-purge path (CLEAR_DOC_VAULT).
//   • retrieveVaultSnippets() is a simple keyword scorer over the user's OWN
//     uploaded documents. Its output is injected ONLY into the local VLM's
//     system prompt (same path as the existing USER PROFILE block).
//   • validateStructuredFields() is the deterministic guard for the VLM's
//     structured-document output (dynamic keys allowed, never-store keys and
//     values dropped, length caps, field cap).
//
// MODULE FORMAT NOTES
//   This file intentionally has NO `import`/`export` statements. It is:
//     - loaded by the MV3 module service worker via a lazy
//       `import("./doc-vault.js")` (background.js's getDocVault()),
//     - loadable by the Node VM harnesses (vm.runInContext) as a classic
//       script, so background.js keeps parsing as a classic script there,
//     - importable in Node ESM (wrapped as CJS; the IIFE attaches the same
//       namespace to globalThis).
//   All public functions attach to `globalThis.AegisDocVault` — the service
//   worker and any test harness sharing the same global object see one copy.

(function attachDocVault(global) {
  "use strict";

  // ── Constants ─────────────────────────────────────────────────────────────
  const VAULT_STORAGE_KEY = "aegisDocVault";
  const VAULT_MAX_DOCS = 5; // D6: cap ≤ 5 documents
  const VAULT_MAX_BYTES = 256 * 1024; // D6: cap ≤ 256 KB total (char-bytes)
  const MAX_SNIPPET_CHARS = 400; // one retrieved snippet, ≤400 chars
  const DEFAULT_TOP_K = 3; // default number of snippets retrieved
  const MAX_DOC_NAME_CHARS = 160;
  const MAX_DOC_FORMAT_CHARS = 32;
  const MAX_STRUCT_FIELD_KEY_CHARS = 64;
  const MAX_STRUCT_FIELD_VALUE_CHARS = 2000;
  const MAX_STRUCT_FIELDS = 120; // rich resumes / form packs
  const MAX_STRUCT_INPUT_CHARS = 60000; // structure request text guard
  const DEFAULT_STRUCT_RATE_INTERVAL_MS = 1000; // local-model rate limiter

  // Never-store rules — mirrors src/shared/extract-profile.js so the vault and
  // the structured-document output obey the exact same sensitivity policy even
  // though this file must stay standalone (no module imports).
  const NEVER_STORE_KEY_RE =
    /aadhaar|uidai|pan\b|cvv|cvc|passport|upi|ssn|bank.?account|credit.?card|debit.?card|licen[cs]e|driving|dl\b|voter|elector|account.?no|account.?number|card.?number|ifsc|iban|swift/i;
  const AADHAAR_RE = /\b[2-9]\d{3}\s?\d{4}\s?\d{4}\b/;
  const PAN_RE = /\b[A-Z]{5}[0-9]{4}[A-Z]\b/;
  // D4 mirror (see extract-profile.js for why the UPI/bank shapes are refined):
  const DL_RE = /[A-Z]{2}[- ]?\d{13}|[A-Z]{2}[- ]?\d{2}[- ]?\d{11}/;
  const UPI_RE = /[\w.\-]{2,}@[a-z]{2,}(?![.\w])/;
  const PASSPORT_RE = /\b[A-Z][1-9]\d{6,7}\b/;
  const BANK_ACCOUNT_RE = /\b(?!([6-9]\d{9})\b)\d{9,18}\b/;
  const AADHAAR_G = new RegExp(AADHAAR_RE.source, "g");
  const PAN_G = new RegExp(PAN_RE.source, "g");
  const DL_G = new RegExp(DL_RE.source, "g");
  const UPI_G = new RegExp(UPI_RE.source, "g");
  const PASSPORT_G = new RegExp(PASSPORT_RE.source, "g");
  const BANK_ACCOUNT_G = new RegExp(BANK_ACCOUNT_RE.source, "g");

  const SMART_QUOTES = /[\u201c\u201d\u2018\u2019]/g;

  const KEYWORD_STOPWORDS = new Set(
    (
      "a,an,the,and,or,but,not,no,so,if,of,in,on,at,for,with,by,from,as,to,into,about," +
      "what,which,who,whom,whose,where,when,why,how,is,are,was,were,be,been,being,am," +
      "do,does,did,have,has,had,will,would,can,could,should,shall,may,might,must," +
      "than,then,there,here,this,that,these,those,her,his,she,he,they,them,their,it,its," +
      "my,your,our,we,you,i,me,us,please,fill,out,till,over,under,between,during"
    ).split(",")
  );

  // ── Sensitive-number policy (pure) ────────────────────────────────────────
  function isNeverStoreKey(key) {
    return NEVER_STORE_KEY_RE.test(String(key ?? ""));
  }

  function isNeverStoreValue(value) {
    const s = String(value ?? "");
    return (
      AADHAAR_RE.test(s) ||
      PAN_RE.test(s) ||
      DL_RE.test(s) ||
      UPI_RE.test(s) ||
      PASSPORT_RE.test(s) ||
      BANK_ACCOUNT_RE.test(s)
    );
  }

  // Scrub sensitive numbers out of raw text BEFORE it is persisted to the
  // vault so "never persist sensitive" holds at the storage layer, not just at
  // the output layer.
  function redactSensitiveNumbers(text) {
    return String(text ?? "")
      .replace(AADHAAR_G, "[REDACTED]")
      .replace(PAN_G, "[REDACTED]")
      .replace(DL_G, "[REDACTED]")
      .replace(UPI_G, "[REDACTED]")
      .replace(PASSPORT_G, "[REDACTED]")
      .replace(BANK_ACCOUNT_G, "[REDACTED]");
  }

  // ── Structured-document validation (pure) ────────────────────────────────
  // Scan every balanced {...} run, tracking string state so a brace inside a
  // quoted value does not end the object. Same lenient extraction the action
  // parser uses: the local VLM routinely wraps JSON in prose or code fences.
  function balancedJsonObjects(text) {
    const found = [];
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        if (depth === 0) start = i;
        depth++;
        continue;
      }
      if (ch === "}" && depth > 0) {
        depth--;
        if (depth === 0 && start >= 0) {
          found.push(text.slice(start, i + 1));
          start = -1;
        }
      }
    }
    return found;
  }

  // Returns the FIRST object-shaped JSON found in the reply, or null.
  // Lenient like parseAction(): tolerates prose, fences, and curly quotes.
  function parseStructuredFields(raw) {
    if (typeof raw !== "string" || !raw.trim()) return null;
    // Whole-reply direct parse first (fast path).
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
    } catch {
      // fall through to snippet scanning
    }
    for (const snippet of balancedJsonObjects(raw)) {
      const candidates = [];
      candidates.push(snippet);
      const straightened = snippet.replace(SMART_QUOTES, '"');
      if (straightened !== snippet) candidates.push(straightened);
      for (const candidate of candidates) {
        try {
          const obj = JSON.parse(candidate);
          if (obj && typeof obj === "object" && !Array.isArray(obj)) return obj;
        } catch {
          // keep scanning
        }
      }
    }
    return null;
  }

  // Deterministic guard for the VLM's structured output. Returns:
  //   { fields: {key: value}, dropped, total }
  // Rules:
  //   • keys: trimmed non-empty string, ≤ maxKeyChars, never-store key → drop
  //   • values: must be a NON-EMPTY STRING (numbers/bools/objects dropped),
  //     ≤ maxValueChars, never-store value (Aadhaar/PAN) → drop
  //   • total fields capped at maxFields (excess dropped, oldest kept)
  // Dynamic keys are allowed — ANY key is accepted as long as it passes the
  // caps and the never-store filter.
  function validateStructuredFields(parsed, opts) {
    const o = opts || {};
    const maxFields = o.maxFields ?? MAX_STRUCT_FIELDS;
    const maxKeyChars = o.maxKeyChars ?? MAX_STRUCT_FIELD_KEY_CHARS;
    const maxValueChars = o.maxValueChars ?? MAX_STRUCT_FIELD_VALUE_CHARS;
    const fields = {};
    let dropped = 0;

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fields, dropped: 1, total: 0, reason: "not-an-object" };
    }
    const entries = Object.entries(parsed);
    for (const [rawKey, rawValue] of entries) {
      if (Object.keys(fields).length >= maxFields) {
        dropped++;
        continue;
      }
      const key = String(rawKey ?? "").trim();
      if (!key || key.length > maxKeyChars || isNeverStoreKey(key)) {
        dropped++;
        continue;
      }
      // Only non-empty strings merge into the profile.
      if (typeof rawValue !== "string") {
        dropped++;
        continue;
      }
      const value = rawValue.trim();
      if (!value || value.length > maxValueChars || isNeverStoreValue(value)) {
        dropped++;
        continue;
      }
      fields[key] = value;
    }
    return { fields, dropped, total: entries.length };
  }

  // ── Keyword scoring + snippet retrieval (pure) ────────────────────────────
  function extractKeywords(query) {
    const words = String(query ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    const out = [];
    for (const w of words) {
      if (w.length < 3) continue;
      if (KEYWORD_STOPWORDS.has(w)) continue;
      if (!out.includes(w)) out.push(w);
    }
    return out;
  }

  // Split text into sentences. Lines are kept intact (resumes/bullets); lines
  // over MAX_SNIPPET_CHARS get broken at sentence boundaries for scoring.
  function splitIntoSentences(text) {
    const s = String(text ?? "");
    if (!s.trim()) return [];
    const out = [];
    for (const rawLine of s.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.length <= MAX_SNIPPET_CHARS) {
        out.push(line);
        continue;
      }
      const parts = line.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
      for (const p of parts) {
        const t = p.trim();
        if (t) out.push(t);
      }
    }
    return out;
  }

  function scoreSentence(sentence, keywords) {
    const lower = String(sentence ?? "").toLowerCase();
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    return score;
  }

  function clipSnippet(sentence, maxChars) {
    const cap = maxChars ?? MAX_SNIPPET_CHARS;
    const s = String(sentence ?? "").replace(/\s+/g, " ").trim();
    if (s.length <= cap) return s;
    const cut = s.slice(0, cap);
    const lastSpace = cut.lastIndexOf(" ");
    return (lastSpace > cap * 0.6 ? cut.slice(0, lastSpace) : cut) + "…";
  }

  // Retrieve the top-K highest-scoring sentences across all vault docs.
  // docs: [{docName, text}]  — only the user's OWN stored documents.
  // Returns [{ text, score, docName }], each text ≤ MAX_SNIPPET_CHARS chars.
  // No keywords (empty/stopword-only query) → [] (no signal, no noise).
  function retrieveVaultSnippets(docs, fieldLabelOrPrompt, topK) {
    const k = Math.max(1, Math.min(10, Number(topK) || DEFAULT_TOP_K));
    const keywords = extractKeywords(fieldLabelOrPrompt);
    if (keywords.length === 0) return [];
    const list = Array.isArray(docs) ? docs : [];
    const scored = [];
    for (const doc of list) {
      const docName = typeof doc?.docName === "string" ? doc.docName : "";
      const docText = typeof doc?.text === "string" ? doc.text : "";
      for (const sentence of splitIntoSentences(docText)) {
        const score = scoreSentence(sentence, keywords);
        if (score > 0) {
          scored.push({ text: clipSnippet(sentence), score, docName });
        }
      }
    }
    // Stable sort (V8): equal scores keep document order.
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  // ── Vault accounting + trimming (pure) ────────────────────────────────────
  // Byte-ish length that works everywhere (VM sandbox has no TextEncoder
  // guarantee): UTF-8 length via escape(), falling back to char length.
  function utf8ByteLength(s) {
    const str = String(s ?? "");
    try {
      return unescape(encodeURIComponent(str)).length;
    } catch {
      return str.length;
    }
  }

  function vaultByteSize(docs) {
    const list = Array.isArray(docs) ? docs : [];
    let bytes = 0;
    for (const doc of list) {
      if (doc && typeof doc.text === "string") bytes += utf8ByteLength(doc.text);
    }
    return bytes;
  }

  // Enforce caps: ≤ maxDocs documents and ≤ maxBytes total. Oldest documents
  // (by extractedAt) are dropped first. A single oversized document is kept
  // but truncated to fit the byte budget (whole-vault retention beats loss).
  function trimVault(docs, opts) {
    const o = opts || {};
    const maxDocs = o.maxDocs ?? VAULT_MAX_DOCS;
    const maxBytes = o.maxBytes ?? VAULT_MAX_BYTES;
    const list = (Array.isArray(docs) ? docs : [])
      .filter((d) => d && typeof d.text === "string" && d.text.length > 0)
      .sort((a, b) =>
        String(a.extractedAt ?? "").localeCompare(String(b.extractedAt ?? ""))
      );
    while (list.length > maxDocs) list.shift();
    while (list.length > 1 && vaultByteSize(list) > maxBytes) list.shift();
    if (list.length === 1 && vaultByteSize(list) > maxBytes) {
      const doc = list[0];
      const budget = Math.max(1, maxBytes);
      let cut = utf8ByteLength(doc.text);
      let text = doc.text;
      while (cut > budget && text.length > 0) {
        text = text.slice(0, Math.floor(text.length * 0.9));
        cut = utf8ByteLength(text);
      }
      doc.text = text;
    }
    return list;
  }

  function makeVaultId(now) {
    return (
      "doc_" +
      String(now).toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 8)
    );
  }

  function normalizeVaultDoc(input, now) {
    const t = now ?? Date.now();
    const name =
      String(input?.docName ?? "").trim().slice(0, MAX_DOC_NAME_CHARS) ||
      "upload";
    const format =
      String(input?.format ?? "text").trim().slice(0, MAX_DOC_FORMAT_CHARS) ||
      "text";
    const raw = String(input?.text ?? "");
    if (!raw.trim()) return null;
    return {
      id: makeVaultId(t),
      docName: name,
      format,
      extractedAt: new Date(t).toISOString(),
      text: redactSensitiveNumbers(raw), // never persist Aadhaar/PAN
    };
  }

  // ── chrome.storage.local persistence (mockable via `store`) ──────────────
  function defaultStore() {
    return global?.chrome?.storage?.local || null;
  }

  async function loadVault(store) {
    const s = store || defaultStore();
    if (!s || typeof s.get !== "function") return { docs: [] };
    try {
      const r = await s.get([VAULT_STORAGE_KEY]);
      const raw = r && r[VAULT_STORAGE_KEY];
      const list = Array.isArray(raw) ? raw : [];
      return { docs: list.filter((d) => d && typeof d.text === "string") };
    } catch {
      return { docs: [] };
    }
  }

  async function saveVault(docs, store) {
    const s = store || defaultStore();
    const trimmed = trimVault(docs);
    if (s && typeof s.set === "function") {
      await s.set({ [VAULT_STORAGE_KEY]: trimmed });
    }
    setVaultTextCache(trimmed.map((d) => d.text));
    return trimmed;
  }

  // Store one document. Returns { ok, doc?, count, bytes, docs } or
  // { ok:false, error } for empty input. Aadhaar/PAN scrub happens in
  // normalizeVaultDoc before anything is persisted.
  async function addDocToVault(input, store) {
    const doc = normalizeVaultDoc(input);
    if (!doc) {
      return { ok: false, error: "VAULT_EMPTY_DOC: nothing to store" };
    }
    const { docs } = await loadVault(store);
    docs.push(doc);
    const trimmed = await saveVault(docs, store);
    const meta = trimmed.map((d) => ({
      id: d.id,
      docName: d.docName,
      format: d.format,
      extractedAt: d.extractedAt,
      charCount: d.text.length,
    }));
    return {
      ok: true,
      doc: meta.find((m) => m.id === doc.id) || null,
      count: meta.length,
      bytes: vaultByteSize(trimmed),
      docs: meta,
    };
  }

  // Dashboard-safe listing: names + char counts ONLY. Never returns text.
  async function getVaultList(store) {
    const { docs } = await loadVault(store);
    return docs.map((d) => ({
      id: d.id,
      docName: d.docName,
      format: d.format,
      extractedAt: d.extractedAt,
      charCount: d.text.length,
    }));
  }

  // Full purge path (D6): empty the vault in storage AND the in-memory
  // provenance cache. Used by CLEAR_DOC_VAULT and by consent revocation —
  // the background handler additionally strips `_docSource` markers from the
  // active profile. store.remove() fallback to set([]) for minimal mocks.
  async function clearVault(store) {
    const s = store || defaultStore();
    if (s && typeof s.remove === "function") {
      await s.remove(VAULT_STORAGE_KEY);
    } else if (s && typeof s.set === "function") {
      await s.set({ [VAULT_STORAGE_KEY]: [] });
    }
    setVaultTextCache([]);
    return { ok: true, docs: [] };
  }

  // ── Synchronous vault-text cache (for the sanitizeAction provenance guard)
  // The "type" anti-hallucination guard is synchronous, but storage is async.
  // This module keeps an in-memory cache of the vault texts (loaded at
  // capture-time and refreshed on every vault write) so sanitizeAction() can
  // verify a typed value against the user's OWN stored documents without
  // awaiting storage. Empty cache → no vault provenance → fail closed.
  let vaultTextCache = [];

  function setVaultTextCache(texts) {
    vaultTextCache = (Array.isArray(texts) ? texts : []).filter(
      (t) => typeof t === "string"
    );
  }

  function getCachedVaultTexts() {
    return vaultTextCache.slice();
  }

  async function refreshVaultCache(store) {
    const { docs } = await loadVault(store);
    setVaultTextCache(docs.map((d) => d.text));
    return vaultTextCache.slice();
  }

  // Provenance predicate used by background.js sanitizeAction(): true when the
  // (trimmed, case-insensitive) value is a substring of ANY stored vault text.
  // A length floor avoids degenerate single-char matches from passing the bar.
  function vaultContainsValue(value, texts) {
    const needle = String(value ?? "").trim().toLowerCase();
    if (needle.length < 2) return false;
    const list = Array.isArray(texts) ? texts : [];
    return list.some((t) => String(t ?? "").toLowerCase().includes(needle));
  }

  // ── Local-model rate limiter for STRUCTURE_DOCUMENT_TEXT ──────────────────
  // The structure call is a full local-VLM round trip; a naive double-click
  // would queue two expensive inferences back-to-back. One call per interval.
  let lastStructureCallAt = 0;

  function structureRateLimit(minIntervalMs) {
    const interval =
      minIntervalMs ?? DEFAULT_STRUCT_RATE_INTERVAL_MS;
    const now = Date.now();
    if (now - lastStructureCallAt < interval) {
      return { ok: false, retryAfterMs: interval - (now - lastStructureCallAt) };
    }
    lastStructureCallAt = now;
    return { ok: true };
  }

  function structureRateReset() {
    lastStructureCallAt = 0;
  }

  // ── Public namespace ──────────────────────────────────────────────────────
  const api = {
    VAULT_STORAGE_KEY,
    VAULT_MAX_DOCS,
    VAULT_MAX_BYTES,
    MAX_SNIPPET_CHARS,
    DEFAULT_TOP_K,
    MAX_STRUCT_FIELD_KEY_CHARS,
    MAX_STRUCT_FIELD_VALUE_CHARS,
    MAX_STRUCT_FIELDS,
    MAX_STRUCT_INPUT_CHARS,

    // sensitive-number policy
    isNeverStoreKey,
    isNeverStoreValue,
    redactSensitiveNumbers,

    // structured-document validation
    parseStructuredFields,
    validateStructuredFields,
    balancedJsonObjects,

    // keyword scoring + retrieval
    extractKeywords,
    splitIntoSentences,
    scoreSentence,
    retrieveVaultSnippets,

    // vault accounting + trimming
    utf8ByteLength,
    vaultByteSize,
    trimVault,
    normalizeVaultDoc,

    // persistence (mockable via store)
    loadVault,
    saveVault,
    addDocToVault,
    getVaultList,
    clearVault,

    // synchronous provenance cache
    setVaultTextCache,
    getCachedVaultTexts,
    refreshVaultCache,
    vaultContainsValue,

    // rate limiter
    structureRateLimit,
    structureRateReset,
  };

  if (global && typeof global === "object") {
    global.AegisDocVault = api;
  }
  return api;
})(typeof globalThis !== "undefined" ? globalThis : this);