#!/usr/bin/env bash
#
# build-dist.sh — assemble a minimal "Load unpacked" root at dist/.
#
# Chrome's extension size is whatever the load root contains, so pointing
# chrome://extensions at the repo root bills node_modules/, .opencode/ and
# .git/ to the extension. dist/ mirrors the repo layout (manifest.json at the
# top, everything else under src/) so no path inside manifest.json changes.
#
# Large binaries are hardlinked, so dist/ adds ~0 bytes of disk for them.
# Hardlinks share an inode: rewriting a vendor binary in place would also
# change dist/. Re-run this script after replacing anything in src/vendor/.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST="$REPO_ROOT/dist"

cd "$REPO_ROOT"

# Directories copied wholesale (every file in them is runtime code).
RUNTIME_DIRS=(
  src/background
  src/content
  src/popup
  src/offscreen
  src/inference
  src/icons
  src/shared
  src/voice
  src/dashboard
)

# src/vendor/ is an allowlist, not a directory copy.
# The vendored ORT is the WASM-only bundle (`ort-wasm-simd-threaded.wasm`).
VENDOR_FILES=(
  src/vendor/ort.min.js
  src/vendor/transformers.min.js
  src/vendor/transformers-global.js
  src/vendor/ort-wasm-simd-threaded.wasm
  src/vendor/ort-wasm-simd-threaded.mjs
  src/vendor/blaze.onnx
)

# DistilBERT CoNLL-03 weights + tokenizer, vendored so the fail-closed NER gate
# never needs a network. A directory rather than an allowlist because the model
# is a self-contained tree. No ORT binary here: transformers.min.js is bundled
# against the same 1.29.0 wasm build BlazeFace loads.
#
# pdfjs/  — pdf.min.mjs + pdf.worker.min.mjs (lazy on-device PDF extraction)
# pako/   — pako_inflate.min.js (lazy on-device DOCX ZIP inflate)
VENDOR_DIRS=(
  src/vendor/models
  src/vendor/pdfjs
  src/vendor/pako
)

ROOT_FILES=(
  manifest.json
)

# Hardlink where the payload is big and immutable; copy small text files so an
# editor rewriting src/ never surprises a stale dist/ (and vice versa).
install_file() {
  local rel="$1"
  local dest="$DIST/$rel"
  mkdir -p "$(dirname "$dest")"

  case "$rel" in
    *.wasm|*.onnx)
      if ln "$rel" "$dest" 2>/dev/null; then
        printf '  link  %s\n' "$rel"
        return
      fi
      printf '  copy  %s (hardlink failed)\n' "$rel"
      ;;
    *)
      printf '  copy  %s\n' "$rel"
      ;;
  esac
  cp -p "$rel" "$dest"
}

printf 'Building %s\n' "$DIST"
rm -rf "$DIST"
mkdir -p "$DIST"

for f in "${ROOT_FILES[@]}"; do
  [ -f "$f" ] || { printf 'missing required file: %s\n' "$f" >&2; exit 1; }
  install_file "$f"
done

for d in "${RUNTIME_DIRS[@]}"; do
  [ -d "$d" ] || { printf 'missing required directory: %s\n' "$d" >&2; exit 1; }
  while IFS= read -r f; do
    install_file "${f#./}"
  done < <(cd "$REPO_ROOT" && find "$d" -type f ! -name '.DS_Store' | sort)
done

for f in "${VENDOR_FILES[@]}"; do
  [ -f "$f" ] || { printf 'missing required vendor file: %s\n' "$f" >&2; exit 1; }
  install_file "$f"
done

for d in "${VENDOR_DIRS[@]}"; do
  [ -d "$d" ] || { printf 'missing required vendor directory: %s\n' "$d" >&2; exit 1; }
  while IFS= read -r f; do
    install_file "${f#./}"
  done < <(cd "$REPO_ROOT" && find "$d" -type f ! -name '.DS_Store' | sort)
done

# Verify every path manifest.json points at exists inside dist/, so a broken
# build fails here instead of at chrome://extensions.
VERIFY="$(mktemp -t build-dist-verify)"
trap 'rm -f "$VERIFY"' EXIT
cat >"$VERIFY" <<'NODE'
const fs = require('fs');
const path = require('path');

const dist = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));

const failures = [];
const checked = [];

function exact(rel, label) {
  const ok = fs.existsSync(path.join(dist, rel));
  checked.push(`${ok ? 'OK  ' : 'FAIL'}  ${label}: ${rel}`);
  if (!ok) failures.push(`${label}: ${rel}`);
}

// web_accessible_resources entries may be globs; a glob is satisfied when it
// matches at least one shipped file.
function glob(rel, label) {
  if (!rel.includes('*')) return exact(rel, label);
  // Chrome's web_accessible_resources match patterns let `*` span `/`, so a
  // single "src/vendor/models/*" covers the nested model directory.
  const re = new RegExp(
    '^' + rel.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$'
  );
  const matches = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (re.test(path.relative(dist, abs))) matches.push(path.relative(dist, abs));
    }
  })(dist);
  const ok = matches.length > 0;
  checked.push(`${ok ? 'OK  ' : 'FAIL'}  ${label}: ${rel} -> ${matches.length} match(es)`);
  if (!ok) failures.push(`${label}: ${rel} matched nothing`);
}

exact(manifest.background.service_worker, 'background.service_worker');
for (const cs of manifest.content_scripts ?? []) {
  for (const js of cs.js ?? []) exact(js, 'content_scripts.js');
  for (const css of cs.css ?? []) exact(css, 'content_scripts.css');
}
if (manifest.action?.default_popup) exact(manifest.action.default_popup, 'action.default_popup');
for (const [k, v] of Object.entries(manifest.action?.default_icon ?? {})) exact(v, `action.default_icon.${k}`);
for (const [k, v] of Object.entries(manifest.icons ?? {})) exact(v, `icons.${k}`);
for (const war of manifest.web_accessible_resources ?? []) {
  for (const r of war.resources ?? []) glob(r, 'web_accessible_resources');
}

console.log(checked.join('\n'));
if (failures.length) {
  console.error(`\n${failures.length} manifest path(s) missing from dist/:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\nAll ${checked.length} manifest paths resolve inside dist/.`);
NODE

printf '\nVerifying manifest paths\n'
node "$VERIFY" "$DIST"

printf '\ndist/src/vendor contents:\n'
ls -l "$DIST/src/vendor"

printf '\n'
du -sh "$DIST"
