# AEGIS - Judge Demo Instructions

Welcome. This package contains the fully working AEGIS prototype. It runs 100% locally.

Follow these 3 simple steps to test the Zero-Trust Privacy Layer:

### Step 1 — Start the AI Server
1. Open a terminal and navigate to the `2_SERVER/` folder.
2. Run `npm install`
3. Run `npm start` (or `node index.js --mock` if you don't have Ollama installed).
4. You should see: `[INFO] AEGIS Backend listening on http://127.0.0.1:8000`

### Step 2 — Load the Extension
1. Open Google Chrome.
2. Go to `chrome://extensions` in the URL bar.
3. Turn on **Developer mode** (toggle in the top right).
4. Click **Load unpacked** (top left button).
5. Select the `1_EXTENSION/` folder from this package.

### Step 3 — Run the Demo
1. Open `3_DEMO_PAGES/tp08-kitchen-sink-registration.html` in Chrome.
2. Click the AEGIS icon in your Chrome toolbar.
3. Click **Run Agent**.
4. Watch as AEGIS automatically detects the face, redacts the PII, and fills the form while ensuring the AI model never sees the raw, sensitive screenshot.
