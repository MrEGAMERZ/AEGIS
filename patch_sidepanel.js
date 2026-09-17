const fs = require('fs');
let code = fs.readFileSync('src/sidepanel/sidepanel.js', 'utf8');

const importStmt = 'import { createSpeechSession, requestMicrophone } from "../shared/speech-listen.js";\n';

code = code.replace(
  '// sidepanel.js — Chat tab with multi-session management + quick commands\n',
  '// sidepanel.js — Chat tab with multi-session management + quick commands\n' + importStmt
);

code = code.replace(
  "const btnSend         = document.getElementById('btn-send');",
  "const btnSend         = document.getElementById('btn-send');\nconst btnMic          = document.getElementById('btn-mic');"
);

const sttLogic = `

// ── Speech-To-Text (STT) ────────────────────────────────────
let speechSession = null;
let interimPrefix = "";

if (btnMic) {
  btnMic.addEventListener('click', async () => {
    if (!speechSession) {
      speechSession = createSpeechSession({
        lang: "en-US",
        onStart: () => {
          interimPrefix = chatInput.value;
          if (interimPrefix && !interimPrefix.endsWith(" ")) {
            interimPrefix += " ";
          }
          btnMic.classList.add('active');
          chatInput.placeholder = "Listening...";
        },
        onInterim: (text) => {
          chatInput.value = interimPrefix + text;
          chatInput.style.height = 'auto';
          chatInput.style.height = chatInput.scrollHeight + 'px';
        },
        onFinal: (text) => {
          chatInput.value = interimPrefix + text;
          interimPrefix = chatInput.value + " ";
          chatInput.dispatchEvent(new Event('input'));
        },
        onEnd: () => {
          btnMic.classList.remove('active');
          chatInput.placeholder = "Message AEGIS…";
          chatInput.dispatchEvent(new Event('input'));
        },
        onError: (err) => {
          console.error("Speech error:", err);
          btnMic.classList.remove('active');
          chatInput.placeholder = "Message AEGIS…";
        }
      });
    }

    if (speechSession.isRecording()) {
      speechSession.stop();
    } else {
      try {
        await requestMicrophone();
        speechSession.start();
      } catch (err) {
        console.error("Microphone access denied:", err);
        alert("Microphone access is required for Voice Input.");
      }
    }
  });
}
`;

code += sttLogic;

fs.writeFileSync('src/sidepanel/sidepanel.js', code);
