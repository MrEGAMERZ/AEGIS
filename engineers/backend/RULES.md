# Backend Engineer — Rules & Prompts

## Phase 2 Task: Baseline VLM Integration

**Your job this phase:** Connect the redacted extension payload to the VLM and return actionable commands. Do NOT build the RAG/Profile injection—that has been moved out of the MVP scope.

**What to do:**
1. Update `background.js` (or your server endpoint) where the VLM payload is constructed.
2. Receive the redacted image and DOM structure from the extension.
3. Pass it to the Qwen3-VL endpoint with a standard system prompt: *"You are a web agent. Based on the visible fields, determine the next logical action to take."*
4. Ensure the VLM output schema returns `{"action": "type/click", "selector": "...", "value": "..."}` correctly.

**CRITICAL INSTRUCTION:** 
Provide your final report in the `work_done.md` file using the exact table format provided there.
