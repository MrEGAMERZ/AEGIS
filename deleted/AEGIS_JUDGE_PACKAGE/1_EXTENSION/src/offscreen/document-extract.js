// Offscreen document — on-device text extraction for dropped documents.
//
// Single entry point for the EXTRACT_DOCUMENT_TEXT contract:
//   in:  { name, size, mimeType, arrayBufferBase64 }
//   out: { text: string, format: "pdf"|"docx"|"text"|"json"|"csv"|"md" }
//
// Everything runs inside the extension (offscreen document has DOM + module
// import access). The heavy parsers are imported DYNAMICALLY per format:
//   - pdf  → pdf-extractor.js  → vendors pdf.min.mjs + worker (~1.7 MB total)
//   - docx → docx-extractor.js → vendors pako_inflate (~22 KB)
// so opening the popup or the offscreen document never loads them.
// Text formats (txt/json/csv/md) are a plain UTF-8 decode — no parser at all.
//
// options forwarding (inflate/parseXml/pdfjsLib) exists so the Node harness
// can exercise the real pipeline; the extension never passes options.

import { base64ToBytes, detectDocFormat } from "../shared/file-helpers.js";

export async function extractDocumentText(filePayload, options = {}) {
  if (
    !filePayload ||
    typeof filePayload.arrayBufferBase64 !== "string" ||
    filePayload.arrayBufferBase64.length === 0
  ) {
    throw new Error("DOC_EXTRACT_NO_FILE: missing file payload");
  }

  const format = detectDocFormat(filePayload.name || "", filePayload.mimeType || "");
  if (!format) {
    throw new Error(
      `DOC_EXTRACT_UNSUPPORTED: ${filePayload.name || "this file"} is not a supported document type`
    );
  }

  const bytes = base64ToBytes(filePayload.arrayBufferBase64);
  if (bytes.length === 0) throw new Error("DOC_EXTRACT_EMPTY: the file is empty");

  let text;
  switch (format) {
    case "pdf": {
      const { extractPdfText } = await import("./pdf-extractor.js");
      text = await extractPdfText(bytes, options);
      break;
    }
    case "docx": {
      const { extractDocxText } = await import("./docx-extractor.js");
      text = await extractDocxText(bytes, options);
      break;
    }
    default: {
      // txt / json / csv / md — the "extracted text" IS the file content.
      text = new TextDecoder().decode(bytes);
    }
  }

  return { text: String(text || ""), format };
}

export function detectFormat(fileName, mimeType) {
  return detectDocFormat(fileName, mimeType);
}