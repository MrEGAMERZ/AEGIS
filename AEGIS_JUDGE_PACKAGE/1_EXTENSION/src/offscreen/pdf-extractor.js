// PDF text extraction — pdf.js, loaded LAZILY only when a .pdf is dropped.
//
// src/vendor/pdfjs/pdf.min.mjs + pdf.worker.min.mjs are vendored (same-origin
// extension resources), so nothing is fetched over the network:
//   - the library is dynamically imported by document-extract.js on demand;
//   - the worker is created from chrome.runtime.getURL (an extension URL —
//     'self' under the MV3 CSP), never a CDN;
//   - the document data is fed as an in-memory Uint8Array — no range/fetch I/O.
// PDFs whose fonts need CMaps we did not vendor fail explicitly on-device
// rather than attempting any network fetch (fail-safe).

let pdfjsPromise = null;

function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../vendor/pdfjs/pdf.min.mjs").then((mod) => {
      const lib = (mod && mod.getDocument ? mod : mod.default) || mod;
      // Must point at the vendored worker; without this pdf.js falls back to a
      // relative "./pdf.worker.mjs" guess that we never ship.
      lib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
        "src/vendor/pdfjs/pdf.worker.min.mjs"
      );
      return lib;
    });
    // Allow a failed load to be retried on the next dropped file.
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

// extractPdfText(bytes, options) accepts an injected { pdfjsLib } so a harness
// can drive the real function with a pre-imported library; the extension path
// always uses the vendored lazy import above.
export async function extractPdfText(bytes, options = {}) {
  const pdfjsLib = options.pdfjsLib || (await loadPdfJs());
  if (!pdfjsLib || typeof pdfjsLib.getDocument !== "function") {
    throw new Error("PDFJS_LOAD_FAILED: pdf.js could not be loaded on-device");
  }

  // Copy: pdf.js may transfer the buffer to its worker; never mutate caller's.
  const data = new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));

  const loadingTask = pdfjsLib.getDocument({
    data,
    // CSP is 'self' + 'wasm-unsafe-eval' — eval is NOT granted: keep pdf.js
    // from reaching for new Function. Text extraction does not need it.
    isEvalSupported: false,
    // Text extraction only: don't touch font loading/embedding.
    disableFontFace: true,
  });

  try {
    const pdf = await loadingTask.promise;
    const out = [];
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      try {
        const content = await page.getTextContent();
        let line = "";
        for (const item of content.items || []) {
          const str = item && typeof item.str === "string" ? item.str : "";
          if (!str) continue;
          line = line ? line + " " + str : str;
          if (item.hasEOL) {
            out.push(line);
            line = "";
          }
        }
        if (line) out.push(line);
      } finally {
        try { page.cleanup(); } catch { /* already released */ }
      }
    }
    return out.join("\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  } catch (err) {
    throw new Error(`PDF_PARSE_FAILED: ${(err && err.message) || err}`);
  } finally {
    // pdf.js v6 drops PDFDocumentProxy.destroy() — the loading task owns
    // destruction (destroying it also releases every page).
    try { await loadingTask.destroy(); } catch { /* already destroyed */ }
  }
}