// Content Script — Injected into every active tab. Handles DOM interaction.

(() => {
  "use strict";

  // Same isolated world is reused for declarative + programmatic inject.
  // Skip a second copy (onInstalled re-inject + sendTabMessage retry).
  // After an extension reload the old world is orphaned; this flag is new.
  if (globalThis.__AEGIS_CONTENT_SCRIPT__) return;
  globalThis.__AEGIS_CONTENT_SCRIPT__ = true;

  // ── DOM Field Scanner (FR-02) ──────────────────────────────────

  const SENSITIVE_AUTOCOMPLETE = [
    "cc-number", "cc-exp", "cc-csc", "cc-name", "cc-type", "transaction-amount",
  ];

  const SENSITIVE_KEYWORDS = [
    "password", "pin", "secret", "ssn", "social-security",
    "credit", "card", "cvv", "csc", "otp", "aadhaar", "pan",
  ];

  // Tokenize on non-alphanumerics so "pin" matches portal_pin / confirm-pin
  // but not postal_code (substring false positive).
  function attributeTokens(el) {
    const raw = [
      el.name, el.id,
      el.getAttribute("aria-label"),
      el.getAttribute("data-testid"),
      el.placeholder,
    ].filter(Boolean).join(" ").toLowerCase();
    return new Set(raw.split(/[^a-z0-9]+/).filter(Boolean));
  }

  function scanDOMForSensitiveFields() {
    const fields = [];
    const seen = new Set();

    function addField(el, reason, type) {
      const sel = buildSelector(el);
      if (seen.has(sel)) return;
      seen.add(sel);
      const rect = el.getBoundingClientRect();
      // Skip off-screen / zero-size elements — they're not visible and
      // masking them would be wasteful.
      if (rect.width === 0 || rect.height === 0) return;
      fields.push({
        selector: sel,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        reason,
        type,
        label: el.labels?.[0]?.textContent?.trim() || el.placeholder || el.getAttribute("aria-label") || "",
      });
    }

    // Password inputs — 100% deterministic, no heuristics needed
    document.querySelectorAll('input[type="password"]').forEach((el) => {
      addField(el, 'type="password"', "password_input");
    });

    // Autocomplete-sensitive fields (credit card, etc.)
    document.querySelectorAll("input[autocomplete]").forEach((el) => {
      const ac = (el.autocomplete || "").toLowerCase();
      if (SENSITIVE_AUTOCOMPLETE.some((k) => ac.includes(k))) {
        addField(el, `autocomplete="${el.autocomplete}"`, "sensitive_input");
      }
    });

    // Keyword-based detection on name, id, aria-label, data-testid, placeholder
    document.querySelectorAll("input, textarea").forEach((el) => {
      const tokens = attributeTokens(el);
      const joined = [...tokens].join("-");
      if (SENSITIVE_KEYWORDS.some((k) => tokens.has(k) || (k.includes("-") && joined.includes(k)))) {
        addField(el, "keyword match in attributes", "sensitive_input");
      }
    });

    // Contenteditable divs with potential card numbers (16-digit sequences)
    document.querySelectorAll("[contenteditable]").forEach((el) => {
      const text = el.innerText || "";
      if (/\b\d{4}\s?\d{4}\s?\d{4}\s?\d{4}\b/.test(text)) {
        addField(el, "potential card number in contenteditable", "contenteditable_pii");
      }
    });

    return fields;
  }

  // Regular form controls (name, email, phone, …) are NOT in the sensitive
  // scan — that list exists to black-out passwords/cards. Fill still needs
  // every visible input's label + selector so we can map profile/vault
  // values without a 90s VLM round-trip per field.
  function isFillableFormControl(el) {
    if (!el || el.disabled || el.readOnly) return false;
    if (el.tagName === "INPUT") {
      const type = (el.type || "text").toLowerCase();
      return ![
        "hidden", "button", "submit", "reset", "image", "file",
        "checkbox", "radio", "password", "range", "color",
      ].includes(type);
    }
    return el.tagName === "SELECT" || el.tagName === "TEXTAREA";
  }

  function labelForFormControl(el) {
    if (el.labels?.[0]?.textContent?.trim()) return el.labels[0].textContent.trim();
    const aria = el.getAttribute("aria-label");
    if (aria && aria.trim()) return aria.trim();
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab?.textContent?.trim()) return lab.textContent.trim();
      } catch {
        /* invalid id */
      }
    }
    return (el.placeholder || el.name || el.id || "").trim();
  }

  function scanFillableFormFields() {
    const results = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("input, select, textarea")) {
      if (!isFillableFormControl(el)) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") continue;
      const selector = buildSelector(el);
      if (!selector || seen.has(selector)) continue;
      seen.add(selector);
      results.push({
        selector,
        label: labelForFormControl(el),
        type: "text_input",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      });
    }
    return results;
  }

  function filterFieldsForPasswordDetection(fields, passwordDetectionEnabled) {
    if (passwordDetectionEnabled !== false) return fields;
    return fields.filter((f) => f.type !== "password_input");
  }

  async function passwordDetectionEnabledFromStorage() {
    try {
      const { passwordDetection } = await chrome.storage.local.get(["passwordDetection"]);
      return passwordDetection !== false;
    } catch {
      return true;
    }
  }

  // ── Visible Text Extractor (for NER / regex PII) ───────────────

  function extractVisibleText() {
    const texts = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName?.toLowerCase();
        // Skip script/style content
        if (tag === "script" || tag === "style") return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
          return NodeFilter.FILTER_REJECT;
        const rect = parent.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return NodeFilter.FILTER_REJECT;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length < 3) continue; // skip single chars / punctuation
      const parent = node.parentElement;
      const rect = parent?.getBoundingClientRect();
      texts.push({
        text,
        rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        tag: parent?.tagName?.toLowerCase(),
      });
    }
    return texts;
  }

  // ── Helper: Build CSS Selector ──────────────────────────────────

  function buildSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    if (el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
    if (el.className && typeof el.className === "string") {
      const cls = el.className.trim().split(/\s+/).map(CSS.escape).join(".");
      if (cls) return `${el.tagName.toLowerCase()}.${cls}`;
    }
    // Fallback: nth-of-type path from body
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
        const siblings = Array.from(parent.children).filter((c) => c.tagName === current.tagName);
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(current) + 1})`;
        }
      }
      path.unshift(selector);
      current = current.parentElement;
    }
    return path.join(" > ");
  }

  // ── Action Executor ─────────────────────────────────────────────

  // The VLM only ever sees the sanitized screenshot, and
  // chrome.tabs.captureVisibleTab() produces that image at PHYSICAL pixel
  // resolution (CSS px x devicePixelRatio). elementFromPoint() takes CSS px,
  // so on any HiDPI display a raw model coordinate lands on the wrong element
  // — or past the viewport edge entirely, returning null. Try the model's
  // image frame first, then the raw value in case it already answered in CSS px.
  const CLICK_TARGET_SEL =
    "a, button, input, select, textarea, summary, label, [role='button'], [role='link'], [onclick]";

  function clickPoints(x, y) {
    const dpr = window.devicePixelRatio || 1;
    const points = [];
    if (dpr !== 1) points.push({ x: x / dpr, y: y / dpr, frame: "image" });
    points.push({ x, y, frame: "css" });
    return points;
  }

  function dispatchClick(el, point, dpr) {
    el.scrollIntoView({ block: "center" });
    el.focus?.();
    el.click();
    return {
      ok: true,
      clicked: el.tagName,
      selector: buildSelector(el),
      frame: point.frame,
      x: Math.round(point.x),
      y: Math.round(point.y),
      dpr,
    };
  }

  function executeClick(x, y) {
    const dpr = window.devicePixelRatio || 1;
    let generic = null;
    for (const point of clickPoints(x, y)) {
      const hit = document.elementFromPoint(point.x, point.y);
      if (!hit) continue;
      const tag = hit.tagName?.toLowerCase();
      // A hit on html/body means the coordinate frame was probably wrong;
      // keep it only as a last resort and let the other frame win.
      if (tag === "html" || tag === "body") {
        generic = generic || { el: hit, point };
        continue;
      }
      // Climb to the real control when the model aims at a button's inner
      // text node or padding rather than the control itself.
      return dispatchClick(hit.closest(CLICK_TARGET_SEL) || hit, point, dpr);
    }
    if (generic) return dispatchClick(generic.el, generic.point, dpr);
    return { error: `No element at (${x}, ${y}) in image or CSS pixel space (dpr=${dpr})` };
  }

  function executeType(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return { error: `Element not found: ${selector}` };
    // Bring the field into view so the fill is actually visible on screen.
    el.scrollIntoView({ block: "center" });
    el.focus();

    if (el.tagName === "SELECT") {
      const wanted = String(value).trim().toLowerCase();
      const option = Array.from(el.options).find(
        (o) => o.value.trim().toLowerCase() === wanted || o.text.trim().toLowerCase() === wanted
      );
      if (!option) return { error: `No <option> matching "${value}" in ${selector}` };
      el.value = option.value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, typed: option.value.length, selector };
    }

    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      return { ok: true, typed: value.length, selector };
    }

    // For React/Vue: nativeInputValueSetter bypasses the framework's
    // own setter so the synthetic event system picks up the change.
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      "value"
    )?.set;

    if (nativeInputValueSetter) {
      nativeInputValueSetter.call(el, value);
    } else {
      el.value = value;
    }

    // InputEvent (not bare Event) is what React/Vue synthetic event systems listen to.
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { ok: true, typed: value.length, selector };
  }

  function executeScroll(direction) {
    const delta = direction === "up" ? -window.innerHeight * 0.8 : window.innerHeight * 0.8;
    window.scrollBy({ top: delta, behavior: "smooth" });
    return { ok: true, scrolled: direction };
  }

  // ── Redaction Overlay ────────────────────────────────────────────
  // Injects a fixed-position overlay root into the page DOM.
  // Boxes are re-anchored from live element getBoundingClientRect() on
  // scroll/resize (rAF-throttled) so they cannot drift from their fields.
  //
  // Privacy: this overlay only reads field positions, never values.
  // It uses pointer-events:none so it doesn't interfere with page interaction.

  const OVERLAY_ROOT_ID = "sih26171-overlay-root";
  const OVERLAY_FIELDS_ID = "sih26171-overlay-fields";
  const OVERLAY_FACES_ID = "sih26171-overlay-faces";

  /** @type {{ el: Element, box: HTMLElement }[]} */
  let overlayAnchors = [];
  /** @type {{ el: Element, box: HTMLElement }[]} */
  let faceLiveAnchors = [];
  /** @type {{ docX: number, docY: number, width: number, height: number, box: HTMLElement }[]} */
  let fieldDocAnchors = [];
  /** @type {{ docX: number, docY: number, width: number, height: number, box: HTMLElement }[]} */
  let faceAnchors = [];
  let overlayRaf = 0;
  let overlayListenersAttached = false;

  // On-device models (BlazeFace + DistilBERT NER + regex) decide what is
  // private. Covers hide those regions on the live page. pointer-events:none.
  // The sanitized capture (offscreen) is a second hide for any VLM.
  const TYPE_COLORS = {
    password_input:      { border: "#16a34a", badge: "#16a34a", fill: "rgba(15, 23, 42, 0.92)" },
    sensitive_input:     { border: "#2563eb", badge: "#2563eb", fill: "rgba(15, 23, 42, 0.88)" },
    contenteditable_pii: { border: "#7c3aed", badge: "#7c3aed", fill: "rgba(15, 23, 42, 0.88)" },
    face:                { border: "#2563eb", badge: "#2563eb", fill: "rgba(15, 23, 42, 0.94)" },
  };
  const DEFAULT_COLOR = { border: "#64748b", badge: "#64748b", fill: "rgba(15, 23, 42, 0.88)" };

  function getOrCreateOverlayRoot() {
    let root = document.getElementById(OVERLAY_ROOT_ID);
    if (!root) {
      root = document.createElement("div");
      root.id = OVERLAY_ROOT_ID;
      Object.assign(root.style, {
        position: "fixed",
        top: "0",
        left: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: "2147483647",
        overflow: "hidden",
      });
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function ensureOverlayListeners() {
    if (overlayListenersAttached) return;
    overlayListenersAttached = true;
    const schedule = () => {
      if (overlayRaf) return;
      overlayRaf = requestAnimationFrame(() => {
        overlayRaf = 0;
        repositionOverlays();
      });
    };
    // capture:true so nested scroll containers still trigger re-anchor
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    window.addEventListener("resize", schedule, { passive: true });
    if (typeof visualViewport !== "undefined" && visualViewport) {
      visualViewport.addEventListener("resize", schedule, { passive: true });
      visualViewport.addEventListener("scroll", schedule, { passive: true });
    }
  }

  function applyBoxRect(box, x, y, width, height) {
    if (width <= 0 || height <= 0) {
      box.style.display = "none";
      return;
    }
    Object.assign(box.style, {
      display: "block",
      left: `${x}px`,
      top: `${y}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  function repositionLiveAnchors(anchors) {
    for (const { el, box } of anchors) {
      if (!el || !el.isConnected) {
        box.style.display = "none";
        continue;
      }
      const rect = el.getBoundingClientRect();
      applyBoxRect(box, rect.x, rect.y, rect.width, rect.height);
    }
  }

  function repositionDocAnchors(anchors) {
    const sx = window.scrollX || 0;
    const sy = window.scrollY || 0;
    for (const a of anchors) {
      applyBoxRect(a.box, a.docX - sx, a.docY - sy, a.width, a.height);
    }
  }

  function repositionOverlays() {
    repositionLiveAnchors(overlayAnchors);
    repositionLiveAnchors(faceLiveAnchors);
    repositionDocAnchors(fieldDocAnchors);
    repositionDocAnchors(faceAnchors);
  }

  function makeOverlayBox(type, labelText) {
    const colors = TYPE_COLORS[type] || DEFAULT_COLOR;
    const box = document.createElement("div");
    Object.assign(box.style, {
      position: "fixed",
      border: `1.5px solid ${colors.border}`,
      backgroundColor: colors.fill || "rgba(15, 23, 42, 0.88)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      boxSizing: "border-box",
      borderRadius: type === "face" ? "10px" : "6px",
      boxShadow: `0 0 0 1px ${colors.border}22`,
      pointerEvents: "none",
    });

    const badge = document.createElement("div");
    Object.assign(badge.style, {
      position: "absolute",
      top: "-14px",
      left: "4px",
      background: colors.badge || colors.border,
      color: "#fff",
      fontSize: "9px",
      fontFamily: "system-ui,sans-serif",
      fontWeight: "600",
      padding: "0 5px",
      borderRadius: "3px",
      whiteSpace: "nowrap",
      lineHeight: "14px",
      letterSpacing: "0.02em",
      opacity: "0.92",
    });
    badge.textContent = labelText;
    box.appendChild(badge);
    return box;
  }

  function getOverlayLayer(root, id) {
    let layer = document.getElementById(id);
    if (!layer) {
      layer = document.createElement("div");
      layer.id = id;
      Object.assign(layer.style, {
        position: "absolute",
        inset: "0",
        pointerEvents: "none",
      });
      root.appendChild(layer);
    }
    return layer;
  }

  function renderFieldOverlays(fields) {
    const root = getOrCreateOverlayRoot();
    const layer = getOverlayLayer(root, OVERLAY_FIELDS_ID);
    layer.innerHTML = "";
    overlayAnchors = [];
    fieldDocAnchors = [];

    for (const field of fields || []) {
      // Prefer live element so boxes track the real field, not a stale rect.
      const el = field.selector ? document.querySelector(field.selector) : null;
      const rect = el
        ? el.getBoundingClientRect()
        : field.rect;
      if (!rect || rect.width === 0 || rect.height === 0) continue;

      const typeLabel = {
        password_input: "Secured",
        sensitive_input: "Secured",
        contenteditable_pii: "Secured",
      }[field.type] || "Secured";

      const box = makeOverlayBox(field.type, typeLabel);
      layer.appendChild(box);

      if (el) {
        overlayAnchors.push({ el, box });
      } else {
        fieldDocAnchors.push({
          docX: rect.x + (window.scrollX || 0),
          docY: rect.y + (window.scrollY || 0),
          width: rect.width,
          height: rect.height,
          box,
        });
      }
    }

    ensureOverlayListeners();
    repositionOverlays();
  }

  function renderFaceOverlays(faces, dpr) {
    const root = getOrCreateOverlayRoot();
    const layer = getOverlayLayer(root, OVERLAY_FACES_ID);
    layer.innerHTML = "";
    faceAnchors = [];
    faceLiveAnchors = [];

    // Hide the face on the live page. Prefer the live photo element on TP08.
    // Idle browsing never calls this — no photo-alt heuristic on MutationObserver.
    const photoEl = document.querySelector("#applicant-photo, img.applicant-photo, img[alt*='photo' i], img[alt*='face' i]");
    if (photoEl) {
      const box = makeOverlayBox("face", "Secured");
      layer.appendChild(box);
      faceLiveAnchors.push({ el: photoEl, box });
    }
    const scale = typeof dpr === "number" && dpr > 0 ? dpr : 1;
    const sx = window.scrollX || 0;
    const sy = window.scrollY || 0;
    for (const face of faces || []) {
      const bbox = face.bbox || face;
      if (!Array.isArray(bbox) || bbox.length < 4) continue;
      const [x1, y1, x2, y2] = bbox;
      const width = (x2 - x1) / scale;
      const height = (y2 - y1) / scale;
      if (width <= 0 || height <= 0) continue;
      if (photoEl) {
        const pr = photoEl.getBoundingClientRect();
        const fx = x1 / scale;
        const fy = y1 / scale;
        const overlap =
          fx < pr.right && fx + width > pr.left && fy < pr.bottom && fy + height > pr.top;
        if (overlap) continue;
      }
      const box = makeOverlayBox("face", "Secured");
      layer.appendChild(box);
      faceAnchors.push({
        docX: x1 / scale + sx,
        docY: y1 / scale + sy,
        width,
        height,
        box,
      });
    }

    ensureOverlayListeners();
    repositionOverlays();
  }

  // includeFaces:false = idle (hide DOM password/PII fields; no BlazeFace).
  // includeFaces:true  = Privacy Scan / Run Agent (also hide faces).
  function showRedactionOverlay(fields, faces, dpr, options) {
    const includeFaces = !!(options && options.includeFaces);
    renderFieldOverlays(fields);
    if (includeFaces) {
      renderFaceOverlays(faces, dpr);
    }
  }

  function clearRedactionOverlay() {
    overlayAnchors = [];
    faceLiveAnchors = [];
    fieldDocAnchors = [];
    faceAnchors = [];
    const root = document.getElementById(OVERLAY_ROOT_ID);
    if (root) root.innerHTML = "";
  }

  // ── Privacy Risk Analyser (for badge score) ─────────────────────
  // Runs entirely in the content script — no screenshots, no network.
  // Returns a risk report consumed by the background to set the badge.

  function analysePageRisk() {
    const risks = [];
    let score = 100; // start perfect, deduct per risk

    // 1. HTTPS check
    if (location.protocol !== "https:" && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
      risks.push({ id: "no_https", label: "No HTTPS", severity: "high" });
      score -= 30;
    }

    // 2. Password fields in the open
    const pwdFields = document.querySelectorAll('input[type="password"]');
    if (pwdFields.length > 0) {
      risks.push({ id: "password_fields", label: `${pwdFields.length} password field(s)`, severity: "medium" });
      score -= Math.min(pwdFields.length * 10, 20);
    }

    // 3. Sensitive inputs (Aadhaar, PAN, SSN, card, OTP …)
    const sensitiveInputs = document.querySelectorAll("input, textarea");
    let sensitiveCount = 0;
    const SENSITIVE_RE = /aadhaar|aadhar|pan|ssn|social.sec|credit|card|cvv|otp|passport/i;
    sensitiveInputs.forEach((el) => {
      const haystack = [el.name, el.id, el.placeholder, el.getAttribute("aria-label"), el.getAttribute("data-testid")]
        .filter(Boolean).join(" ");
      if (SENSITIVE_RE.test(haystack)) sensitiveCount++;
    });
    if (sensitiveCount > 0) {
      risks.push({ id: "sensitive_inputs", label: `${sensitiveCount} sensitive input(s)`, severity: "high" });
      score -= Math.min(sensitiveCount * 15, 25);
    }

    // 4. External tracking scripts
    const scripts = Array.from(document.querySelectorAll("script[src]"));
    const TRACKER_DOMAINS = ["google-analytics", "googletagmanager", "doubleclick", "facebook.net",
      "hotjar", "clarity.ms", "mixpanel", "amplitude", "segment.io", "intercom"];
    const trackers = scripts.filter(s => TRACKER_DOMAINS.some(t => (s.src || "").includes(t)));
    if (trackers.length > 0) {
      risks.push({ id: "trackers", label: `${trackers.length} tracker script(s)`, severity: "medium" });
      score -= Math.min(trackers.length * 5, 15);
    }

    // 5. Pre-ticked consent / marketing checkboxes
    const preChecked = Array.from(document.querySelectorAll('input[type="checkbox"]:checked'))
      .filter(el => {
        const label = (el.labels?.[0]?.textContent || el.getAttribute("aria-label") || "").toLowerCase();
        return /market|promo|newslet|adverti|partner|third.party|consent|agree/i.test(label);
      });
    if (preChecked.length > 0) {
      risks.push({ id: "dark_patterns", label: `${preChecked.length} pre-ticked consent box(es)`, severity: "medium" });
      score -= Math.min(preChecked.length * 10, 15);
    }

    // 6. Visible Aadhaar / PAN numbers in plain text
    const bodyText = document.body?.innerText || "";
    const aadhaarMatches = bodyText.match(/\b\d{4}\s?\d{4}\s?\d{4}\b/g) || [];
    const panMatches = bodyText.match(/\b[A-Z]{5}\d{4}[A-Z]\b/g) || [];
    const piiInPage = aadhaarMatches.length + panMatches.length;
    if (piiInPage > 0) {
      risks.push({ id: "pii_exposed", label: `${piiInPage} ID number(s) visible`, severity: "high" });
      score -= Math.min(piiInPage * 20, 30);
    }

    score = Math.max(0, Math.min(100, Math.round(score)));
    let grade, color;
    if (score >= 85)      { grade = "A"; color = "#16a34a"; }
    else if (score >= 70) { grade = "B"; color = "#65a30d"; }
    else if (score >= 55) { grade = "C"; color = "#d97706"; }
    else if (score >= 35) { grade = "D"; color = "#ea580c"; }
    else                  { grade = "F"; color = "#dc2626"; }

    return { score, grade, color, risks,
      host: location.hostname || location.href,
      ts: Date.now() };
  }

  // ── Message Listener ────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "PAGE_RISK_SCAN") {
      sendResponse(analysePageRisk());
      return false;
    }

    if (msg.type === "DOM_SCAN") {
      const fields = scanDOMForSensitiveFields();
      const fillableFields = scanFillableFormFields();
      const visibleText = extractVisibleText();
      // dpr is critical: captureVisibleTab() returns physical pixels,
      // but getBoundingClientRect() returns CSS pixels.
      // The offscreen document multiplies all rects by dpr before drawing on canvas.
      // viewport x dpr is exactly the pixel size of the captureVisibleTab
      // image, which is the coordinate space the VLM must answer clicks in.
      sendResponse({
        fields,
        fillableFields,
        visibleText,
        dpr: window.devicePixelRatio || 1,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      });
      return false;
    }

    if (msg.type === "SHOW_REDACTION_OVERLAY") {
      showRedactionOverlay(msg.fields || [], msg.faces || [], msg.dpr, {
        includeFaces: msg.includeFaces === true,
      });
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "CLEAR_REDACTION_OVERLAY") {
      clearRedactionOverlay();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "REFRESH_IDLE_OVERLAY") {
      scheduleSensitiveRescan();
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "EXECUTE_CLICK") {
      sendResponse(executeClick(msg.x, msg.y));
      return false;
    }

    if (msg.type === "EXECUTE_TYPE") {
      sendResponse(executeType(msg.selector, msg.value));
      return false;
    }

    if (msg.type === "EXECUTE_SCROLL") {
      sendResponse(executeScroll(msg.direction));
      return false;
    }
  });

  // ── Dynamic re-detection (SPA / injected forms) ─────────────────
  // Local-only: re-scan sensitive *fields* and refresh the field overlay.
  // Never posts field values or screenshots to the VLM.
  // Never runs BlazeFace — face CV is Privacy Scan / Run Agent only.
  // Ignores mutations inside our own overlay so we cannot loop.

  const RESCAN_DEBOUNCE_MS = 400;
  let rescanTimer = null;

  function scheduleSensitiveRescan() {
    if (rescanTimer) clearTimeout(rescanTimer);
    rescanTimer = setTimeout(() => {
      rescanTimer = null;
      (async () => {
        try {
          const fields = scanDOMForSensitiveFields();
          const passwordOn = await passwordDetectionEnabledFromStorage();
          showRedactionOverlay(filterFieldsForPasswordDetection(fields, passwordOn), [], undefined, {
            includeFaces: false,
          });
        } catch {
          // Overlay refresh is best-effort; never throw into the page.
        }
      })();
    }, RESCAN_DEBOUNCE_MS);
  }

  function mutationTouchesOverlay(mutation) {
    const nodes = [mutation.target, ...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
    for (const n of nodes) {
      if (!n) continue;
      if (n.id === OVERLAY_ROOT_ID) return true;
      if (n.nodeType === 1 && typeof n.closest === "function" && n.closest(`#${OVERLAY_ROOT_ID}`)) {
        return true;
      }
    }
    return false;
  }

  const sensitiveObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (mutationTouchesOverlay(m)) continue;
      scheduleSensitiveRescan();
      return;
    }
  });

  if (document.documentElement) {
    sensitiveObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["type", "autocomplete", "name", "id", "aria-label", "placeholder"],
    });
  }

  console.log("[SIH26171] Content script loaded, DPR:", window.devicePixelRatio);
})();
