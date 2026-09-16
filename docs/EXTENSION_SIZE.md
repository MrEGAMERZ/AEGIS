# Extension size report (measured)

**Date:** 2026-09-09 14:53 IST  
**Branch:** `DEV` @ `cf2b423` (`fix: accept fill/fill_field from the VLM as type`)  
**Machine:** macOS (`du` 1024-based “M” units)  
**Method:** `du -sh` / `du -k -s` plus a Python `st_size` walk of `dist/`. No estimates.

This is the Client-side Resource Utilization (20%) artifact. Chrome’s `chrome://extensions` **Size** field for an unpacked load is the on-disk size of the folder you pick. This session measured those folders; it did **not** open `chrome://extensions` live.

---

## Headline numbers

| Load root | `du -sh` (this machine, 2026-09-09) | Use for demo? |
|---|---|---|
| **`dist/`** | **81M** (`du -sk` = 83,152 KiB; apparent file-size sum **85,052,183 B** = 81.11 MiB) | **Yes** — Load unpacked here |
| Repo root (`.` including `.git`, `node_modules`, `.chrome-demo-profile`, …) | **1.4G** | **Never** |

40 files in `dist/` after `scripts/build-dist.sh`. Large binaries (`*.wasm`, `*.onnx`) are hardlinked to `src/vendor/` (same inode); Chrome still bills each path at full file size.

---

## What prior docs already said (do not treat as current unless re-measured)

| Source | Claim | Status vs 2026-09-09 |
|---|---|---|
| `scripts/build-dist.sh` | Assembles a lean Load-unpacked root from an allowlist of `src/vendor/` | Still true |
| `docs/DEMO_RUNBOOK.md` | `dist/` ~**79 MB** with NER; **15–80 MB** in Chrome | 79–81 MB band still matches; this tree is **81M** |

**15 MB** was the pre-NER `dist/` (ORT WASM + BlazeFace + app JS). **79–81 MB** is the current `dist/` **with** vendored `src/vendor/models/distilbert-ner/`. Both figures are real; they describe different snapshots.

---

## Chrome billed size: `dist/` vs repo root

Unpacked extensions are billed as **everything under the folder that contains `manifest.json`**.

| Action | Folder Chrome scans | What it includes | Measured size |
|---|---|---|---|
| Load unpacked → **`…/SIH26/dist`** | `dist/` only | Manifest + `src/` runtime + allowlisted vendor (WASM, BlazeFace, NER, pdfjs, pako, icons) | **81M** |
| Load unpacked → **`…/SIH26`** (repo root) | Whole checkout | `node_modules`, `.chrome-demo-profile`, `.git`, `.opencode`, `graphify-out`, `dist/`, `src/` (including jsep WASM **not** used at runtime), docs, eval, … | **1.4G** (`du -sh .`) |

Top-level contributors to a repo-root load (measured `du -sh` of each name; combined listing shares hardlink inodes so `src` looks smaller next to `dist`):

| Path | `du -sh` |
|---|---|
| `.chrome-demo-profile` | 592M |
| `node_modules` | 518M |
| `dist` | 81M |
| `.git` | 80M |
| `.opencode` | 61M |
| `src` (measured alone) | 109M (`src/vendor` **108M**) |
| `graphify-out` | 27M |

`docs/DEMO_RUNBOOK.md` footgun still applies, only worse: loading the repo root used to show ~629 MB; today it would show **about 1.4 GB** and fails the Resource criterion.

---

## Breakdown of `dist/` (what judges should load)

Apparent bytes (`st_size`), 2026-09-09:

| Category | Bytes | MiB | % of `dist/` |
|---|---|---|---|
| **NER models** (`src/vendor/models/`, DistilBERT CoNLL-03 + tokenizer + `model_quantized.onnx`) | 67,890,326 | 64.75 | 79.8% |
| **ORT WASM** (`ort-wasm-simd-threaded.wasm`) | 13,961,845 | 13.32 | 16.4% |
| **pdfjs** (`src/vendor/pdfjs/`) | 1,724,118 | 1.64 | 2.0% |
| **Vendor JS** (ORT + transformers, excluding models/pdfjs) | 615,599 | 0.59 | 0.7% |
| **BlazeFace** (`blaze.onnx`) | 535,842 | 0.51 | 0.6% |
| **App JS/HTML/CSS** (background, content, popup, offscreen, inference, shared, voice, dashboard) | 298,204 | 0.28 | 0.4% |
| **pako** (DOCX inflate) | 22,682 | 0.02 | <0.1% |
| **Icons** | 1,119 | <0.01 | ~0% |
| **Other** (`manifest.json`) | 2,448 | <0.01 | ~0% |
| **Total** | **85,052,183** | **81.11** | 100% |

### Judge-facing grouping (JS vs models vs pdfjs vs icons)

| Bucket | What it is | Size |
|---|---|---|
| **Models (ONNX)** | DistilBERT NER `model_quantized.onnx` **63.84 MiB** + BlazeFace **0.51 MiB** + tokenizer files | **~65M** (`du -sh dist/src/vendor/models` = **65M**; blaze.onnx **524K**) |
| **WASM** | ONNX Runtime SIMD threaded | **13M** (`du -sh` **13M**; 13,961,845 B) |
| **JS** | App + vendor `.js`/`.mjs` (not under `models/`) | **2.6M** `du` of those files; app-only **332K**, vendor JS **2.3M** |
| **pdfjs** | On-device PDF extract | **1.6M** |
| **Icons** | `src/icons/` | **16K** (`du -sh`); 1,119 B apparent |

Largest single files in `dist/`:

| File | Bytes |
|---|---|
| `src/vendor/models/distilbert-ner/onnx/model_quantized.onnx` | 66,944,702 |
| `src/vendor/ort-wasm-simd-threaded.wasm` | 13,961,845 |
| `src/vendor/pdfjs/pdf.worker.min.mjs` | 1,265,413 |
| `src/vendor/models/distilbert-ner/tokenizer.json` | 711,396 |
| `src/vendor/blaze.onnx` | 535,842 |

---

## Source vendor (not all of this is shipped)

| Path | `du -sh` | In `dist/`? |
|---|---|---|
| `src/vendor` | see `du -sh src/vendor` | Partial — allowlist in `scripts/build-dist.sh` |
| `src/vendor/models` | **65M** | Yes |
| `src/vendor/ort-wasm-simd-threaded.wasm` | **13M** | Yes |
| `src/vendor/blaze.onnx` | **524K** | Yes |
| `src/vendor/pdfjs` | **1.6M** | Yes |

The unused ORT **jsep** WASM pair (~28 MB) and leftover `.bak` copies of `transformers.min.js` were removed from the tree. `dist/` stays an allowlist build; do not Load unpacked from the repo root.

---

## How to rebuild and re-measure

```bash
bash scripts/build-dist.sh   # prints `du -sh dist` at the end
du -sh dist
du -sh src/vendor src/vendor/models src/vendor/blaze.onnx \
      src/vendor/ort-wasm-simd-threaded.wasm src/vendor/pdfjs
```

Load unpacked: **`/path/to/SIH26/dist`**, not the repo root. Confirm Chrome Size is in the **~81 MB** range (or **~15 MB** only on a hypothetical NER-stripped build — that is **not** this tree).

---

## Related

- `scripts/build-dist.sh` — allowlist + manifest path verify
- `docs/DEMO_RUNBOOK.md` — judge load steps (15–80 MB band; 79 MB with NER)
- `docs/BACKEND_DEPLOY.md` — VLM gateway (orthogonal to package size)
