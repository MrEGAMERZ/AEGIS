// Content Script — Injected into every active tab. Handles DOM interaction.

(() => {
  "use strict";

  // ── DOM Field Scanner (FR-02) ──────────────────────────────────

  const SENSITIVE_AUTOCOMPLETE = [
    "cc-number", "cc-exp", "cc-csc", "cc-name", "cc-type", "transaction-amount",
  ];

  const SENSITIVE_KEYWORDS = [
    "password", "pin", "secret", "ssn", "social-security",
    "credit", "card", "cvv", "csc", "otp", "aadhaar", "pan",
  ];

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
      const attrs = [
        el.name, el.id,
        el.getAttribute("aria-label"),
        el.getAttribute("data-testid"),
        el.placeholder,
      ].filter(Boolean).join(" ").toLowerCase();
      if (SENSITIVE_KEYWORDS.some((k) => attrs.includes(k))) {
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

  function executeClick(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el) return { error: `No element at (${x}, ${y})` };
    el.scrollIntoView({ block: "center" });
    el.focus?.();
    el.click();
    return { ok: true, clicked: el.tagName, selector: buildSelector(el) };
  }

  function executeType(selector, value) {
    const el = document.querySelector(selector);
    if (!el) return { error: `Element not found: ${selector}` };
    el.focus();

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
  // Renders colored outline boxes over sensitive fields so the user can
  // see what has been identified for redaction before the VLM call.
  //
  // Privacy: this overlay only reads field positions, never values.
  // It uses pointer-events:none so it doesn't interfere with page interaction.

  const OVERLAY_ROOT_ID = "sih26171-overlay-root";

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

  function showRedactionOverlay(fields) {
    const root = getOrCreateOverlayRoot();
    root.innerHTML = ""; // clear previous

    const TYPE_COLORS = {
      password_input:    { bg: "rgba(255,50,50,0.15)",  border: "#ff3232" },
      sensitive_input:   { bg: "rgba(255,140,0,0.12)",  border: "#ff8c00" },
      contenteditable_pii: { bg: "rgba(220,50,220,0.12)", border: "#dc32dc" },
    };
    const DEFAULT_COLOR = { bg: "rgba(255,200,0,0.12)", border: "#ffc800" };

    for (const field of fields) {
      const { x, y, width, height } = field.rect;
      if (width === 0 || height === 0) continue;

      const colors = TYPE_COLORS[field.type] || DEFAULT_COLOR;

      // Outer box
      const box = document.createElement("div");
      Object.assign(box.style, {
        position: "fixed",
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        border: `2px solid ${colors.border}`,
        backgroundColor: colors.bg,
        boxSizing: "border-box",
      });

      // Label badge
      const badge = document.createElement("div");
      const typeLabel = {
        password_input: "🔒 Password",
        sensitive_input: "🔒 Sensitive",
        contenteditable_pii: "🔒 Card data",
      }[field.type] || "🔒 Redacted";

      Object.assign(badge.style, {
        position: "absolute",
        top: "-18px",
        left: "0",
        background: colors.border,
        color: "#fff",
        fontSize: "10px",
        fontFamily: "monospace",
        padding: "1px 5px",
        borderRadius: "3px",
        whiteSpace: "nowrap",
        lineHeight: "16px",
      });
      badge.textContent = typeLabel;

      box.appendChild(badge);
      root.appendChild(box);
    }
  }

  function clearRedactionOverlay() {
    const root = document.getElementById(OVERLAY_ROOT_ID);
    if (root) root.innerHTML = "";
  }

  // ── Message Listener ────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "DOM_SCAN") {
      const fields = scanDOMForSensitiveFields();
      const visibleText = extractVisibleText();
      // dpr is critical: captureVisibleTab() returns physical pixels,
      // but getBoundingClientRect() returns CSS pixels.
      // The offscreen document multiplies all rects by dpr before drawing on canvas.
      sendResponse({ fields, visibleText, dpr: window.devicePixelRatio || 1 });
      return false;
    }

    if (msg.type === "SHOW_REDACTION_OVERLAY") {
      showRedactionOverlay(msg.fields || []);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === "CLEAR_REDACTION_OVERLAY") {
      clearRedactionOverlay();
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

  console.log("[SIH26171] Content script loaded, DPR:", window.devicePixelRatio);
})();
