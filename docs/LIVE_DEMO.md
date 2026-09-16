# AEGIS — LIVE DEMO CARD (real Chrome)

**Load unpacked (never the repo root):** the `dist/` folder from `bash scripts/build-dist.sh`.

1. Open **Google Chrome**. `chrome://extensions` → Developer mode → **Load unpacked** → select `dist` only.
2. Card name is **AEGIS** (cyan shield). After every `bash scripts/build-dist.sh`, click **Reload** on that card, then refresh the form tab.
3. Preferred form URL: `http://127.0.0.1:8765/tp08-kitchen-sink-registration.html` (file URLs work if you enable **Allow access to file URLs**).
4. Popup → **Profile** → speak (pick a language, **Start listening**, then **Save spoken fields**) or drop `eval/fixtures/Aegis-Demo-Profile-Mohammad-Rehan.pdf`. Review fields, then **Save**. **Don't save** stores nothing. If the popup blocks the mic, use **Full mic page**.
5. Local AI needs gateway `:8000` + Ollama. If that is down, on-device extract still fills name/email/phone from the PDF.
6. Open TP08 → **Fill** → **Fill Form**. Expect **Mohammad Rehan** values from the uploaded pack, not John Doe.
7. **Privacy Scan** on Fill. Face scan lives under **Settings** → Scan faces on this page.
8. Fill + Privacy Scan work **without** Ollama. Run Agent / leftover VLM fill need `:8000`.
