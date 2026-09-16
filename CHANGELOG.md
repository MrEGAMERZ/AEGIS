# Changelog

## Unreleased

### Added
- After Privacy Scan, **black boxes** cover faces, photos, passwords, and filled personal fields on the **What the agent would see** frame. The raw screenshot is never put on the network; the VLM only receives that masked image.
- Profile **Speak details**: 10 Indian languages via Chrome Web Speech, then **Save spoken fields** (nothing auto-persists). Full mic page still at `src/voice/voice.html`.
- Popup theme cycles **Light → Dark → Auto (system)** and is stored as `aegisTheme`.

### Fixed
- `classifyError` still maps VLM `timed out` to `TIMEOUT`. Consent copy for document structure is unchanged.

### Changed
- Product name is **AEGIS** everywhere Chrome and docs show it (not AGs). Greek: a shield — protector, defender.
- Repo hygiene: dropped unused ORT jsep WASM (~28 MB), stale `BRANCHES.md` / OpenCode config / one-off debug scripts. Root `package.json` is eval-only (`adm-zip`); models stay in `src/vendor/`.
- **Ready** means faces **and** name-hiding are loaded. The popup only shows **Loading models** while Chrome starts them, then hides the badge (or **Not loaded** if they fail).
- Fill Form writes every matching profile/document field, then warns **Not enough data available to fill the rest** for leftovers. It does not call the local model. Empty save still stops with **Save a profile first.**
- Live-page **Secured** covers are gone. Password/PII/face hides apply only on the sanitized agent frame, so login fields stay usable.
- PDF / document upload harvests **all safe Label: value fields** into the profile table (not just 3–4). On-device extract always runs; local AI merges on top. STRUCTURE uses **8192** output tokens and up to **120** fields so a full document can land in the table. Full document text still saves to local knowledge on Save.

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
