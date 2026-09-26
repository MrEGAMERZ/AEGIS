// transformers-global.js — Thin shim to expose @huggingface/transformers as a global
// 
// WHY THIS EXISTS:
//   transformers.web.min.js (v4.x) is an ES module (uses export { ... }).
//   When loaded as a plain <script> tag (no type="module"), export statements
//   are a syntax error. Web Workers using importScripts() also cannot consume ES modules.
//
//   This shim is loaded as type="module", imports what we need from the ESM build,
//   and attaches it to globalThis so non-module code can access it as window.transformers
//   or self.transformers.
//
// USAGE in offscreen.html:
//   <script type="module" src="../vendor/transformers-global.js"></script>
//
// USAGE in inference.worker.js (Web Worker):
//   Cannot use importScripts() for ES modules. Instead, the worker itself
//   must use: import { pipeline, env } from the ESM file directly.
//   Workers in Chrome extensions CAN use static ES module imports
//   if the worker is created with { type: 'module' } option.

import * as Transformers from './transformers.min.js';

// Expose as global so non-module offscreen.js code can use:
//   const { pipeline } = globalThis.transformers;
globalThis.transformers = Transformers;

console.log('[SIH26171] transformers global set, version:', Transformers.env?.version ?? '4.x');
