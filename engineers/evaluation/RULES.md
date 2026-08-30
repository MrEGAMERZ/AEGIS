# Evaluation Engineer — Rules & Prompts

## Phase 2 Task: E2E Testing & Final Table Report

**Your job this phase:** Verify the 2-day MVP actually works. You will test the full pipeline: UI Profile input → Screen Capture → Local Redaction (DOM + ML) → Server VLM → Form Filled.

**What to do:**
1. Coordinate with all engineers to get the latest codebase loaded in Chrome.
2. Open a test page (e.g., `tp01-login-form.html` or a dummy registration form).
3. Set a dummy profile in the extension popup.
4. Trigger the agent.
5. Verify redaction happened locally, VLM generated the correct output, and the DOM executed it.

**CRITICAL INSTRUCTION:** 
Provide your final report in the `work_done.md` file using the exact table format provided there.
