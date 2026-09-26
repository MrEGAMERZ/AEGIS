// llm-worker.js — WebGPU/WASM inference worker for SARA (Qwen2.5-0.5B-Instruct)
// Loaded as a module worker by offscreen.js:
//   new Worker(chrome.runtime.getURL('src/offscreen/llm-worker.js'), { type: 'module' })
//
// Uses the vendored @huggingface/transformers (transformers.min.js) so no CDN
// requests are needed — the extension is fully offline-capable once the model
// weights are cached in IndexedDB.

// Import from the vendored copy via chrome.runtime.getURL. Module workers in
// Chrome extensions CAN use static import if the file is in web_accessible_resources.
// We use a dynamic import so the path is resolved at runtime.
const TRANSFORMERS_URL = new URL(
  '../../vendor/transformers.min.js',
  import.meta.url
).href;

const { pipeline, env } = await import(TRANSFORMERS_URL);

// Configuration — stay offline after first download
env.allowLocalModels = false; // use the HF hub for pre-quantized weights
env.backends.onnx.wasm.numThreads = 1;
// Point the WASM backend at the vendored wasm/mjs files so no extra network
// round-trip is needed for the ORT runtime itself.
env.backends.onnx.wasm.wasmPaths = new URL(
  '../../vendor/',
  import.meta.url
).href;

class LLMPipeline {
  static task = 'text-generation';
  // Pre-quantized ONNX version of Qwen2.5-0.5B-Instruct (SARA weights).
  static model = 'onnx-community/Qwen2.5-0.5B-Instruct';
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, {
        dtype: 'q4',          // 4-bit quantization — ~400 MB on first download
        device: 'webgpu',     // Hardware acceleration; falls back to WASM automatically
        progress_callback,
      });
    }
    return this.instance;
  }
}

// Listen for messages from the offscreen document
self.addEventListener('message', async (event) => {
  const { id, type, messages } = event.data;

  if (type === 'GENERATE') {
    try {
      // 1. Load the model (downloads to IndexedDB cache on first run)
      const generator = await LLMPipeline.getInstance((data) => {
        // Forward download / compile progress back to background.js via offscreen.js
        self.postMessage({ id, status: 'progress', data });
      });

      // 2. Generate the response
      const result = await generator(messages, {
        max_new_tokens: 512,
        temperature: 0.2,
        do_sample: false,
      });

      // 3. Extract the assistant reply from the generated text array
      const generated = result?.[0]?.generated_text;
      let replyText = '';
      if (Array.isArray(generated) && generated.length > 0) {
        // Transformers.js chat format: array of {role, content} objects
        const last = generated[generated.length - 1];
        replyText = (typeof last === 'object' ? last.content : String(last)) || '';
      } else if (typeof generated === 'string') {
        replyText = generated;
      }

      self.postMessage({ id, status: 'complete', reply: replyText });

    } catch (error) {
      console.error('[AEGIS llm-worker] GENERATE error:', error);
      self.postMessage({ id, status: 'error', error: error.message });
    }
  }
});
