// AEGIS — multilingual speech → profile (full page).
// Uses Chrome Web Speech (same path as the teammate build). Persist only on Save.

import {
  extractProfileFromText,
  toUserProfileFields,
  KEY_LABELS,
} from "../shared/extract-profile.js";
import {
  VOICE_LANGUAGES,
  speechRecognitionSupported,
  requestMicrophone,
  createSpeechSession,
} from "../shared/speech-listen.js";

const micBtn = document.getElementById("mic-btn");
const langSelect = document.getElementById("voice-lang-select");
const transcriptBox = document.getElementById("transcript-box");
const extractedBox = document.getElementById("extracted-box");
const extractedTags = document.getElementById("extracted-tags");
const saveBtn = document.getElementById("save-voice-btn");
const discardBtn = document.getElementById("discard-voice-btn");
const closeBtn = document.getElementById("close-btn");
const statusEl = document.getElementById("voice-status");

let session = null;
let pendingFields = null;
let lastTranscript = "";

function setStatus(msg, kind) {
  if (!statusEl) return;
  statusEl.textContent = msg || "";
  statusEl.className = kind ? `voice-status ${kind}` : "voice-status";
}

function fillLangSelect() {
  if (!langSelect) return;
  langSelect.innerHTML = "";
  for (const { code, label } of VOICE_LANGUAGES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = label;
    langSelect.appendChild(opt);
  }
  langSelect.value = "en-US";
}

function showFields(fields) {
  pendingFields = fields;
  extractedTags.innerHTML = "";
  const entries = Object.entries(fields || {});
  if (!entries.length) {
    extractedBox.style.display = "none";
    saveBtn.disabled = true;
    return;
  }
  extractedBox.style.display = "block";
  saveBtn.disabled = false;
  for (const [k, v] of entries) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${KEY_LABELS[k] || k}: ${v}`;
    extractedTags.appendChild(tag);
  }
}

function applyTranscript(text, { final: isFinal }) {
  lastTranscript = text;
  transcriptBox.textContent = text;
  if (!isFinal) return;
  const fields = toUserProfileFields(extractProfileFromText(text));
  showFields(fields);
  const n = Object.keys(fields).length;
  if (n) setStatus(`${n} field(s) found. Click Save to store them on this device.`, "ok");
  else setStatus("Heard you, but no phone/email/name to save. Try again.", "warn");
}

function bindSession() {
  session = createSpeechSession({
    lang: langSelect?.value || "en-US",
    onStart() {
      micBtn.classList.add("recording");
      transcriptBox.textContent = "Listening...";
      setStatus("Listening…", "");
    },
    onInterim(t) { applyTranscript(t, { final: false }); },
    onFinal(t) { applyTranscript(t, { final: true }); },
    onError(err) {
      micBtn.classList.remove("recording");
      const msg = String(err || "error");
      if (msg === "not-allowed") setStatus("Microphone blocked. Allow mic for this page in Chrome.", "err");
      else if (msg === "no-speech") setStatus("No speech heard. Click the mic and try again.", "warn");
      else setStatus(`Speech error: ${msg}`, "err");
    },
    onEnd() { micBtn.classList.remove("recording"); },
  });
}

micBtn.addEventListener("click", async () => {
  if (!speechRecognitionSupported()) {
    transcriptBox.textContent = "Speech recognition is not available in this browser. Use Google Chrome.";
    micBtn.disabled = true;
    return;
  }
  if (session?.isRecording()) {
    session.stop();
    return;
  }
  try {
    await requestMicrophone();
  } catch {
    setStatus("Microphone permission denied. Check Chrome settings.", "err");
    return;
  }
  bindSession();
  session.setLang(langSelect?.value || "en-US");
  try {
    session.start();
  } catch {
    setStatus("Could not start listening. Click again.", "warn");
  }
});

langSelect?.addEventListener("change", () => {
  session?.setLang(langSelect.value);
});

saveBtn?.addEventListener("click", async () => {
  if (!pendingFields || !Object.keys(pendingFields).length) {
    setStatus("Nothing to save yet. Speak first.", "warn");
    return;
  }
  const stored = await chrome.storage.local.get(["aegisCurrentProfile", "aegisProfiles", "userProfile"]);
  const name = stored.aegisCurrentProfile || "Personal";
  const profiles = stored.aegisProfiles || {};
  const profile = { ...(profiles[name] || stored.userProfile || {}) };
  Object.assign(profile, pendingFields);
  profiles[name] = profile;
  await chrome.storage.local.set({ aegisProfiles: profiles, userProfile: profile });
  if (lastTranscript) {
    try {
      await chrome.runtime.sendMessage({
        type: "ADD_DOC_TO_VAULT",
        docName: `spoken-${name}.txt`,
        format: "txt",
        text: lastTranscript,
      });
    } catch {
      // vault is optional for speech
    }
  }
  setStatus(`Saved ${Object.keys(pendingFields).length} field(s) to ${name}.`, "ok");
});

discardBtn?.addEventListener("click", () => {
  pendingFields = null;
  lastTranscript = "";
  extractedBox.style.display = "none";
  extractedTags.innerHTML = "";
  saveBtn.disabled = true;
  transcriptBox.textContent = "Not saved. Click the microphone to speak again.";
  setStatus("Discarded. Nothing stored.", "");
});

closeBtn?.addEventListener("click", () => window.close());

fillLangSelect();
if (!speechRecognitionSupported()) {
  transcriptBox.textContent = "Speech recognition is not available in this browser. Use Google Chrome.";
  micBtn.disabled = true;
}
saveBtn.disabled = true;
