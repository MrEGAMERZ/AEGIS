// Aegis — Multilingual Voice Assistant (standalone page)
// Extracts profile data from speech in 10 Indian languages

const LANGUAGES = [
  { code: "en-US", label: "English (US / India)" },
  { code: "hi-IN", label: "Hindi" },
  { code: "bn-IN", label: "Bengali" },
  { code: "ta-IN", label: "Tamil" },
  { code: "te-IN", label: "Telugu" },
  { code: "mr-IN", label: "Marathi" },
  { code: "kn-IN", label: "Kannada" },
  { code: "gu-IN", label: "Gujarati" },
  { code: "ml-IN", label: "Malayalam" },
  { code: "pa-IN", label: "Punjabi" },
];

const PROFILE_KEYS = [
  "fullName", "email", "phone", "dob", "gender", "city", "state",
  "pincode", "college", "occupation", "annualIncome",
];

const KEY_LABELS = {
  fullName: "Full name", email: "Email", phone: "Phone", dob: "Date of birth",
  gender: "Gender", city: "City", state: "State", pincode: "PIN code",
  college: "College / institution", occupation: "Occupation", annualIncome: "Annual income",
};

function extractProfileFromText(text) {
  const extracted = {};
  if (!text) return extracted;

  // Try JSON first
  try {
    const j = JSON.parse(text);
    for (const k of PROFILE_KEYS) {
      if (j[k]) extracted[k] = String(j[k]).trim();
      else if (j[KEY_LABELS[k]]) extracted[k] = String(j[KEY_LABELS[k]]).trim();
    }
    if (Object.keys(extracted).length > 0) return extracted;
  } catch {}

  // Email
  const emailMatch = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
  if (emailMatch) extracted.email = emailMatch[0];

  // Phone (Indian)
  const phoneMatch = text.match(/(?:\+91[\s-]?)?[6-9]\d{9}/);
  if (phoneMatch) extracted.phone = phoneMatch[0].replace(/\D/g, "").slice(-10);

  // DOB
  const dobMatch = text.match(/(?:DOB|Date of Birth|Birth\s*Date)[\s:]*(\d{2}[-/.]\d{2}[-/.]\d{4}|\d{4}[-/.]\d{2}[-/.]\d{2})/i);
  if (dobMatch) extracted.dob = dobMatch[1];

  // Full name
  const nameMatch = text.match(/(?:Full\s*Name|Name|Mera\s*naam|My\s*name\s*is)[\s:]*([A-Za-z\s]{3,35})/i);
  if (nameMatch) {
    const n = nameMatch[1].replace(/hai|is|and|email|phone/gi, "").trim();
    if (n.length >= 3) extracted.fullName = n;
  }

  // City
  const cityMatch = text.match(/(?:City|Location|Rehta\s*hoon|Raho)[\s:]*([A-Za-z\s]{3,20})/i);
  if (cityMatch) {
    const c = cityMatch[1].replace(/hai|in|is/gi, "").trim();
    if (c) extracted.city = c;
  }

  // State
  const stateMatch = text.match(/(?:State)[\s:]*([A-Za-z\s]{3,20})/i);
  if (stateMatch) extracted.state = stateMatch[1].trim();

  // PIN
  const pinMatch = text.match(/(?:PIN|Pincode|Zip)[\s:]*(\d{6})/i);
  if (pinMatch) extracted.pincode = pinMatch[1];

  // College
  const collegeMatch = text.match(/(?:College|University|Institution)[\s:]*([A-Za-z\s]{3,40})/i);
  if (collegeMatch) extracted.college = collegeMatch[1].trim();

  // Income
  const incomeMatch = text.match(/(?:Income|Salary)[\s:]*(\d{5,10})/i);
  if (incomeMatch) extracted.annualIncome = incomeMatch[1];

  return extracted;
}

// ── DOM refs ──────────────────────────────────────────────────────
const micBtn = document.getElementById("mic-btn");
const langSelect = document.getElementById("voice-lang-select");
const transcriptBox = document.getElementById("transcript-box");
const extractedBox = document.getElementById("extracted-box");
const extractedTags = document.getElementById("extracted-tags");
const closeBtn = document.getElementById("close-btn");

let recognition = null;
let isRecording = false;

// ── Speech Recognition ────────────────────────────────────────────
function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    transcriptBox.textContent = "Speech recognition not supported in this browser.";
    micBtn.disabled = true;
    return null;
  }
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = true;

  rec.onstart = () => {
    isRecording = true;
    micBtn.classList.add("recording");
    transcriptBox.textContent = "Listening...";
  };

  rec.onresult = (e) => {
    let interimText = "";
    let finalText = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interimText += t;
    }
    transcriptBox.textContent = finalText || interimText || "Listening...";

    if (finalText) processTranscript(finalText);
  };

  rec.onerror = (e) => {
    isRecording = false;
    micBtn.classList.remove("recording");
    transcriptBox.textContent = `Error: ${e.error}`;
  };

  rec.onend = () => {
    isRecording = false;
    micBtn.classList.remove("recording");
  };

  return rec;
}

// ── Process transcript ────────────────────────────────────────────
function processTranscript(text) {
  const extracted = extractProfileFromText(text);
  const keys = Object.keys(extracted);
  if (keys.length === 0) {
    extractedBox.style.display = "none";
    return;
  }
  extractedBox.style.display = "block";
  extractedTags.innerHTML = "";
  for (const k of keys) {
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = `${KEY_LABELS[k] || k}: ${extracted[k]}`;
    extractedTags.appendChild(tag);
  }

  // Save to chrome.storage.local for popup to pick up
  chrome.storage.local.get(["aegisProfiles", "aegisCurrentProfile"], (stored) => {
    const name = stored.aegisCurrentProfile || "Personal";
    const profiles = stored.aegisProfiles || {};
    const profile = profiles[name] || {};
    Object.assign(profile, extracted);
    profiles[name] = profile;
    chrome.storage.local.set({ aegisProfiles: profiles, userProfile: profile });
  });
}

// ── Mic button ────────────────────────────────────────────────────
micBtn.addEventListener("click", async () => {
  // Request microphone permission first
  if (!isRecording) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      transcriptBox.textContent = "Microphone permission denied. Check Chrome settings.";
      return;
    }
  }

  if (isRecording) {
    recognition?.stop();
    return;
  }

  if (!recognition) recognition = initRecognition();
  if (recognition) {
    recognition.lang = langSelect?.value || "en-US";
    try { recognition.start(); } catch { /* already started */ }
  }
});

// ── Close button ──────────────────────────────────────────────────
closeBtn.addEventListener("click", () => {
  window.close();
});
