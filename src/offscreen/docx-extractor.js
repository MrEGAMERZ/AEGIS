// DOCX text extraction — fully on-device, zero network.
//
// A .docx is a ZIP archive. The body text lives in `word/document.xml` as a
// DEFLATE-compressed entry. Pipeline:
//   1. findZipEntry() — minimal ZIP reader (local headers, with a central
//      directory fallback for streaming writers) locates word/document.xml.
//   2. pako.inflate() — vendored src/vendor/pako/pako_inflate.min.js (~22 KB)
//      decompresses the entry. No JSZip — a ~30-line reader is enough.
//   3. DOMParser — pulls every <w:t> text run out of the OOXML body.
//
// pako is loaded as a SIDE-EFFECT import: pako_inflate.min.js is a UMD build
// that, when imported as a module, assigns globalThis.pako. This module is
// itself only ever imported dynamically (via document-extract.js), so pako is
// not loaded when the offscreen document opens — only when a real .docx is
// processed.
//
// extractDocxText(bytes, options) accepts optional { inflate, parseXml } so the
// Node harness can drive the REAL pipeline with a stubbed DOMParser + the same
// vendored pako file (browser uses their native counterparts).

import "../vendor/pako/pako_inflate.min.js"; // side effect → globalThis.pako in browser

const ENTRY_NAME = "word/document.xml";

const LFH_SIG = 0x04034b50; // local file header
const CEN_SIG = 0x02014b50; // central directory entry
const EOCD_SIG = 0x06054b50; // end of central directory

export async function extractDocxText(bytes, options = {}) {
  const entry = findZipEntry(bytes, ENTRY_NAME);
  if (!entry) {
    throw new Error(
      "DOCX_ZIP_MISSING: word/document.xml was not found — is this a real .docx (ZIP) file?"
    );
  }

  // ZIP entries are RAW DEFLATE (RFC 1951) — pako.inflateRaw is the
  // spec-compliant decompressor, NOT pako.inflate (that one expects the
  // zlib wrapper RFC 1950 and fails with "incorrect header check" on real
  // archives). A few non-compliant writers emit zlib-wrapped streams; retry
  // with pako.inflate once if the raw pass fails.
  const inflateRaw = options.inflateRaw || (globalThis.pako && globalThis.pako.inflateRaw) || options.inflate;
  const inflate = options.inflate || (globalThis.pako && globalThis.pako.inflate);
  if (typeof inflateRaw !== "function" && typeof inflate !== "function") {
    throw new Error("DOCX_NO_INFLATE: pako inflate is unavailable");
  }

  let xmlBytes;
  if (typeof inflateRaw === "function") {
    try {
      xmlBytes = inflateRaw(entry.compressed);
    } catch {
      if (typeof inflate === "function") xmlBytes = inflate(entry.compressed);
      else throw new Error("DOCX_INFLATE_FAILED: entry did not decompress");
    }
  } else {
    xmlBytes = inflate(entry.compressed);
  }

  const xml = new TextDecoder().decode(new Uint8Array(xmlBytes));
  return extractDocumentXmlText(xml, options.parseXml);
}

// ── OOXML → plain text ─────────────────────────────────────────────
// Paragraph (<w:p>) per line; every <w:t> run inside is concatenated so text
// split across runs (bold/italic segments) stays intact. Table cells contain
// their own <w:p> elements, so table content appears line-by-line too.
// Known simplification: <w:tab/> and <w:br/> inside a paragraph collapse to
// nothing (the demo formats never depend on them for profile extraction).
export function extractDocumentXmlText(xml, parseXml) {
  if (typeof parseXml !== "function") {
    if (typeof DOMParser !== "function") {
      throw new Error("DOCX_NO_DOM: DOMParser is unavailable");
    }
    parseXml = (s) => new DOMParser().parseFromString(s, "application/xml");
  }

  const doc = parseXml(xml);
  if (!doc || typeof doc.getElementsByTagName !== "function") {
    throw new Error("DOCX_BAD_XML: document.xml could not be parsed");
  }

  const paragraphs = collect(doc, "w:p");
  const lines = [];
  for (const p of paragraphs) {
    const runs = collect(p, "w:t");
    let line = "";
    for (const run of runs) line += run.textContent || "";
    lines.push(line);
  }

  return lines.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// collect(node, "w:t") returns the node's descendant <w:t>-style elements in
// document order. The primary path uses getElementsByTagName("w:t") — exact,
// namespace-prefix aware. If the document uses an unusual prefix (some
// writers rename the OOXML namespace), fall back to any element whose LOCAL
// name matches ("*:t" or bare "t").
function collect(node, name) {
  const wanted = name === "w:p" ? "p" : "t";
  const direct = node.getElementsByTagName(name);
  if (direct && direct.length > 0) return Array.from(direct);

  const all = node.getElementsByTagName("*");
  const out = [];
  for (const el of all) {
    const local = String(el.tagName || "").split(":").pop().toLowerCase();
    if (local === wanted) out.push(el);
  }
  return out;
}

// ── Minimal ZIP reader ─────────────────────────────────────────────
// Only what a .docx needs: find one named entry and hand back its compressed
// bytes. Returns null when the entry (or the archive structure) is missing.
export function findZipEntry(bytes, targetName) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 22) return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);

  // Pass 1 — walk local file headers. Fast path when the writer filled in the
  // local-header size fields (normal for Office-produced files).
  const local = scanLocalHeaders(view, b, targetName);
  if (local && local.compSize > 0) return local;

  // Pass 2 — central directory. Streaming writers leave local-header sizes at
  // 0 (data-descriptor flag) and put the REAL sizes in the central directory.
  return scanCentralDirectory(view, b, targetName);
}

function scanLocalHeaders(view, b, targetName) {
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= b.length) {
    if (view.getUint32(offset, true) !== LFH_SIG) return null;
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = decoder.decode(b.subarray(offset + 30, offset + 30 + nameLen));

    if (name === targetName) {
      return {
        name,
        method: view.getUint16(offset + 8, true),
        compressed: b.slice(
          offset + 30 + nameLen + extraLen,
          offset + 30 + nameLen + extraLen + compSize
        ),
        compSize,
      };
    }

    const dataStart = offset + 30 + nameLen + extraLen;
    if (dataStart >= b.length || compSize === 0) return null; // descriptor → central dir
    offset = dataStart + compSize;
  }
  return null;
}

function scanCentralDirectory(view, b, targetName) {
  const decoder = new TextDecoder();
  const eocd = findEocd(view, b);
  if (eocd === null) return null;

  const cdOffset = view.getUint32(eocd + 16, true);
  const cdSize = view.getUint32(eocd + 12, true);
  if (cdOffset >= b.length || cdOffset + cdSize > b.length) return null;

  let offset = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (offset + 46 <= cdEnd) {
    if (view.getUint32(offset, true) !== CEN_SIG) return null;
    const compSize = view.getUint32(offset + 20, true);
    const nameLen = view.getUint16(offset + 28, true);
    const extraLen = view.getUint16(offset + 30, true);
    const commentLen = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(b.subarray(offset + 46, offset + 46 + nameLen));

    if (name === targetName) {
      const lh = localHeaderFieldsAt(view, b, localOffset);
      if (!lh) return null;
      const dataStart = localOffset + 30 + lh.nameLen + lh.extraLen;
      return {
        name,
        method: view.getUint16(offset + 10, true),
        compressed: b.slice(dataStart, dataStart + compSize),
        compSize,
      };
    }

    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function localHeaderFieldsAt(view, b, offset) {
  if (offset < 0 || offset + 30 > b.length) return null;
  if (view.getUint32(offset, true) !== LFH_SIG) return null;
  return {
    nameLen: view.getUint16(offset + 26, true),
    extraLen: view.getUint16(offset + 28, true),
  };
}

function findEocd(view, b) {
  // EOCD sits in the last 22 + 65535 bytes (its comment field is ≤ 64 KB).
  const scanStart = Math.max(0, b.length - (22 + 65535));
  for (let i = b.length - 22; i >= scanStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return null;
}