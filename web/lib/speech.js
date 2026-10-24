"use client";
// Read pre-approved text aloud with the device's own voices (offline on phones and laptops).
// Only fixed sentences from the hub are ever spoken; nothing is generated.
const PREFERRED = { en: ["en-IN", "en-GB", "en-US"], hi: ["hi-IN"], ta: ["ta-IN"], th: ["th-TH"], ja: ["ja-JP"] };
// plain, natural voices first where the device has them (macOS/iOS also ship character voices)
const NAMES = { en: ["Rishi", "Veena"], hi: ["Lekha"], ta: ["Vani"], th: ["Kanya"], ja: ["Kyoko", "O-Ren", "Otoya"] };

// Whether any voice (browser TTS or Kokoro) is playing right now, plus a short cooldown after it
// ends — a phone's mic picks up its own speaker even with echoCancellation on, so Live Conversation
// (web/components/liveconversation.jsx, app/passenger/page.jsx) mutes listening while this is true,
// instead of transcribing its own reply back as a new utterance.
let speaking = false;
const speakListeners = new Set();
const COOLDOWN_MS = 350;
function setSpeaking(v) {
  if (speaking === v) return;
  speaking = v;
  speakListeners.forEach((fn) => fn(v));
}
export function isSpeaking() { return speaking; }
export function onSpeakingChange(fn) { speakListeners.add(fn); return () => speakListeners.delete(fn); }

let voices = [];
const ready = typeof window === "undefined" ? Promise.resolve([]) : new Promise((resolve) => {
  if (!("speechSynthesis" in window)) return resolve([]);
  const load = () => { voices = speechSynthesis.getVoices(); if (voices.length) resolve(voices); };
  load();
  speechSynthesis.addEventListener?.("voiceschanged", load);
  setTimeout(() => resolve(voices), 1500);   // some browsers never fire voiceschanged
});

function voiceFor(lang) {
  const wanted = PREFERRED[lang] || [lang];
  const offline = voices.filter((v) => v.localService !== false);   // never send text to an online voice service
  for (const name of NAMES[lang] || []) {
    const v = offline.find((x) => x.name.startsWith(name) && x.lang.toLowerCase().startsWith(lang));
    if (v) return v;
  }
  for (const tag of wanted) {
    const v = offline.find((x) => x.lang.toLowerCase() === tag.toLowerCase())
      || offline.find((x) => x.lang.toLowerCase().startsWith(tag.slice(0, 2).toLowerCase()));
    if (v) return v;
  }
  return null;
}

export async function canSpeak(lang) {
  await ready;
  return !!voiceFor(lang);
}

// Speak lines in order; a new call replaces whatever is still being read.
export async function speak(lines, lang, { rate = 0.9 } = {}) {
  await ready;
  const voice = voiceFor(lang);
  const items = [].concat(lines).filter(Boolean);
  if (!voice || !items.length) return false;
  speechSynthesis.cancel();
  setSpeaking(true);
  let remaining = items.length;
  const finish = () => { remaining -= 1; if (remaining <= 0) setTimeout(() => setSpeaking(false), COOLDOWN_MS); };
  for (const text of items) {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;             // a little slower than normal: clearer for seniors and in noise
    u.onend = finish;
    u.onerror = finish;
    speechSynthesis.speak(u);
  }
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  setSpeaking(false);
}

// Phones block audio.play() unless it happens inside a real tap/click; a Live Conversation
// reply arrives over the WebSocket, not from a tap, so without this every speakNatural() call
// would silently fail on iOS/Android. Call unlockAudio() once, directly inside a genuine click
// handler (both app pages do this on the page's first pointerdown, the same moment crew/page.jsx
// already unlocks its AudioContext for the request chime), and reuse the same <audio> element
// for every later play() — once unlocked, replaying *that* element keeps working all session.
let sharedAudio = null;
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

export function unlockAudio() {
  if (typeof window === "undefined" || sharedAudio) return;
  sharedAudio = new Audio(SILENT_WAV);
  sharedAudio.play().catch(() => { sharedAudio = null; });   // not a real gesture after all; try again next time
}

// Prefers Auralink's own offline voice (Kokoro, engine/tts.py — far more natural than the OS
// voice above) and falls back to speak() above for a language Kokoro doesn't cover (Tamil,
// Thai) or if the hub's model files aren't downloaded yet. Same "pre-approved text only" rule.
export async function speakNatural(lines, lang, opts = {}) {
  const text = [].concat(lines).filter(Boolean).join(". ");
  if (!text) return false;
  try {
    const res = await fetch("/api/freetalk/speak", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, lang }),
    });
    if (res.ok) {
      stopSpeaking();
      const url = URL.createObjectURL(await res.blob());
      const audio = sharedAudio || new Audio();
      audio.src = url;
      audio.onended = audio.onerror = () => setTimeout(() => setSpeaking(false), COOLDOWN_MS);
      setSpeaking(true);
      audio.play().catch((e) => { console.warn("Auralink: voice playback blocked", e); setSpeaking(false); });
      return true;
    }
  } catch { /* fall through to the browser's own voice */ }
  return speak(lines, lang, opts);
}
