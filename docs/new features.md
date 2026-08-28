# On-device Visual Perception for Light-weight Browser Agents (SIH26171)

## Problem Statement
ISRO — Build a privacy-preserving vision agent that runs in the browser, redacts sensitive/PII data locally before any network request, and lets a server-side model reason over the sanitized context to help the user complete tasks.

## Chosen Use Case: Privacy-Preserving Form-Fill Agent
Instead of a general-purpose browser agent, scope the demo around one clear task: **an extension that fills out forms for you, without your sensitive data ever leaving your device unprotected.**

Applicable across:
- College/exam registrations, scholarships, hostel admissions
- Government service forms (passport, income/domicile certificates, e-governance portals)
- Event/hackathon registrations
- Banking/KYC-lite forms
- Healthcare intake forms
- Visa/travel forms
- E-commerce checkout forms

## Architecture

**Client (Chrome/Firefox extension):**
- Captures/reads the current page (screenshot + DOM)
- Runs local vision model + DOM rules to detect sensitive elements (passwords, faces, PII text)
- Redacts sensitive regions locally (blur/black-fill) before anything is transmitted
- Only sanitized structural context is sent to the server

**Server (hosted on personal laptop, Firebase for auxiliary services):**
- Receives sanitized context payload
- Runs/calls a VLM/LLM to reason about the page and decide the next action (fill field X, click submit, etc.)
- Returns structured actions for the extension to execute

## Personalization: How the Agent Knows Your Details

**Progressive/lazy setup — no upfront form to fill out:**
- No mandatory onboarding step. The extension builds the user's profile incrementally through normal use.
- First time it hits an unknown field, it asks once, saves the answer, and never asks again.
- After a few forms, the profile is largely complete — setup happens as a side effect of usage, not a separate burden.

**One-time document upload (optional accelerant):**
- User can upload a resume; fields (name, education, skills, experience) are extracted automatically.
- User can upload a government ID (Aadhaar, driving licence, PAN, passport, etc.) to speed up profile population.

**Self-learning / RAG for unseen fields:**
- For fields that don't map to a stored profile value (e.g., "describe a project you're proud of"), the backend uses retrieval-augmented generation: pull relevant facts from the user's stored context (resume text, past answers) and generate a plausible answer.
- User corrections to generated answers get saved back into the profile, improving future fills.
- Framed to judges as "personalized context-aware generation," not "self-learning AI" (it's RAG, not model training — avoid overclaiming).

## Government ID Handling — Compliance-Safe Design

Applies to Aadhaar, PAN, driving licence, passport, voter ID, etc.

**Rule: extract-and-discard, never store-and-transmit.**
1. User uploads the document.
2. OCR/vision extraction happens **locally in the browser** — never send the raw ID image or number to the server.
3. Only generic, non-identifying fields (name, DOB, address) are extracted and added to the reusable profile.
4. The unique identifier (Aadhaar number, PAN number, licence number) and the document photo are discarded immediately — never persisted, never transmitted, not even to the self-hosted backend.

This is especially important for Aadhaar specifically: the Aadhaar Act, 2016 restricts who can collect/store/process Aadhaar numbers (licensed AUA/KUA entities only) — this applies regardless of the project being built for a government-run hackathon. Designing around this deliberately (rather than ignoring it) is a positive signal for judges, not a limitation to hide.

Architecturally, this should be one generic "sensitive document ingestion" pipeline with a per-document-type config (which fields are safe to keep vs. always redacted), rather than one-off logic per ID type — generalizes better and is a stronger technical talking point.

## Scope Decision
Given hackathon time constraints, demo against **one** ID type (e.g., driving licence or PAN — lower compliance sensitivity than Aadhaar) and describe the generic pipeline as extensible to other ID types in the pitch/slides, rather than fully implementing parsers for all of them.

## Competitive Landscape Note
A reference/competing implementation for the same problem statement (SIH26171) was found: [github.com/MrEGAMERZ/SIH26](https://github.com/MrEGAMERZ/SIH26) ("Aegis"). Their scope: BlazeFace ONNX for face detection, hybrid regex + DistilBERT NER for text PII, DOM-based password/field detection, Qwen3-VL-8B-Instruct as the server-side VLM. They deliberately excluded self-learning/RAG and ID document parsing to keep scope tight.

**Differentiation opportunity:** our RAG-based adaptive profile and document-upload personalization are not part of their scope — but only build these if they can be shipped reliably; an unfinished differentiator is worse than a polished core redaction pipeline.

## Pitch Framing
- Hero feature: privacy-preserving redaction (the hard, defensible engineering work)
- Form-filling: the demo vehicle, not the differentiator on its own (autofill already exists commercially)
- Personalization/RAG: the "smart" layer that makes the pitch memorable, described accurately as retrieval-augmented generation, not self-learning AI
