"use client";
// Read pre-approved text aloud with the device's own voices (offline on phones and laptops).
// Only fixed sentences from the hub are ever spoken; nothing is generated.
const PREFERRED = { en: ["en-IN", "en-GB", "en-US"], hi: ["hi-IN"], ta: ["ta-IN"], th: ["th-TH"], ja: ["ja-JP"] };
// plain, natural voices first where the device has them (macOS/iOS also ship character voices)
const NAMES = { en: ["Rishi", "Veena"], hi: ["Lekha"], ta: ["Vani"], th: ["Kanya"], ja: ["Kyoko", "O-Ren", "Otoya"] };

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
  if (!voice) return false;
  speechSynthesis.cancel();
  for (const text of [].concat(lines).filter(Boolean)) {
    const u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rate;             // a little slower than normal: clearer for seniors and in noise
    speechSynthesis.speak(u);
  }
  return true;
}

export function stopSpeaking() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
