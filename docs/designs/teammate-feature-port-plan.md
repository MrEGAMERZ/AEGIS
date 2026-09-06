# Plan: Port teammate features into this Aegis repo

Status: DRAFT — waiting for you to say **BUILD**
Date: 2026-09-04
This repo stays home: `MrEGAMERZ/AEGIS`
Source of files: https://github.com/Awais-17/SIH26 at commit `d4b9c91fe581b2791c39f48972e69bd1d445e6c1`
Do not switch git remotes. Copy files in. Re-clone if `/tmp/awais-sih26` is gone.

No code until this plan is approved.

---

## What this repo already has

| Piece | Status |
|---|---|
| Privacy scan (faces, names, password boxes) | Code ready; you still need to click it in Chrome |
| Run Agent (click / type / scroll) | Code ready |
| Local server on port 8000 talking to real Ollama | Done (not the fake mock) |
| On-page “Secured” outlines while you browse | Started in `content.js` |

## What we will take from the teammate repo

Only pieces that exist as real files and can be made to work **here**. Their README lists 29 items; some are marketing or use fake numbers. We copy working code, then wire it to **this** extension’s profile (`userProfile` in the popup), not their `aegisProfile` key.

### Slice A — Form fill (next code after Scan works)

From: `src/content/field-mapper.js`, `src/content/autofill.js`, plus wiring in `content.js`, `popup.js`, `popup.html`, `manifest.json`.

- Fill name, email, phone, DOB, address from the popup profile
- Undo restores what was there
- Never save Aadhaar, PAN, CVV, passport, UPI PIN
- Floating “Aegis: N fields” badge (already in their autofill)
- Form-target warning if the page posts to `http://` from an `https://` site

**Must-fix while copying:** their fill reads `aegisProfile`. Ours reads `userProfile`. One store only, or fill will look empty.

### Slice B — Faster fill (same week)

From: `manifest.json` commands + `background.js` context menu.

- Right-click → Fill form
- Keyboard: Ctrl+Shift+F (Cmd+Shift+F on Mac)

### Slice C — Always-on covers

This repo already outlines sensitive fields. Finish:

- “Protected” cue without clicking Scan
- Covers must not steal clicks (`pointer-events: none`)
- No extra calls to Ollama while you just browse
- Faces still only on Scan / Run Agent (pixel blur stays on the sanitized image)

### Slice D — Voice

From: `src/voice/voice.html`, `src/voice/voice.js`, popup mic button.

- Speak name/email/phone into the profile (Chrome speech API)
- Opens a full tab if the tiny popup cannot use the mic

### Slice E — Document drop (safe fields only)

From: popup drop-zone in their `popup.html` / `popup.js`.

- Drop a résumé or ID **on the device**
- Keep only: name, DOB, email, phone, address
- **Throw away** Aadhaar/PAN/passport numbers. Do not save them. Their README extracts Aadhaar with regex — we will not keep those numbers.

### Slice F — Dashboard + dark mode (honest numbers)

From: `src/dashboard/dashboard.html`, `dashboard.js`, popup theme toggle.

- Privacy dashboard tab
- Dark / light toggle

**Must-fix:** their dashboard **invents** counts (12 forms, 48 PII, 9 faces) when nothing is stored. We start at **0** and only show real Scan receipts.

### Slice G — Extra profile (after F)

- Personal / Work / Family switch
- Export / import JSON of allowed keys only

### Slice H — Learn from what you type (after A works)

From: harvest logic inside `autofill.js`.

- If you type a normal field (name, email), offer to save it
- Never harvest password / Aadhaar / PAN / CVV

---

## What we will not copy

| Teammate claim | Why not |
|---|---|
| Fake dashboard stats | Looks like a working product that is lying |
| Their `vision.js` / model paths | This repo’s BlazeFace + NER already work; swapping would break Scan |
| Mock VLM (`--mock`) as the demo | You asked for a real model |
| Store Aadhaar/PAN from OCR | Illegal / against our never-store rule |
| Firefox | Chrome only for this ship |
| Replace this whole repo with theirs | We stay on this git |

---

## Build order (one at a time)

Stop if the previous slice is red.

1. **You:** Privacy scan on TP08 from `dist/` (still the first live check)
2. **You + me:** Run Agent on the same page (server already running)
3. **Me:** Slice A fill
4. **Me:** Slice B shortcut + right-click
5. **Me:** Slice C always-on polish
6. **Me:** Slice D voice
7. **Me:** Slice E document drop (safe keys)
8. **Me:** Slice F dashboard with real zeros
9. **Me:** Slice G multi-profile
10. **Me:** Slice H save-what-you-type

Rebuild after each slice:

```bash
bash scripts/build-dist.sh
```

Reload the unpacked extension from `dist/`. Keep:

```bash
cd server && node index.js
```

---

## How we copy (rule)

For each file: run or read it in the teammate tree, then merge. If it does not run or it fights this repo’s Scan/Agent, we skip that file and write why. We do not paste the whole teammate popup over ours.

---

## Done when

Judges can: Scan → see redacted preview → Run Agent one real click or type → Fill five profile fields with Undo → (if time) voice or dashboard with **real** counts.

Reply **BUILD** to start at slice 1–2 (Chrome Scan, then fill). Reply **BUILD A** to skip the recap and start form-fill code immediately (only if Scan already works on your machine).
