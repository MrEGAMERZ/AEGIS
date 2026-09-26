// Chrome Web Speech wrapper for the popup and the full voice page.
// Language list matches the teammate build (Awais SIH26): 10 locales.

export const VOICE_LANGUAGES = [
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

export function speechRecognitionSupported() {
  if (typeof window === "undefined") return false;
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export async function requestMicrophone() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((t) => t.stop());
}

/**
 * One-shot listener. Chrome's recognizer typically uses Google's cloud
 * speech service; callers must say that in the UI.
 */
export function createSpeechSession({ lang = "en-US", onInterim, onFinal, onError, onStart, onEnd } = {}) {
  const SR = typeof window !== "undefined"
    ? (window.SpeechRecognition || window.webkitSpeechRecognition)
    : null;
  if (!SR) {
    return {
      supported: false,
      isRecording: () => false,
      start() {},
      stop() {},
    };
  }

  let rec = null;
  let recording = false;

  function bind(instance) {
    instance.continuous = false;
    instance.interimResults = true;
    instance.maxAlternatives = 1;
    instance.lang = lang || "en-US";
    instance.onstart = () => {
      recording = true;
      onStart?.();
    };
    instance.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (interimText) onInterim?.(interimText);
      if (finalText) onFinal?.(finalText);
    };
    instance.onerror = (e) => {
      recording = false;
      onError?.(e?.error || "error");
    };
    instance.onend = () => {
      recording = false;
      onEnd?.();
    };
  }

  return {
    supported: true,
    isRecording: () => recording,
    start() {
      if (recording) return;
      rec = new SR();
      bind(rec);
      rec.start();
    },
    stop() {
      try { rec?.stop(); } catch { /* already stopped */ }
    },
    setLang(next) {
      lang = next || "en-US";
      if (rec) rec.lang = lang;
    },
  };
}
