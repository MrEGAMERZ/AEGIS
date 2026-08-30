# ML Engineer — Rules & Prompts

## Phase 2 Task: Core Redaction Models (BlazeFace & DistilBERT)

**Your job this phase:** Replace the `return []` stubs in `inference.worker.js` with the actual ONNX and Transformers.js inference pipelines.

**What to do:**
1. **BlazeFace ONNX (Task 2.1):** 
   - Load `garavv/blazeface-onnx`.
   - Resize `imageData` to 128x128, normalize to `float32`.
   - Run the ONNX session.
   - Apply NMS to the output bounding boxes.
   - Return `{ bbox: [x1, y1, w, h], confidence }`.
2. **DistilBERT NER (Task 2.2):**
   - Initialize the pipeline for `Xenova/distilbert-base-uncased-finetuned-conll03-english`.
   - Filter for `PER`, `ORG`, `LOC` with score > 0.8.
   - Return the original DOM bounding box associated with the text snippet.

**CRITICAL INSTRUCTION:** 
Provide your final report in the `work_done.md` file using the exact table format provided there.
