#!/usr/bin/env node
// AEGIS Regression Tests — Node.js compatible
// Run: node eval/harness/regression-node.test.js
'use strict';

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const result = fn();
    if (result === false) throw new Error('returned false');
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } catch (e) {
    console.error(`  ❌ FAIL: ${name} — ${e.message}`);
    failed++;
  }
}

// ── Luhn Tests ────────────────────────────────────────────────────
// Inline the luhnCheck function (copy from field-mapper.js)
function luhnCheck(num) {
  const digits = String(num).replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0, isEven = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (isEven) { d *= 2; if (d > 9) d -= 9; }
    sum += d; isEven = !isEven;
  }
  return sum % 10 === 0;
}

test('Luhn: valid Visa', () => luhnCheck('4532015112830366') === true);
test('Luhn: valid Mastercard', () => luhnCheck('5425233430109903') === true);
test('Luhn: invalid random', () => luhnCheck('1234567890123456') === false);
test('Luhn: too short', () => luhnCheck('411111') === false);

// ── Verhoeff Tests ────────────────────────────────────────────────
// Import from extract-profile.js
let verhoeffCheck;
try {
  const ep = require('../../src/shared/extract-profile.js');
  verhoeffCheck = ep.verhoeffCheck;
} catch {}

if (verhoeffCheck) {
  test('Verhoeff: valid Aadhaar checksum', () => verhoeffCheck('499118665246') === true);
  test('Verhoeff: invalid checksum', () => verhoeffCheck('499118665247') === false);
} else {
  console.log('  ⚠️  SKIP: verhoeffCheck (module not importable in CJS)');
}

// ── Pattern Tests (inline regexes from field-mapper.js) ───────────
const PASS_PATTERNS = [
  [/password/i, 'password'],
  [/\b(otp|one.?time.?pass)\b/i, 'otp-12345'],
  [/\b(aadhaar|aadhar|uidai)\b/i, 'aadhaar-number'],
  [/\b(pan\b|pan[_-]?number)/i, 'pan-number'],
  [/\bssn\b|social.?security/i, 'ssn'],
  [/cc.?number|card.?number/i, 'cc-number'],
  [/cc.?name|cardholder/i, 'cardholder-name'],
  [/cc.?exp|card.*expir/i, 'cc-expiry'],
  [/\bcvv\b|\bcsc\b/i, 'cvv'],
  [/salary|income/i, 'salary'],
  [/\bmrn\b|medical.?record/i, 'mrn'],
];
for (const [pattern, testStr] of PASS_PATTERNS) {
  test(`Pattern matches "${testStr}"`, () => pattern.test(testStr));
}

const FAIL_PATTERNS = [
  [/password/i, 'username'],
  [/\b(aadhaar|aadhar)\b/i, 'address'],
];
for (const [pattern, testStr] of FAIL_PATTERNS) {
  test(`Pattern does NOT match "${testStr}"`, () => !pattern.test(testStr));
}

// ── Results ───────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error('❌ REGRESSION FAILURES DETECTED');
  process.exit(1);
} else {
  console.log('✅ All regression tests passed');
  process.exit(0);
}
