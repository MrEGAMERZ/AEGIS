/**
 * document-extract.test.js — on-device document ingestion pipeline
 *
 * Covers (all against the REAL shipped modules, no copied algorithms):
 *   1. src/shared/file-helpers.js      — format detection + base64 roundtrip
 *   2. src/offscreen/document-extract.js — router (txt/json/csv/md decode,
 *      docx/pdf dispatch) with a real base64 payload
 *   3. src/offscreen/docx-extractor.js — real ZIP parsing (local-header AND
 *      central-directory paths) + pako inflate + OOXML → text
 *   4. src/offscreen/pdf-extractor.js  — REAL pdf.js (vendored pdf.min.mjs +
 *      pdf.worker.min.mjs) extracting a real fixture PDF with a text layer
 *   5. Contract wires — EXTRACT_DOCUMENT_TEXT handler in background.js and
 *      offscreen.js; pdf.js/pako are NOT statically loaded by offscreen.js or
 *      popup.js (lazy-load acceptance); workerSrc is a same-origin extension
 *      URL (no network for worker discovery).
 *
 * Node-only gaps (explained, not hidden):
 *   - Node has no Uint8Array.prototype.toHex (a Chrome 137+ API pdf.js v6
 *     uses); the test polyfills it ONLY when missing. Chrome 152 (the shipped
 *     target) has it natively.
 *   - Node has no DOMParser; the docx test drives the REAL extractDocumentXmlText
 *     with a ~35-line stand-in implementing the exact surface the function
 *     uses (getElementsByTagName + textContent). The browser path uses the
 *     real DOMParser (offscreen document is created with reason DOM_PARSER).
 *
 * USAGE: node eval/harness/document-extract.test.js
 * DEPENDENCIES: node core + adm-zip (already in root node_modules) + the
 * vendored files under src/vendor/ (pdfjs/, pako/).
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");
const HELPERS_PATH = pathToFileURL(path.join(ROOT, "src", "shared", "file-helpers.js")).href;
const ROUTER_PATH = pathToFileURL(path.join(ROOT, "src", "offscreen", "document-extract.js")).href;
const DOCX_PATH = pathToFileURL(path.join(ROOT, "src", "offscreen", "docx-extractor.js")).href;
const PDF_PATH = pathToFileURL(path.join(ROOT, "src", "offscreen", "pdf-extractor.js")).href;
const PDFJS_MAIN = path.join(ROOT, "src", "vendor", "pdfjs", "pdf.min.mjs");
const PDFJS_WORKER = pathToFileURL(path.join(ROOT, "src", "vendor", "pdfjs", "pdf.worker.min.mjs")).href;
const PAKO = path.join(ROOT, "src", "vendor", "pako", "pako_inflate.min.js");

const pako = require(PAKO); // UMD — CJS require works in Node; browser sets globalThis.pako.

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

async function main() {
  console.log("Aegis — on-device document ingestion pipeline\n");

  // ═══════════════ 1. file-helpers ═══════════════
  console.log("1. detectDocFormat + base64 helpers");
  const helpers = await import(HELPERS_PATH);
  const { detectDocFormat, base64ToBytes, toBase64, MAX_DOCUMENT_BYTES } = helpers;

  check("pdf by extension", detectDocFormat("resume.pdf", "application/octet-stream") === "pdf");
  check("pdf by mime", detectDocFormat("resume", "application/pdf") === "pdf");
  check("docx by extension", detectDocFormat("bio.docx", "application/zip") === "docx");
  check(
    "docx by mime",
    detectDocFormat("bio", "application/vnd.openxmlformats-officedocument.wordprocessingml.document") === "docx"
  );
  check("txt by extension", detectDocFormat("notes.txt", "") === "text");
  check("txt by mime", detectDocFormat("notes", "text/plain") === "text");
  check("json by extension", detectDocFormat("profile.json", "text/plain") === "json");
  check("json by mime", detectDocFormat("p", "application/json") === "json");
  check("csv by extension", detectDocFormat("data.csv", "") === "csv");
  check("csv by mime", detectDocFormat("data", "text/csv") === "csv");
  check("md by extension", detectDocFormat("README.md", "") === "md");
  check("md by mime", detectDocFormat("README", "text/markdown") === "md");
  check("uppercase extension", detectDocFormat("RESUME.PDF", "") === "pdf");
  check("unsupported png -> null", detectDocFormat("photo.png", "image/png") === null);
  check("unsupported doc -> null", detectDocFormat("old.doc", "application/msword") === null);
  check("cap is 15 MB", MAX_DOCUMENT_BYTES === 15 * 1024 * 1024);

  const roundtripBytes = new Uint8Array(300 * 1024); // crosses the 32 KB chunk
  for (let i = 0; i < roundtripBytes.length; i++) roundtripBytes[i] = (i * 7) % 256;
  const file = new File([roundtripBytes.buffer], "sample.bin", { type: "application/octet-stream" });
  const b64 = await toBase64(file);
  check("toBase64 returns base64 string", typeof b64 === "string" && b64.length > 0);
  const back = base64ToBytes(b64);
  check(
    "base64 roundtrip byte-exact",
    back.length === roundtripBytes.length &&
      back.every((v, i) => v === roundtripBytes[i])
  );
  check("base64ToBytes empty -> empty", base64ToBytes("").length === 0);

  // ═══════════════ 2. Router: text formats ═══════════════
  console.log("\n2. document-extract router (text formats, real module)");
  const router = await import(ROUTER_PATH);
  const { extractDocumentText } = router;

  const txtPayload = Buffer.from("Name: Ravi Kumar\nEmail: ravi@test.com").toString("base64");
  const txtRes = await extractDocumentText({ name: "notes.txt", mimeType: "text/plain", arrayBufferBase64: txtPayload });
  check("txt -> format 'text'", txtRes.format === "text");
  check("txt -> decoded text", txtRes.text.includes("ravi@test.com") && txtRes.text.startsWith("Name:"));

  const jsonRes = await extractDocumentText({
    name: "profile.json",
    mimeType: "application/json",
    arrayBufferBase64: Buffer.from('{"fullName":"Ananya Krishnan","email":"ananya@example.com"}').toString("base64"),
  });
  check("json -> format 'json'", jsonRes.format === "json");
  check(
    "json -> exact JSON text preserved",
    jsonRes.text === '{"fullName":"Ananya Krishnan","email":"ananya@example.com"}',
    JSON.stringify(jsonRes.text)
  );
  check("json -> parses to object", JSON.parse(jsonRes.text).fullName === "Ananya Krishnan");

  const csvRes = await extractDocumentText({
    name: "data.csv",
    mimeType: "text/csv",
    arrayBufferBase64: Buffer.from("name,email\nRavi,ravi@x.com\n").toString("base64"),
  });
  check("csv -> format 'csv'", csvRes.format === "csv");
  check("csv -> text preserved", csvRes.text.startsWith("name,email"));

  const mdRes = await extractDocumentText({
    name: "README.md",
    mimeType: "",
    arrayBufferBase64: Buffer.from("# Aegis\nOn-device privacy.").toString("base64"),
  });
  check("md -> format 'md'", mdRes.format === "md");
  check("md -> text preserved", mdRes.text.includes("On-device privacy."));

  let unsupportedThrew = false;
  try {
    await extractDocumentText({ name: "photo.png", mimeType: "image/png", arrayBufferBase64: "aGk=" });
  } catch (e) { unsupportedThrew = e.message.includes("DOC_EXTRACT_UNSUPPORTED"); }
  check("unsupported format throws DOC_EXTRACT_UNSUPPORTED", unsupportedThrew);

  let noFileThrew = false;
  try {
    await extractDocumentText({ name: "a.txt", mimeType: "text/plain", arrayBufferBase64: "" });
  } catch (e) { noFileThrew = e.message.includes("DOC_EXTRACT_NO_FILE"); }
  check("empty payload throws DOC_EXTRACT_NO_FILE", noFileThrew);

  // ═══════════════ 3. DOCX pipeline ═══════════════
  console.log("\n3. DOCX extraction (real ZIP + pako + OOXML parser)");
  const docxMod = await import(DOCX_PATH);
  const { findZipEntry, extractDocxText, extractDocumentXmlText } = docxMod;

  // Build a REAL .docx archive with adm-zip (proper local headers AND
  // central directory, DEFLATE method) — same structure Office writes.
  const AdmZip = require("adm-zip");
  const DOCX_XML =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    "<w:body>" +
    "<w:p><w:r><w:t>Full Name: Ananya </w:t></w:r><w:r><w:t>Krishnan</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Email: ananya@example.com</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Phone: 9876543210</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t></w:t></w:r></w:p>" +
    "</w:body></w:document>";
  const zip = new AdmZip();
  zip.addFile("word/document.xml", Buffer.from(DOCX_XML, "utf8"));
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
  );
  const docxBytes = zip.toBuffer();

  const entry = findZipEntry(docxBytes, "word/document.xml");
  check("findZipEntry locates word/document.xml", !!entry && entry.name === "word/document.xml");
  check("entry is DEFLATE (method 8)", entry && entry.method === 8);
  check("entry has compressed size", entry && entry.compSize > 0);

  const xmlFromZip = new TextDecoder().decode(new Uint8Array(pako.inflateRaw(entry.compressed)));
  check("pako inflateRaw -> OOXML contains w:t runs", xmlFromZip.includes("<w:t>Full Name: Ananya ") && xmlFromZip.includes("9876543210"));

  // The real extractDocumentXmlText, driven by a documented DOMParser stand-in
  // (Node has no DOMParser; the browser offscreen document uses the real one).
  const parsed = extractDocumentXmlText(DOCX_XML, stubParseXml);
  check(
    "XML -> paragraph text, split runs concatenated",
    parsed === "Full Name: Ananya Krishnan\nEmail: ananya@example.com\nPhone: 9876543210",
    JSON.stringify(parsed)
  );

  // Cross-dispatch through the REAL router (document-extract → docx-extractor):
  const docxRes = await extractDocumentText(
    {
      name: "profile.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      arrayBufferBase64: Buffer.from(docxBytes).toString("base64"),
    },
    { inflateRaw: pako.inflateRaw, parseXml: stubParseXml }
  );
  check("router docx -> format 'docx'", docxRes.format === "docx");
  check(
    "router docx -> full text",
    docxRes.text === "Full Name: Ananya Krishnan\nEmail: ananya@example.com\nPhone: 9876543210",
    JSON.stringify(docxRes.text)
  );

  // Central-directory fallback: zero the LOCAL header's compSize (what a
  // streaming zip writer does, with the real sizes in the central dir).
  const lhOffset = localHeaderOffsetOf(docxBytes, "word/document.xml");
  const doctored = Buffer.from(docxBytes);
  doctored.writeUInt32LE(0, lhOffset + 18); // compSize := 0 in local header
  const viaCentral = findZipEntry(doctored, "word/document.xml");
  check(
    "central-directory fallback returns the entry (local compSize=0)",
    !!viaCentral && viaCentral.compSize > 0 && viaCentral.name === "word/document.xml"
  );

  check("corrupt zip -> null entry", findZipEntry(new Uint8Array(128).fill(7), "word/document.xml") === null);
  let corruptThrew = false;
  try {
    await extractDocumentText({ name: "bad.docx", mimeType: "", arrayBufferBase64: Buffer.from("not a zip at all").toString("base64") }, { inflateRaw: pako.inflateRaw, parseXml: stubParseXml });
  } catch (e) { corruptThrew = e.message.includes("DOCX_ZIP_MISSING"); }
  check("corrupt docx throws DOCX_ZIP_MISSING", corruptThrew);

  // Unusual namespace prefix fallback (local-name matching).
  const weirdXml = '<d:document xmlns:d="urn:x"><d:body><d:p><d:r><d:t>Alien prefix</d:t></d:r></d:p></d:body></d:document>';
  check("non-w: namespace prefix still extracted", extractDocumentXmlText(weirdXml, stubParseXml) === "Alien prefix");

  // ═══════════════ 4. PDF pipeline (real pdf.js) ═══════════════
  console.log("\n4. PDF extraction (real vendored pdf.js on a real fixture PDF)");
  check("pdf.js main vendored", fs.existsSync(PDFJS_MAIN) && fs.statSync(PDFJS_MAIN).size > 100000);
  check(
    "pdf.js worker vendored next to main",
    fs.existsSync(path.join(ROOT, "src", "vendor", "pdfjs", "pdf.worker.min.mjs"))
  );

  // Node-only gap: toHex is a Chrome 137+ API pdf.js v6 uses. Chrome 152 (the
  // shipped browser target) has it natively; the polyfill is test-env only.
  if (typeof Uint8Array.prototype.toHex !== "function") {
    Uint8Array.prototype.toHex = function () {
      let s = "";
      for (let i = 0; i < this.length; i++) s += this[i].toString(16).padStart(2, "0");
      return s;
    };
  }

  const pdfjsLib = await import(pathToFileURL(PDFJS_MAIN).href);
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER; // same-origin vendored worker

  const pdfBytes = buildFixturePdf([
    "Name: Ananya Krishnan",
    "Email: ananya@example.com",
    "Phone: 9876543210",
  ]);
  const pdfRes = await extractDocumentText(
    {
      name: "profile.pdf",
      mimeType: "application/pdf",
      arrayBufferBase64: Buffer.from(pdfBytes).toString("base64"),
    },
    { pdfjsLib }
  );
  check("pdf -> format 'pdf'", pdfRes.format === "pdf");
  check("pdf -> extracts name line", pdfRes.text.includes("Ananya Krishnan"), JSON.stringify(pdfRes.text));
  check("pdf -> extracts email", pdfRes.text.includes("ananya@example.com"));
  check("pdf -> extracts phone", pdfRes.text.includes("9876543210"));

  let badPdfThrew = false;
  try {
    await extractDocumentText(
      { name: "broken.pdf", mimeType: "application/pdf", arrayBufferBase64: Buffer.from("garbage").toString("base64") },
      { pdfjsLib }
    );
  } catch (e) { badPdfThrew = /PDF_PARSE_FAILED|PDFJS_LOAD_FAILED/.test(e.message); }
  check("corrupt pdf throws PDF_PARSE_FAILED", badPdfThrew);

  // ═══════════════ 5. Contract + laziness wires ═══════════════
  console.log("\n5. Message contract + lazy-load wiring (source inspection)");
  const bgSrc = fs.readFileSync(path.join(ROOT, "src", "background", "background.js"), "utf8");
  const offSrc = fs.readFileSync(path.join(ROOT, "src", "offscreen", "offscreen.js"), "utf8");
  const popupSrc = fs.readFileSync(path.join(ROOT, "src", "popup", "popup.js"), "utf8");
  const popupHtml = fs.readFileSync(path.join(ROOT, "src", "popup", "popup.html"), "utf8");
  const routerSrc = fs.readFileSync(path.join(ROOT, "src", "offscreen", "document-extract.js"), "utf8");
  const pdfExtSrc = fs.readFileSync(path.join(ROOT, "src", "offscreen", "pdf-extractor.js"), "utf8");

  check("background routes EXTRACT_DOCUMENT_TEXT", bgSrc.includes('msg.type === "EXTRACT_DOCUMENT_TEXT"'));
  check("background has handleExtractDocumentText", bgSrc.includes("async function handleExtractDocumentText("));
  check("background forwards to offscreen (sendMessage)", bgSrc.includes('type: "EXTRACT_DOCUMENT_TEXT"'));
  check("offscreen answers EXTRACT_DOCUMENT_TEXT", offSrc.includes('msg.type === "EXTRACT_DOCUMENT_TEXT"'));
  check("offscreen imports the router", offSrc.includes('from "./document-extract.js"'));
  check("popup sends EXTRACT_DOCUMENT_TEXT", popupSrc.includes('type: "EXTRACT_DOCUMENT_TEXT"'));
  check("popup reacts to { text, format }", popupSrc.includes("res.format") && popupSrc.includes("res.text"));
  check("popup caps preview display", popupSrc.includes("MAX_PREVIEW_CHARS"));

  // Laziness: pdf.js / pako must NOT be statically loaded by popup or offscreen
  // (comments may mention them; only vendor imports count as loading).
  check("popup.js has no pdf.js vendor import", !popupSrc.includes("vendor/pdfjs"));
  check("popup.js has no pako vendor import", !popupSrc.includes("vendor/pako"));
  check("offscreen.js has no pdf.js vendor import", !offSrc.includes("vendor/pdfjs"));
  check("offscreen.js has no pako vendor import", !offSrc.includes("vendor/pako"));
  check("router dynamically imports pdf extractor", /await import\("\.\/pdf-extractor\.js"\)/.test(routerSrc));
  check("router dynamically imports docx extractor", /await import\("\.\/docx-extractor\.js"\)/.test(routerSrc));
  check(
    "pdf workerSrc is same-origin extension URL",
    /chrome\.runtime\.getURL\(/.test(pdfExtSrc) && pdfExtSrc.includes("pdf.worker.min.mjs")
  );
  check("docx extractor lazily imports pako", /import "\.\.\/vendor\/pako\/pako_inflate\.min\.js"/.test(fs.readFileSync(path.join(ROOT, "src", "offscreen", "docx-extractor.js"), "utf8")));

  const EXPECTED_ACCEPT = ".pdf,.docx,.txt,.json,.csv,.md,text/*,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  check("popup file input accept covers all formats", popupHtml.includes(`accept="${EXPECTED_ACCEPT}"`));

  console.log("\n" + ("─".repeat(60)));
  console.log(`${pass}/${pass + fail} passed, ${fail} failed.`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ── Fixtures / stubs ───────────────────────────────────────────────

// Minimal valid single-page PDF with a real text layer — byte-exact xref
// offsets computed while the objects are serialized.
function buildFixturePdf(texts) {
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objects[3] =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R " +
    "/Resources << /Font << /F1 5 0 R >> >> >>";
  const body = texts
    .map((t, i) => `BT /F1 18 Tf 72 ${720 - i * 48} Td (${t}) Tj ET`)
    .join("\n");
  const stream = body;
  objects[4] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`;
  objects[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  let out = "%PDF-1.4\n";
  const offsets = [];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = Buffer.byteLength(out);
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out);
  out += "xref\n0 6\n0000000000 65535 f \n";
  for (let i = 1; i <= 5; i++) out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

// DOMParser stand-in for Node: implements exactly the surface
// extractDocumentXmlText() uses — getElementsByTagName() on the document and
// on paragraphs, textContent on elements. The browser path uses the real
// DOMParser (the offscreen document is created with reason DOM_PARSER).
function stubParseXml(xml) {
  const root = { children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([A-Za-z0-9:_]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = tagRe.exec(xml))) {
    const text = xml.slice(last, m.index);
    if (text) stack[stack.length - 1].children.push({ text });
    if (m[4]) { last = tagRe.lastIndex; continue; } // self-closing
    if (m[1]) { if (stack.length > 1) stack.pop(); }
    else {
      const node = { name: m[2], children: [] };
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    }
    last = tagRe.lastIndex;
  }
  const tail = xml.slice(last);
  if (tail) root.children.push({ text: tail });

  function elem(node) {
    return {
      get tagName() { return node.name; }, // real DOM elements expose tagName
      getElementsByTagName(tagName) {
        const out = [];
        (function walk(n) {
          if (n !== node && (tagName === "*" || n.name === tagName)) out.push(elem(n));
          for (const c of n.children || []) if (c.children) walk(c);
        })(node);
        return out;
      },
      get textContent() {
        let s = "";
        (function walk(n) {
          if (n.text !== undefined) s += n.text;
          for (const c of n.children || []) walk(c);
        })(node);
        return s;
      },
    };
  }
  return elem(root);
}

// Finds the LOCAL file header offset of a named entry (for the
// central-directory fallback test).
function localHeaderOffsetOf(zipBytes, targetName) {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  let offset = 0;
  while (offset + 30 <= zipBytes.length) {
    if (view.getUint32(offset, true) !== 0x04034b50) return -1;
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = zipBytes.toString("latin1", offset + 30, offset + 30 + nameLen);
    if (name === targetName) return offset;
    const compSize = view.getUint32(offset + 18, true);
    offset += 30 + nameLen + extraLen + compSize;
  }
  return -1;
}