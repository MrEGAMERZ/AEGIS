// Shared file helpers — popup (browser) and offscreen (extension page) both use
// these. Pure functions only; no `chrome.*` dependency so the module is also
// importable from Node for harness tests (eval/harness/document-extract.test.js).

// On-device cap for a single dropped document. Keeps the base64 message payload
// (popup → background → offscreen) within sane MV3 message-clone sizes and
// bounds memory use of pdf.js / pako / DOMParser.
export const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024; // 15 MB

const BASE64_CHUNK = 0x8000; // 32 KiB per String.fromCharCode batch (call-arg safe)

// ── Format detection ───────────────────────────────────────────────
// Maps a dropped file to the extraction format expected by the backend
// contract: "pdf" | "docx" | "text" | "json" | "csv" | "md".
// The FILE EXTENSION is the stronger signal (dragged files often carry a
// generic mime like application/octet-stream); mimeType is the fallback.
// Returns null for anything we cannot extract on-device (png/jpg/doc/xls…).
export function detectDocFormat(fileName, mimeType) {
  const name = String(fileName || "");
  const mime = String(mimeType || "").toLowerCase();

  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase().trim() : "";

  if (ext) {
    if (ext === "pdf") return "pdf";
    if (ext === "docx") return "docx";
    if (ext === "json") return "json";
    if (ext === "csv") return "csv";
    if (ext === "md") return "md";
    if (ext === "txt") return "text";
  }

  if (mime === "application/pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mime === "application/json") return "json";
  if (mime === "text/csv") return "csv";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "md";
  if (mime === "text/plain" || mime.startsWith("text/")) return "text";
  return null;
}

// ── Base64 ─────────────────────────────────────────────────────────
// Popup side (MV3 cannot pass File objects through messaging): read the file
// as an ArrayBuffer, then encode it as a base64 string in bounded chunks.
export async function toBase64(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new Error("toBase64: expected a File object");
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK));
  }
  return btoa(binary);
}

// Offscreen side: decode the transported base64 string back to bytes.
// Chunk-free charCodeAt loop — safe for multi-MB payloads without blowing the
// call stack (unlike Uint8Array.from(str, c => c.charCodeAt(0))).
export function base64ToBytes(base64) {
  const binary = atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}