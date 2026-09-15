# Changelog

## Unreleased

### Added
- **Stop scan** on the Fill tab: cancels an in-progress Privacy Scan (`ABORT_SCAN`) so a cold 30–90s run does not trap the popup. Late results are discarded; idle field covers are restored. Stop also cancels Fill Form leftover VLM and Run Agent; the UI stays disabled until abort is acknowledged so a new scan cannot race the old one.
- Popup theme cycles **Light → Dark → Auto (system)** and is stored as `aegisTheme`.
- Popup opens with `WARM_MODELS` so the on-device badge is not stuck on Loading until the first scan.

### Fixed
- `classifyError` still maps VLM `timed out` to `TIMEOUT`. Popup copy now distinguishes a local-model timeout from on-device init failure. Consent copy for document structure matches **Structure with local AI**.
- Fill Form no longer hangs 30–90s on leftover VLM when the `:8000` gateway is down, or when the only empty fields are traps (Aadhaar / PAN / blood group / PIN).
- Run Agent fail-fasts if the gateway is offline instead of redacting for a minute first.
- Active-tab lookup ignores the focused popup window (`lastFocusedWindow` + injectable URL).
- Offscreen `createDocument` is serialized; SANITIZE jobs queue so two scans cannot share one canvas.
- Post-reload inject includes `field-mapper.js` and `autofill.js`, not only `content.js`.
- Duplicate keyboard-shortcut and context-menu listeners removed (they double-fired Fill).

## [0.1.0] - 2026-09-09

### Added
- Fill Form reads saved profile and document-vault text on the device first, then asks the local model only for leftover empty fields.
- Scan human faces toggle on the Fill tab, plus Scan faces now / Scan faces on this page. Everyday browsing does not outline other people's faces.
- PDF and other uploads are stored as on-device text. Optional local AI can structure fields; remote AI never sees the file.
- Architecture map for those three flows in `docs/PROFILE_FILL_ARCHITECTURE.md`.
- Chrome TP08 harness for idle scan, privacy scan, and local fill (`eval/harness/tp08-chrome-e2e.mjs`).

### Changed
- Privacy Scan and Run Agent honor the face-detection setting instead of always running BlazeFace.
- Demo runbook uses the local gateway at `:8000` and documents the idle / toggle / on-demand face policy.

### Fixed
- NER label redaction still runs on fillable fields before any VLM call after the fill-field merge.
