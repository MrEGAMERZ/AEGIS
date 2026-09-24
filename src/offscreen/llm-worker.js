import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/transformers.min.js';

// Configuration
env.allowLocalModels = false; // We use the HF hub for the pre-quantized SARA weights
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/';

class LLMPipeline {
  static task = 'text-generation';
  // We use the pre-quantized ONNX version of Qwen2.5-0.5B-Instruct (SARA)
  static model = 'onnx-community/Qwen2.5-0.5B-Instruct';
  static instance = null;

  static async getInstance(progress_callback = null) {
    if (this.instance === null) {
      this.instance = pipeline(this.task, this.model, {
        dtype: 'q4', // 4-bit quantization
        device: 'webgpu', // Hardware acceleration!
        progress_callback
      });
    }
    return this.instance;
  }
}

// Listen for messages from the extension (background.js or sidepanel)
self.addEventListener('message', async (event) => {
  const { id, type, messages } = event.data;
  
  if (type === 'GENERATE') {
    try {
      // 1. Load the model (downloads to IndexedDB cache on first run)
      const generator = await LLMPipeline.getInstance((data) => {
        // Send download progress back to the UI
        self.postMessage({ id, status: 'progress', data });
      });

      // 2. Generate the response
      const result = await generator(messages, {
        max_new_tokens: 512,
        temperature: 0.2,
        do_sample: false
      });

      // 3. Send the final response text back
      const replyText = result[0].generated_text[result[0].generated_text.length - 1].content;
      self.postMessage({ id, status: 'complete', reply: replyText });
      
    } catch (error) {
      console.error("Local SARA Error:", error);
      self.postMessage({ id, status: 'error', error: error.message });
    }
  }
});
