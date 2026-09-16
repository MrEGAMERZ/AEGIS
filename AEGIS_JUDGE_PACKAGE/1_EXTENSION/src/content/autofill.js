// Autofill — progressive profile system.
// Plain script (content script context). Exposes window.AegisAutofill.
//
// Privacy model:
//   - Profile values live ONLY in chrome.storage.local (on-device).
//   - Prefill runs BEFORE screenshot capture; filled fields are flagged via
//     el.dataset.aegisFilled so the offscreen document black-fills them —
//     values never appear in anything sent to the VLM.
//   - "Ask once": unknown fields trigger an in-page prompt; the answer is
//     saved to the profile and never asked again. Skippable per-field.
//   - never_store fields (Aadhaar/PAN/etc) are never prompted for, never saved.

(() => {
  "use strict";

  const STORAGE_KEY = "aegisProfile";
  const FILLED_FLAG = "aegisFilled";
  const { classifyField, buildSelector, KEY_LABELS } = window.AegisFieldMapper;

  // ── Profile storage (chrome.storage.local only) ───────────────────

  // Map popup / fixture labels (Ananya JSON) onto field-mapper keys.
  const USER_PROFILE_ALIASES = {
    fullname: "fullName",
    "full name": "fullName",
    firstname: "firstName",
    lastname: "lastName",
    email: "email",
    phone: "phone",
    dob: "dob",
    "date of birth": "dob",
    gender: "gender",
    address: "addressLine1",
    addressline1: "addressLine1",
    city: "city",
    state: "state",
    pincode: "pincode",
    "pin code": "pincode",
    college: "college",
    course: "course",
    organization: "college",
    "job title": "occupation",
    "father's name": "guardianName",
    "mother's name": "guardianName",
  };

  function flattenUserProfile(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v == null || v === "") continue;
      if (typeof v === "object" && v.value != null) {
        out[k] = v;
        continue;
      }
      const alias = USER_PROFILE_ALIASES[String(k).toLowerCase().trim()] || k;
      out[alias] = { value: String(v), updatedAt: Date.now() };
    }
    return out;
  }

  async function getProfile() {
    const stored = await chrome.storage.local.get([STORAGE_KEY, "userProfile"]);
    const fromPopup = flattenUserProfile(stored.userProfile);
    const fromAegis = stored[STORAGE_KEY] || {};
    return { ...fromPopup, ...fromAegis };
  }

  async function saveProfileEntry(key, value) {
    const profile = await getProfile();
    profile[key] = { value: String(value).trim(), updatedAt: Date.now() };
    await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  }

  async function skipProfileKey(key) {
    const profile = await getProfile();
    profile._skipped = profile._skipped || {};
    profile._skipped[key] = true;
    await chrome.storage.local.set({ [STORAGE_KEY]: profile });
  }

  async function clearProfile() {
    await chrome.storage.local.remove(STORAGE_KEY);
  }

  // ── Field scanning ────────────────────────────────────────────────

  const FILLABLE_SELECTOR =
    "input, select, textarea";

  function isFillable(el) {
    if (el.disabled || el.readOnly) return false;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      return ![
        "hidden", "button", "submit", "reset", "image", "file",
        "checkbox", "radio", "password", "range", "color",
      ].includes(type);
    }
    return el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }
    return true;
  }

  function scanFillableFields() {
    const results = [];
    for (const el of document.querySelectorAll(FILLABLE_SELECTOR)) {
      if (!isFillable(el) || !isVisible(el)) continue;
      results.push({ el, classification: classifyField(el) });
    }
    return results;
  }

  function labelOf(el) {
    if (el.labels?.[0]?.textContent?.trim()) return el.labels[0].textContent.trim();
    if (el.getAttribute("aria-label")) return el.getAttribute("aria-label");
    return el.placeholder || el.name || el.id || "";
  }

  // ── Value normalization + filling ─────────────────────────────────

  function normalizeValue(key, rawValue) {
    let value = String(rawValue).trim();
    if (key === "dob") {
      // Accept dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, yyyy-mm-dd → ISO for <input type="date">
      const dmy = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
      if (dmy) {
        value = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
      }
    }
    if (key === "gender") {
      const v = value.toLowerCase();
      if (/^(m|male|man)$/.test(v)) value = "male";
      else if (/^(f|female|woman)$/.test(v)) value = "female";
      else if (/^(o|other|non-?binary)$/.test(v)) value = "other";
    }
    return value;
  }

  const filledHistory = [];
  let floatingBadgeHost = null;

  function fillElement(el, value) {
    value = String(value);

    // Save original value for 1-Click Undo capability
    if (el.dataset.aegisOriginalValue === undefined) {
      el.dataset.aegisOriginalValue = el.value || "";
    }
    filledHistory.push({ el, originalValue: el.dataset.aegisOriginalValue });

    if (el.tagName === "SELECT") {
      const target = value.toLowerCase();
      const option = Array.from(el.options).find(
        (o) =>
          o.value.toLowerCase() === target ||
          o.textContent.trim().toLowerCase().includes(target) ||
          target.includes(o.textContent.trim().toLowerCase())
      );
      if (!option) return false;
      el.value = option.value;
    } else {
      const type = (el.type || "text").toLowerCase();
      if (type === "radio") {
        const target = value.toLowerCase();
        const valMatch = (el.value || "").toLowerCase();
        const labelText = labelOf(el).toLowerCase();
        if (valMatch === target || labelText.includes(target) || target.includes(labelText)) {
          el.checked = true;
        } else {
          return false;
        }
      } else if (type === "checkbox") {
        if (/^(true|yes|1|agree|check)$/i.test(value)) {
          el.checked = true;
        } else {
          return false;
        }
      } else {
        if (type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        if (el.maxLength > 0 && value.length > el.maxLength) value = value.slice(0, el.maxLength);
        el.value = value;
      }
    }

    el.dataset[FILLED_FLAG] = "1";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function undoAutofill() {
    let undoneCount = 0;
    for (const item of filledHistory) {
      if (item.el) {
        item.el.value = item.originalValue;
        delete item.el.dataset[FILLED_FLAG];
        delete item.el.dataset.aegisOriginalValue;
        item.el.dispatchEvent(new Event("input", { bubbles: true }));
        item.el.dispatchEvent(new Event("change", { bubbles: true }));
        undoneCount++;
      }
    }
    filledHistory.length = 0;
    if (floatingBadgeHost) {
      floatingBadgeHost.remove();
      floatingBadgeHost = null;
    }
    return undoneCount;
  }

  function analyzeFormSafety() {
    const warnings = [];
    const forms = Array.from(document.forms);
    const host = window.location.hostname;

    for (const form of forms) {
      const action = form.getAttribute("action") || "";
      if (action.startsWith("http://") && window.location.protocol === "https:") {
        warnings.push("Insecure http:// target");
      }
      try {
        if (action.startsWith("http://") || action.startsWith("https://")) {
          const actionUrl = new URL(action);
          if (actionUrl.hostname !== host && !actionUrl.hostname.endsWith("." + host)) {
            warnings.push(`Cross-domain target: ${actionUrl.hostname}`);
          }
        }
      } catch {}
    }

    return warnings;
  }

  function renderFloatingBadge(fieldsCount) {
    if (floatingBadgeHost || fieldsCount === 0) return;

    const safetyWarnings = analyzeFormSafety();
    const isSuspicious = safetyWarnings.length > 0;

    floatingBadgeHost = document.createElement("div");
    floatingBadgeHost.style.cssText =
      "position:fixed;bottom:20px;left:20px;z-index:2147483646;all:initial";
    const shadow = floatingBadgeHost.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = `
      .badge {
        all: initial;
        display: flex; align-items: center; gap: 8px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px; font-weight: 600; color: ${isSuspicious ? "#991b1b" : "#0f172a"};
        background: ${isSuspicious ? "#fef2f2" : "#ffffff"};
        border: 1px solid ${isSuspicious ? "#fca5a5" : "#cbd5e1"}; border-radius: 30px;
        padding: 6px 14px; box-shadow: 0 6px 20px rgba(0,0,0,0.1);
        cursor: default; transition: all 0.2s ease;
      }
      .badge:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.15); }
      .btn {
        background: ${isSuspicious ? "#dc2626" : "#2563eb"}; color: #ffffff; border: none;
        border-radius: 20px; padding: 4px 10px; font-size: 11px;
        font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; gap: 4px;
      }
      .btn:hover { background: ${isSuspicious ? "#b91c1c" : "#1d4ed8"}; }
      .btn-undo { background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1; }
      .btn-undo:hover { background: #e2e8f0; color: #0f172a; }
      .progress-bar {
        width: 40px; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; display: inline-block;
      }
      .progress-fill { height: 100%; background: #2563eb; width: 0%; transition: width 0.3s ease; }
      .close { color: #94a3b8; cursor: pointer; margin-left: 4px; font-size: 14px; }
      .close:hover { color: #0f172a; }
    `;

    const badge = document.createElement("div");
    badge.className = "badge";
    const icon = isSuspicious ? "⚠️" : "🛡️";
    const label = isSuspicious ? `Shield Alert: ${safetyWarnings[0]}` : `AEGIS: ${fieldsCount} fields`;

    badge.innerHTML = `
      <span>${icon} ${label}</span>
      <div class="progress-bar"><div id="progress-fill" class="progress-fill"></div></div>
      <button id="fill-btn" class="btn">${isSuspicious ? "Fill Anyway" : "⚡ Fill"}</button>
      <button id="undo-btn" class="btn btn-undo" style="display:none;">↩️ Undo</button>
      <span id="close-btn" class="close">×</span>
    `;

    shadow.appendChild(style);
    shadow.appendChild(badge);

    const fillBtn = shadow.querySelector("#fill-btn");
    const undoBtn = shadow.querySelector("#undo-btn");
    const closeBtn = shadow.querySelector("#close-btn");
    const progressFill = shadow.querySelector("#progress-fill");

    fillBtn.addEventListener("click", async () => {
      const res = await prefillFromProfile();
      if (res.filled.length > 0) {
        fillBtn.textContent = "✅ Filled!";
        undoBtn.style.display = "inline-flex";
        if (progressFill) progressFill.style.width = "100%";
      }
    });

    undoBtn.addEventListener("click", () => {
      const count = undoAutofill();
      fillBtn.textContent = "⚡ Fill";
      undoBtn.style.display = "none";
      if (progressFill) progressFill.style.width = "0%";
    });

    closeBtn.addEventListener("click", () => {
      floatingBadgeHost.remove();
      floatingBadgeHost = null;
    });

    document.documentElement.appendChild(floatingBadgeHost);
  }

  // ── Prefill & Auto-Harvest Self-Learning ───────────────────────────

  async function prefillFromProfile() {
    const profile = await getProfile();
    let updatedProfile = false;
    const filled = [];
    const unknown = [];
    const neverStore = [];

    for (const { el, classification } of scanFillableFields()) {
      const selector = buildSelector(el);
      const info = { selector, label: labelOf(el) };

      if (classification.key === "never_store") {
        neverStore.push(info);
        continue;
      }
      if (!classification.key) continue;

      if (profile._skipped?.[classification.key]) continue;

      // 1. SELF-LEARNING: Auto-harvest values from form inputs already filled on the page
      const existingDomVal = (el.value || "").trim();
      if (existingDomVal && existingDomVal.length >= 2) {
        if (!profile[classification.key] || profile[classification.key].value !== existingDomVal) {
          profile[classification.key] = { value: existingDomVal, updatedAt: Date.now() };
          updatedProfile = true;
        }
        el.dataset[FILLED_FLAG] = "1"; // Redact on screenshot for privacy
        filled.push({ ...info, key: classification.key });
        continue;
      }

      // 2. PREFILL: Fill stored profile entries into empty DOM inputs
      const entry = profile[classification.key];
      if (entry?.value) {
        if (fillElement(el, normalizeValue(classification.key, entry.value))) {
          filled.push({ ...info, key: classification.key });
        }
      } else if (!unknown.find((u) => u.key === classification.key)) {
        unknown.push({ ...info, key: classification.key });
      }
    }

    if (updatedProfile) {
      await chrome.storage.local.set({ [STORAGE_KEY]: profile });
    }

    return { filled, unknown, neverStore };
  }

  // ── Ask-once prompt (Shadow DOM, non-blocking) ────────────────────

  let activeCard = null;

  function dismissPrompt() {
    activeCard?.host?.remove();
    activeCard = null;
  }

  function showAskOncePrompt(unknownFields, elsByKey) {
    if (activeCard || unknownFields.length === 0) return;
    dismissPrompt();

    const host = document.createElement("div");
    host.style.cssText =
      "position:fixed;bottom:20px;right:20px;z-index:2147483647;all:initial";
    const shadow = host.attachShadow({ mode: "open" });
    activeCard = { host, shadow };

    const style = document.createElement("style");
    style.textContent = `
      .card {
        all: initial;
        display: block; width: 300px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px; color: #e0e0e0; background: #1a1a2e;
        border: 1px solid #00d4ff; border-radius: 8px;
        padding: 14px; box-shadow: 0 4px 24px rgba(0,0,0,0.5);
      }
      h2 { font-size: 13px; margin: 0 0 4px; color: #00d4ff; font-weight: 600; }
      p { margin: 0 0 10px; font-size: 11px; color: #888; }
      .row { margin-bottom: 10px; }
      label { display: block; font-size: 11px; color: #aaa; margin-bottom: 3px; }
      input[type="text"] {
        all: initial; display: block; width: 100%; box-sizing: border-box;
        padding: 6px 8px; background: #16213e; border: 1px solid #333;
        border-radius: 4px; color: #e0e0e0; font-size: 12px; font-family: inherit;
      }
      input[type="text"]:focus { border-color: #00d4ff; }
      .skip { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #888; margin-top: 2px; cursor: pointer; }
      .actions { display: flex; gap: 8px; margin-top: 12px; }
      button {
        flex: 1; padding: 8px; border: none; border-radius: 6px;
        font-size: 12px; font-weight: 600; cursor: pointer; font-family: inherit;
      }
      .save { background: #00d4ff; color: #1a1a2e; }
      .dismiss { background: transparent; color: #888; border: 1px solid #333; }
    `;

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<h2>AEGIS — complete your profile</h2>' +
      '<p>Answer once, saved on your device only. Never asked again.</p>';

    const inputsByKey = {};
    for (const field of unknownFields) {
      const row = document.createElement("div");
      row.className = "row";

      const label = document.createElement("label");
      label.textContent = KEY_LABELS[field.key] || field.key;
      row.appendChild(label);

      const input = document.createElement("input");
      input.type = "text";
      input.dataset.key = field.key;
      if (field.label) input.placeholder = `e.g. ${field.label}`.slice(0, 60);
      row.appendChild(input);
      inputsByKey[field.key] = input;

      const skipLabel = document.createElement("label");
      skipLabel.className = "skip";
      const skipCheck = document.createElement("input");
      skipCheck.type = "checkbox";
      skipCheck.dataset.skipKey = field.key;
      skipLabel.appendChild(skipCheck);
      skipLabel.appendChild(document.createTextNode("Don't ask again"));
      row.appendChild(skipLabel);

      card.appendChild(row);
    }

    const actions = document.createElement("div");
    actions.className = "actions";
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "dismiss";
    dismissBtn.textContent = "Not now";
    const saveBtn = document.createElement("button");
    saveBtn.className = "save";
    saveBtn.textContent = "Save & fill";
    actions.appendChild(dismissBtn);
    actions.appendChild(saveBtn);
    card.appendChild(actions);

    shadow.appendChild(style);
    shadow.appendChild(card);

    const enterKey = (fieldKey, value, skip) => {
      if (skip) {
        skipProfileKey(fieldKey);
      } else if (value) {
        saveProfileEntry(fieldKey, value);
      } else {
        return; // empty + not skipped: keep asking next time
      }
      const valueToFill = skip ? null : value;
      if (valueToFill) {
        const normalized = normalizeValue(fieldKey, valueToFill);
        for (const el of elsByKey[fieldKey] || []) {
          fillElement(el, normalized);
        }
      }
      // Remove answered rows from the card
      const input = inputsByKey[fieldKey];
      input.closest(".row").remove();
      delete inputsByKey[fieldKey];
      if (Object.keys(inputsByKey).length === 0) dismissPrompt();
    };

    saveBtn.addEventListener("click", () => {
      for (const [key, input] of Object.entries(inputsByKey)) {
        const skip = !!shadow.querySelector(`input[data-skip-key="${key}"]`)?.checked;
        enterKey(key, input.value.trim(), skip);
      }
    });
    dismissBtn.addEventListener("click", dismissPrompt);

    document.documentElement.appendChild(host);
  }

  // ── Entry point: prefill + prompt (called by background before capture) ──

  async function runPrefillAndPrompt() {
    const { filled, unknown, neverStore } = await prefillFromProfile();

    if (unknown.length > 0) {
      // Collect ALL elements per key so a saved answer fills every instance
      const elsByKey = {};
      for (const { el, classification } of scanFillableFields()) {
        if (unknown.some((u) => u.key === classification.key)) {
          (elsByKey[classification.key] = elsByKey[classification.key] || []).push(el);
        }
      }
      showAskOncePrompt(unknown, elsByKey);
    }

    return {
      filled,
      unknown,
      neverStore,
      promptShown: activeCard !== null,
    };
  }

  // ── Message handler ───────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "PROFILE_PREFILL") {
      runPrefillAndPrompt()
        .then(sendResponse)
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }
    if (msg.type === "PROFILE_CLEAR") {
      clearProfile()
        .then(() => sendResponse({ ok: true }))
        .catch((err) => sendResponse({ error: err.message }));
      return true;
    }
    return false;
  });

  // No auto-harvest or floating badge — fill is explicit from the popup
  // so the page stays clean for the user.

  window.AegisAutofill = {
    prefillFromProfile,
    runPrefillAndPrompt,
    getProfile,
    saveProfileEntry,
    skipProfileKey,
    clearProfile,
    fillElement,
    undoAutofill,
    renderFloatingBadge,
    normalizeValue,
  };
})();
