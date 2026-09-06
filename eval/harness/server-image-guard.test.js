// server-image-guard.test.js — degenerate-image pre-flight guard in server/index.js
// Verifies the gateway rejects payloads whose images are below the VLM's 28px/axis
// minimum BEFORE forwarding (qwen2.5vl panics and kills the Ollama runner otherwise).
// Tests the REAL functions via module.exports — not a copy.

"use strict";

const { imageSizeFromBuffer, imageSizeFromDataUrl, findDegenerateImage, MIN_IMAGE_DIM } = require("../../server/index.js");

const checks = [];
let passed = 0, failed = 0;

function check(name, cond, detail) {
  checks.push({ name, ok: !!cond, detail: detail || "" });
  if (cond) passed++; else { failed++; console.error(`FAIL ${name} ${detail || ""}`); }
}

// Build a minimal PNG header (signature + IHDR) — the sniffer needs only the
// first 24 bytes; CRC validity is irrelevant to it.
function pngHeader(width, height) {
  const buf = Buffer.alloc(24);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  sig.forEach((b, i) => { buf[i] = b; });
  buf.writeUInt32BE(13, 8);          // IHDR chunk length
  buf.write("IHDR", 12, "ascii");    // chunk type
  buf.writeUInt32BE(width, 16);      // width
  buf.writeUInt32BE(height, 20);     // height
  return buf;
}

// Minimal JPEG: SOI + SOF0 marker with 1x1 dims.
function jpeg1x1() {
  const buf = Buffer.alloc(15);
  buf[0] = 0xff; buf[1] = 0xd8;               // SOI
  buf[2] = 0xff; buf[3] = 0xc0;               // SOF0
  buf.writeUInt16BE(11, 4);                   // segment length (sans marker)
  buf[6] = 8;                                 // precision
  buf.writeUInt16BE(1, 7);                    // height
  buf.writeUInt16BE(1, 9);                    // width
  return buf;
}

const BIG_PNG = pngHeader(128, 128);
const TINY_PNG = pngHeader(1, 1);
const NARROW_PNG = pngHeader(128, 12); // below 28 on one axis only

// ---- unit: buffer sniffing ----
check("png 128x128 sniffed", imageSizeFromBuffer(BIG_PNG)?.width === 128 && imageSizeFromBuffer(BIG_PNG)?.height === 128, JSON.stringify(imageSizeFromBuffer(BIG_PNG)));
check("png 1x1 sniffed", imageSizeFromBuffer(TINY_PNG)?.width === 1 && imageSizeFromBuffer(TINY_PNG)?.height === 1, JSON.stringify(imageSizeFromBuffer(TINY_PNG)));
check("jpeg 1x1 sniffed", imageSizeFromBuffer(jpeg1x1())?.width === 1 && imageSizeFromBuffer(jpeg1x1())?.height === 1, JSON.stringify(imageSizeFromBuffer(jpeg1x1())));
check("empty buffer -> null", imageSizeFromBuffer(Buffer.alloc(0)) === null);
check("garbage buffer -> null", imageSizeFromBuffer(Buffer.from("hello world this is not an image at all")) === null);

// ---- unit: data URL wrapper ----
const tinyDataUrl = `data:image/png;base64,${TINY_PNG.toString("base64")}`;
const bigDataUrl = `data:image/png;base64,${BIG_PNG.toString("base64")}`;
check("data URL 1x1", imageSizeFromDataUrl(tinyDataUrl)?.width === 1, JSON.stringify(imageSizeFromDataUrl(tinyDataUrl)));
check("data URL 128x128", imageSizeFromDataUrl(bigDataUrl)?.width === 128);
check("non-image URL -> null", imageSizeFromDataUrl("https://example.com/x.png") === null);
check("junk base64 -> null", imageSizeFromDataUrl("data:image/png;base64,!!!!!") === null);

// ---- unit: payload walk ----
const antipatterns = [
  {
    name: "OpenAI content block, 1x1 data URL",
    payload: { model: "x", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: tinyDataUrl } }] }] },
    expect: "degenerate",
  },
  {
    name: "OpenAI content block, 128x128 data URL",
    payload: { model: "x", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: bigDataUrl } }] }] },
    expect: "clean",
  },
  {
    name: "Narrow 128x12 (one axis below min)",
    payload: { model: "x", messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/png;base64,${NARROW_PNG.toString("base64")}` } }] }] },
    expect: "degenerate",
  },
  {
    name: "Ollama-style images array, raw base64 1x1",
    payload: { model: "x", messages: [{ role: "user", content: "desc", images: [TINY_PNG.toString("base64")] }] },
    expect: "degenerate",
  },
  {
    name: "Ollama-style images array, 128x128",
    payload: { model: "x", messages: [{ role: "user", content: "desc", images: [BIG_PNG.toString("base64")] }] },
    expect: "clean",
  },
  {
    name: "Text-only payload",
    payload: { model: "x", messages: [{ role: "user", content: "hello" }] },
    expect: "clean",
  },
  {
    name: "Malformed payload (no messages)",
    payload: { nothing: true },
    expect: "clean",
  },
];

for (const t of antipatterns) {
  const hit = findDegenerateImage(t.payload);
  if (t.expect === "degenerate") {
    check(`${t.name} -> rejected`, hit !== null && (hit.width < MIN_IMAGE_DIM || hit.height < MIN_IMAGE_DIM), JSON.stringify(hit));
    check(`${t.name} -> reports messageIndex`, hit !== null && typeof hit.messageIndex === "number", JSON.stringify(hit));
  } else {
    check(`${t.name} -> allowed`, hit === null, JSON.stringify(hit));
  }
}

// ---- summary ----
console.log(`${passed} checks: ${passed} passed, ${failed} failed.`);
console.log(`MIN_IMAGE_DIM = ${MIN_IMAGE_DIM} (qwen2.5vl vision encoder minimum)`);
if (failed > 0) {
  console.error(checks.filter((c) => !c.ok).map((c) => ` - ${c.name}`).join("\n"));
  process.exit(1);
}