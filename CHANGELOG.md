# Changelog

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
