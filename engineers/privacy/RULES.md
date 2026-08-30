# Privacy Engineer — Rules & Prompts

## Phase 2 Oversight

**Your job this phase:** Ensure the ML models and the new RAG Profile injected by the Backend engineer do not violate the core privacy boundary. 
- Verify the structural payload sent to the VLM does NOT contain the raw unredacted text strings found by DistilBERT.
- Verify the Profile Data is fetched from local storage ONLY, and not synced to an external database.
