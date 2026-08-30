/**
 * Aegis — Regression test for the `normalizeProfile()` profile-injection fix
 * eval/harness/normalize-profile.test.js
 *
 * BACKGROUND
 * ----------
 * Original bug (see engineers/evaluation/work_done.md, 2026-08-XX FAIL entry):
 *   background.js did `Object.entries(userProfile)` where `userProfile` was a
 *   raw string, producing character-indexed garbage in the VLM prompt
 *   (e.g. "0: M, 1: y, 2: ...") instead of real field:value pairs.
 *
 * Reported fix: a new `normalizeProfile(raw)` helper that accepts a JSON
 * object, a JSON-encoded object string, legacy free text, or empty input,
 * and always returns a flat {key: value} map.
 *
 * IMPORTANT PROVENANCE NOTE (read before trusting this file blindly)
 * -------------------------------------------------------------------
 * `normalizeProfile` did NOT exist in src/background/background.js on the
 * `main` working tree at the start of this eval session (verified by
 * direct grep + git diff HEAD). It was copied verbatim at that time from
 * `cursor/remove-ds-store-files` @ commit 0b06663 ("checkpoint before
 * checking out main"), which was not merged into main.
 *
 * Partway through the same session, the working tree's background.js was
 * updated (staged, not yet committed on main — see
 * engineers/evaluation/work_done.md, 2026-08-28 entry) to match this same
 * implementation. As of the final run of this file, the copy below is
 * character-identical to the live src/background/background.js. Still,
 * treat this file as the source of truth for the ALGORITHM under test —
 * always diff it against the current src/background/background.js before
 * trusting a PASS here as evidence about the shipped file, since the two
 * can drift again.
 *
 * USAGE
 * -----
 *   node eval/harness/normalize-profile.test.js
 *
 * DEPENDENCIES: none (pure Node, no npm packages).
 */

"use strict";

// ── normalizeProfile — copied verbatim from cursor/remove-ds-store-files ──
// (git show cursor/remove-ds-store-files:src/background/background.js, lines 100-142)

function normalizeProfile(raw) {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    // JSON object string
    let candidate = null;
    try {
      candidate = JSON.parse(trimmed);
    } catch {
      candidate = null;
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return normalizeProfile(candidate);
    }
    if (candidate !== null) return {}; // valid JSON but not an object (array/scalar)
    // Free text: try structured `Key: value` lines, else wrap as raw blob
    const entries = {};
    let ok = true;
    let sawAny = false;
    for (const line of trimmed.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue; // tolerate blank lines
      const m = t.match(/^\s*([^:]+?)\s*:\s*(.+?)\s*$/);
      if (!m || !m[1].trim() || !m[2].trim()) { ok = false; break; }
      entries[m[1].trim()] = m[2].trim();
      sawAny = true;
    }
    if (ok && sawAny) return entries;
    return { raw: trimmed };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "object" ? safeStringify(v) : String(v);
  }
  return out;
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// ── Old buggy behavior, for regression contrast ────────────────────
// This is what main's original bug report described: Object.entries()
// called directly on the raw stored value.

function oldBuggyBehavior(raw) {
  return Object.entries(raw);
}

// ── Test cases ──────────────────────────────────────────────────────

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }
function deepEqual(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

test("JSON object input -> passthrough as {key: value}", () => {
  const input = { "Full Name": "Alice Smith", email: "alice@example.com" };
  const out = normalizeProfile(input);
  return deepEqual(out, { "Full Name": "Alice Smith", email: "alice@example.com" });
});

test("JSON object string input -> parsed into {key: value}", () => {
  const input = '{"Full Name": "Alice Smith", "phone": "555-1234"}';
  const out = normalizeProfile(input);
  return deepEqual(out, { "Full Name": "Alice Smith", phone: "555-1234" });
});

test("Legacy raw text 'Key: value' lines -> parsed into {key: value}", () => {
  const input = "Name: Alice Smith\nEmail: alice@example.com\nPhone: 555-1234";
  const out = normalizeProfile(input);
  return deepEqual(out, { Name: "Alice Smith", Email: "alice@example.com", Phone: "555-1234" });
});

test("Free text with no ':' separators -> wrapped as {raw: <text>}, not char-indexed", () => {
  const input = "My name is Rehan and I like turtles";
  const out = normalizeProfile(input);
  // The critical regression check: must NOT look like Object.entries("...")
  // which would produce {"0":"M","1":"y",...}. Must be a single 'raw' key.
  const looksCharIndexed = Object.keys(out).some((k) => /^\d+$/.test(k));
  return !looksCharIndexed && out.raw === input;
});

test("Empty string input -> {}", () => {
  return deepEqual(normalizeProfile(""), {});
});

test("Whitespace-only string input -> {}", () => {
  return deepEqual(normalizeProfile("   \n  "), {});
});

test("null input -> {}", () => {
  return deepEqual(normalizeProfile(null), {});
});

test("undefined input -> {}", () => {
  return deepEqual(normalizeProfile(undefined), {});
});

test("Array input -> {} (not a valid profile shape)", () => {
  return deepEqual(normalizeProfile(["a", "b"]), {});
});

test("JSON array string input -> {} (valid JSON, not an object)", () => {
  return deepEqual(normalizeProfile("[1,2,3]"), {});
});

test("Nested object value -> stringified, never crashes", () => {
  const input = { address: { city: "Pune", zip: "411001" } };
  const out = normalizeProfile(input);
  return typeof out.address === "string" && out.address.includes("Pune");
});

test("Numeric/boolean values coerced to strings", () => {
  const input = { age: 30, subscribed: true };
  const out = normalizeProfile(input);
  return out.age === "30" && out.subscribed === "true";
});

test("REGRESSION: char-indexed prompt bug does NOT reproduce for a plain string profile", () => {
  // This is the exact bug scenario: userProfile stored as a plain string.
  const rawStoredProfile = "Alice Smith, alice@example.com, 555-1234";
  const buggyOutputShape = oldBuggyBehavior(rawStoredProfile); // [['0','A'],['1','l'],...]
  const fixedOutput = normalizeProfile(rawStoredProfile);

  const buggyIsCharIndexed = buggyOutputShape.length > 0 && buggyOutputShape[0][0] === "0";
  const fixedIsCharIndexed = Object.keys(fixedOutput).some((k) => /^\d+$/.test(k));

  // Prove the bug WOULD reproduce with the old code path (sanity check the test itself)...
  if (!buggyIsCharIndexed) return false;
  // ...and prove the fix does NOT exhibit it.
  return !fixedIsCharIndexed;
});

// ── Runner ──────────────────────────────────────────────────────────

let pass = 0;
let fail = 0;
for (const { name, fn } of cases) {
  let ok = false;
  let err = null;
  try {
    ok = !!fn();
  } catch (e) {
    err = e;
  }
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${err ? `  (threw: ${err.message})` : ""}`);
  }
}

console.log(`\n${pass}/${cases.length} passed, ${fail} failed`);
console.log(
  fail === 0
    ? "normalizeProfile() logic is CORRECT for all tested cases."
    : "normalizeProfile() logic has regressions — do not merge/ship as-is."
);
console.log(
  "\nReminder: this tests the ALGORITHM in isolation (copied into this file), not a live import of " +
  "src/background/background.js. Diff the embedded copy above against the current background.js before " +
  "trusting this PASS as evidence about the shipped file. See engineers/evaluation/work_done.md for merge/commit status."
);

process.exit(fail === 0 ? 0 : 1);
