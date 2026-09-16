/**
 * Speech helper contract — 10 languages, Chrome Web Speech wrapper.
 * USAGE: node eval/harness/speech-listen.test.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.join(__dirname, "..", "..");

async function main() {
  const mod = await import(pathToFileURL(path.join(ROOT, "src/shared/speech-listen.js")).href);
  const { VOICE_LANGUAGES, speechRecognitionSupported, createSpeechSession } = mod;
  const popupJs = fs.readFileSync(path.join(ROOT, "src/popup/popup.js"), "utf8");
  const popupHtml = fs.readFileSync(path.join(ROOT, "src/popup/popup.html"), "utf8");
  const voiceJs = fs.readFileSync(path.join(ROOT, "src/voice/voice.js"), "utf8");
  const voiceHtml = fs.readFileSync(path.join(ROOT, "src/voice/voice.html"), "utf8");

  let pass = 0;
  let fail = 0;
  function check(name, ok, detail) {
    if (ok) {
      pass++;
      console.log(`  PASS  ${name}`);
    } else {
      fail++;
      console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
    }
  }

  console.log("Speech-to-text — languages + wiring\n");

  check("10 languages", Array.isArray(VOICE_LANGUAGES) && VOICE_LANGUAGES.length === 10);
  const codes = VOICE_LANGUAGES.map((l) => l.code);
  for (const code of ["en-US", "hi-IN", "bn-IN", "ta-IN", "te-IN", "mr-IN", "kn-IN", "gu-IN", "ml-IN", "pa-IN"]) {
    check(`includes ${code}`, codes.includes(code));
  }
  check("Node has no SpeechRecognition", speechRecognitionSupported() === false);
  const session = createSpeechSession({ lang: "hi-IN" });
  check("unsupported session does not throw", session && session.supported === false);

  check("popup Start listening exists", popupHtml.includes('id="voice-start-btn"'));
  check("popup honest Google speech copy", /Chrome speech may send audio to Google/.test(popupHtml));
  check("popup Save spoken fields", popupHtml.includes('id="save-voice-btn"'));
  check("popup speech is not auto-persisted", /onFinal[\s\S]*showVoiceFields/.test(popupJs) && /save-voice-btn[\s\S]*saveProfileData/.test(popupJs));
  check("voice page Save to profile", voiceHtml.includes('id="save-voice-btn"') && voiceJs.includes("aegisProfiles"));
  check("voice page uses shared extract-profile", voiceJs.includes("../shared/extract-profile.js"));
  check("voice page uses speech-listen", voiceJs.includes("../shared/speech-listen.js"));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
