"use client";
// Passenger seat screen. Same protocol and behaviour as the original apps/passenger.html.
import { AnimatePresence, motion } from "framer-motion";
import jsQR from "jsqr";
import { useEffect, useReducer, useRef, useState } from "react";
import { Recorder, VadRecorder, connect, loadConfig, params, toBase64 } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { ACCESSIBILITY_META } from "@/lib/accessibility";
import { Picto } from "@/lib/pictograms";
import { canSpeak, isSpeaking, onSpeakingChange, speakNatural as speak, unlockAudio } from "@/lib/speech";
import { Ambient, Carousel, Sheet, ease, useFlash } from "@/components/ui";
import { ConvThread, MuteButton } from "@/components/liveconversation";
import { Onboarding, OnboardingFab } from "@/components/onboarding";

const OFFLINE_AFTER_MS = 6000;   // hub.js retries every 1s; a handful of failed tries, not one blip

export default function Passenger() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const st = useRef(null);
  const level = useRef(null);
  const [flashFrame, flash] = useFlash();
  if (!st.current) st.current = { ready: false, awaitingSeat: false, seatInvalid: false, onboarding: false, cfg: null, strings: {}, fallback: {}, lang: "en", senior: false, pictures: false, readAloud: false, accessibility: null, name: null, voiceOK: false,
    micState: "idle", micNote: "", requests: new Map(), pending: [], waitingTriage: null, sheet: null, caption: null, online: false, offline: false, titleOverride: null, seat: null,
    conv: { open: false, speaking: false, replyPlaying: false, muted: false, partial: "", messages: [], spoken: new Set() } };
  const s = st.current;
  const socket = useRef(null);
  const recorder = useRef(null);
  const vad = useRef(null);
  const convUnsub = useRef(null);
  const captionTimer = useRef(0);
  const offlineTimer = useRef(0);   // a short drop is normal (hub.js retries every 1s); only call it "offline" if it lasts
  const flashRef = useRef(flash); flashRef.current = flash;
  const shake = useRef({ x: null, y: null, z: null, hits: 0, lastHitAt: 0, cooldownUntil: 0, listening: false });

  const t = (k) => s.strings[k] ?? s.fallback[k] ?? k;
  const hello = () => socket.current?.send({ type: "hello", lang: s.lang, senior: s.senior, pictures: s.pictures, read: s.readAloud, accessibility: s.accessibility, name: s.name || undefined });
  const bigMode = () => s.senior || s.accessibility === "low_vision";
  const pictureMode = () => s.pictures || s.accessibility === "cognitive";
  const say = (lines) => { if (s.readAloud && s.voiceOK && !pictureMode()) speak(lines, s.lang); };
  const Listen = ({ lines }) => (!s.voiceOK || pictureMode() ? null :
    <button className="listen" aria-label={t("listen")} title={t("listen")} onClick={() => speak(lines, s.lang)}><Icon id="speaker" /></button>);
  const attention = () => flashRef.current();

  async function loadStrings(code) {
    const get = (c) => fetch(`/api/i18n/${c}`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    [s.fallback, s.strings] = await Promise.all([get("en"), get(code)]);
  }
  function setSheet(content) { if (content) closeCaption(); s.sheet = content; bump(); }
  const closeSheet = () => setSheet(null);
  function closeCaption() { clearTimeout(captionTimer.current); s.caption = null; }
  function setMic(state) { s.micState = state; bump(); }

  // --- confirm one card at a time; split utterances queue the rest ---
  function showNextConfirm() {
    const card = s.pending.shift();
    if (!card) {
      if (s.waitingTriage) { const w = s.waitingTriage; s.waitingTriage = null; return showTriage(w); }
      return closeSheet();
    }
    if (card.confident) {
      const o = card.options[0];
      say([t("confirmQ"), o.label]);
      setSheet(<div key={card.id} style={{ display: "contents" }}>
        <div className="row"><h2 className="grow">{t("confirmQ")}</h2><Listen lines={[t("confirmQ"), o.label]} /></div>
        <motion.div className="tile static" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.1, ease }}>
          <Icon id={o.intent} />{o.label}</motion.div>
        <div className="row">
          <button className="primary grow" onClick={() => { socket.current.send({ type: "confirm", card_id: card.id, intent: o.intent }); showNextConfirm(); }}>{t("yes")}</button>
          <button className="grow" onClick={() => socket.current.send({ type: "reject", card_id: card.id })}>{t("no")}</button>
        </div>
      </div>);
    } else {
      const opts = card.options.slice(0, 2);
      say([t("pickOne"), ...opts.map((o) => o.label)]);
      setSheet(<div key={card.id} style={{ display: "contents" }}>
        <div className="row"><h2 className="grow">{t("pickOne")}</h2><Listen lines={[t("pickOne"), ...opts.map((o) => o.label)]} /></div>
        <div className="grid">{opts.map((o, k) => (
          <motion.button key={o.intent} className="tile" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 * k, ease }}
            onClick={() => { socket.current.send({ type: "confirm", card_id: card.id, intent: o.intent }); showNextConfirm(); }}>
            <Icon id={o.intent} />{o.label}</motion.button>))}</div>
        <button onClick={() => socket.current.send({ type: "reject", card_id: card.id })}>{t("none")}</button>
      </div>);
    }
  }

  function showGrid(cardId) {
    say(t("together"));
    setSheet(<div key={`grid-${cardId || ""}`} style={{ display: "contents" }}>
      <h2>{t("together")}</h2>
      <IntentGrid intents={s.cfg.intents} lang={s.lang} onPick={(intent) => {
        socket.current.send(cardId ? { type: "icon", card_id: cardId, intent } : { type: "icon", intent });
        showNextConfirm();
      }} />
    </div>);
  }

  function showSuggest(msg) {
    const { heard, guess, translated } = msg;
    say(t("suggestTitle"));
    setSheet(<div key={`suggest-${heard}`} style={{ display: "contents" }}>
      <h2>{t("suggestTitle")}</h2>
      <p className="muted" style={{ margin: 0 }}>&ldquo;{heard}&rdquo;</p>
      {guess ? (
        <div className="item">
          <Icon id={guess.intent} /><strong className="grow">{t("suggestDidYouMean")} {guess.label}?</strong>
          <button className="primary" onClick={() => { socket.current.send({ type: "icon", intent: guess.intent }); showNextConfirm(); }}>{t("yes")}</button>
        </div>
      ) : null}
      {translated ? (
        <div className="item">
          <Icon id="globe" /><span className="grow">{translated}</span>
          <button className="primary" onClick={() => { socket.current.send({ type: "send_free_text", text: heard, translated }); closeSheet(); }}>{t("suggestSendBtn")}</button>
        </div>
      ) : null}
      <button className="link" onClick={() => showGrid()}>{t("suggestOrPicture")}</button>
    </div>);
  }

  function showSettings() {
    setSheet(<div key="settings" style={{ display: "contents" }}>
      <h2>{t("settingsTitle")}</h2>
      <div className="settings-sheet">
        <div className="settings-row">
          <span>{t("language")}</span>
          <select aria-label={t("language")} value={s.lang} onChange={(e) => setLanguage(e.target.value)}>
            {s.cfg.languages.map((l) => <option key={l.code} value={l.code}>{l.english && l.english !== l.name ? `${l.name} · ${l.english}` : l.name}</option>)}
          </select>
        </div>
        <div className="settings-row">
          <span>{t("seniorLabel")}</span>
          <button className="toggle" role="switch" aria-pressed={s.senior} aria-label={t("seniorLabel")}
            onClick={() => { s.senior = !s.senior; showSettings(); hello(); }} />
        </div>
        <div className="settings-row">
          <span>{t("picturesLabel")}</span>
          <button className="toggle" role="switch" aria-pressed={s.pictures} aria-label={t("picturesLabel")}
            onClick={() => { s.pictures = !s.pictures; showSettings(); hello(); }} />
        </div>
        {s.voiceOK ? (
          <div className="settings-row">
            <span>{t("readLabel")}</span>
            <button className="toggle" role="switch" aria-pressed={s.readAloud} aria-label={t("readLabel")}
              onClick={() => { s.readAloud = !s.readAloud; if (s.readAloud) speak(t("readLabel"), s.lang); showSettings(); hello(); }} />
          </div>
        ) : null}
        <div className="settings-row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <span>{t("accessibilityLabel")}</span>
          <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {Object.entries(ACCESSIBILITY_META).map(([id, m]) => (
              <button key={id} className={`tile ${s.accessibility === id ? "active" : ""}`}
                aria-pressed={s.accessibility === id}
                onClick={() => { s.accessibility = s.accessibility === id ? null : id; showSettings(); hello(); }}>
                <Icon id={m.icon} />{s.lang === "ja" ? m.ja : m.en}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>);
  }

  function showTriage(msg) {
    attention(); say(msg.triage.title);
    setSheet(<div key={`tri-${msg.card_id}`} style={{ display: "contents" }}>
      <div className="row"><h2 className="grow urgent-title">{msg.triage.title}</h2><Listen lines={msg.triage.title} /></div>
      <Carousel className="triage">{msg.triage.symptoms.map((x) => (
        <button key={x.id} className="tile" onClick={() => socket.current.send({ type: "symptom", card_id: msg.card_id, symptom: x.id })}><Icon id={x.icon} />{x.label}</button>))}</Carousel>
    </div>);
  }

  const counter = (word, i, n) => `${word} ${i} ${t("of")} ${n}`;
  function showBriefing(b) {
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    say([b.title, ...b.steps.map((x) => x.text)]);
    setSheet(<div key={`brief-${b.title}`} style={{ display: "contents" }}>
      <div className="row"><h2 className="safety-title grow">{b.title}</h2><Listen lines={[b.title, ...b.steps.map((x) => x.text)]} /></div>
      {b.steps.map((x, k) => (
        <motion.div className="safety-step" key={k} initial={{ opacity: 0, x: -14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + k * 0.12, ease }}>
          <Picto id={x.pictogram} />
          <div className="grow"><p className="safety-text">{x.text}</p>{s.lang !== "en" ? <p className="muted" style={{ margin: "2px 0 0" }}>{x.text_en}</p> : null}</div>
          <Listen lines={x.text} />
        </motion.div>))}
      <div className="row">
        <button className="primary grow" onClick={() => { socket.current.send({ type: "safety", status: "understood" }); closeSheet(); }}>{t("understood")}</button>
        <button className="grow" onClick={() => { socket.current.send({ type: "safety", status: "reexplaining" }); simpleStep(b, 0); }}>{t("explain")}</button>
      </div>
    </div>);
  }

  function simpleStep(b, i) {
    if (i >= b.steps.length) {
      socket.current.send({ type: "safety", status: "understood_again" });
      setSheet(<div key="thanks" style={{ display: "contents" }}><h2>{t("thanks")}</h2><button className="primary" onClick={closeSheet}>{t("ok")}</button></div>);
      return;
    }
    const x = b.steps[i];
    say(x.simple);
    setSheet(<div key={`step-${i}`} style={{ display: "contents" }}>
      <p className="muted" style={{ margin: 0 }}>{i === 0 ? t("reexplain") : counter(t("step"), i + 1, b.steps.length)}</p>
      {i === 0 ? <p className="muted" style={{ margin: 0 }}>{counter(t("step"), 1, b.steps.length)}</p> : null}
      <Picto id={x.pictogram} big />
      <p className="safety-simple">{x.simple} <Listen lines={x.simple} /></p>
      <div className="row">
        <button className="primary grow" onClick={() => simpleStep(b, i + 1)}>{t("gotIt")}</button>
        <button className="grow" onClick={() => {
          socket.current.send({ type: "safety", status: "stuck", step: i });
          say(t("crewComing"));
          setSheet(<div key="coming" style={{ display: "contents" }}><h2>{x.simple}</h2><p>{t("crewComing")}</p><button className="primary" onClick={closeSheet}>{t("ok")}</button></div>);
        }}>{t("stillUnclear")}</button>
      </div>
    </div>);
  }

  function showExitCheck(c) {
    const answers = {};
    const ask = (i) => {
      if (i >= c.questions.length) return socket.current.send({ type: "exit_answer", answers });
      const q = c.questions[i];
      say(i === 0 ? [c.title, c.intro, q.text] : q.text);
      setSheet(<div key={`exit-${i}`} style={{ display: "contents" }}>
        <h2 className="safety-title">{c.title}</h2>{i === 0 ? <p style={{ margin: 0 }}>{c.intro}</p> : null}
        <p className="muted" style={{ margin: 0 }}>{counter(t("question"), i + 1, c.questions.length)}</p>
        <Picto id={q.pictogram} big />
        <p className="safety-simple">{q.text} <Listen lines={q.text} /></p>
        <div className="row">
          <button className="primary grow" onClick={() => { answers[q.id] = true; ask(i + 1); }}>{c.answers.yes}</button>
          <button className="grow" onClick={() => { answers[q.id] = false; ask(i + 1); }}>{c.answers.no}</button>
        </div>
        <button className="link" onClick={() => socket.current.send({ type: "exit_answer", answers, reseat: true })}>{c.answers.reseat}</button>
      </div>);
    };
    ask(0);
  }

  function showCaption(c) {
    attention(); say(c.text);
    s.caption = c; bump();
    clearTimeout(captionTimer.current);
    captionTimer.current = setTimeout(() => { closeCaption(); bump(); }, 90_000);
  }

  function onMessage(msg) {
    if (["confirm", "grid", "status", "error", "suggest"].includes(msg.type) && s.micState === "thinking") setMic("idle");
    if (msg.type === "thinking") setMic("thinking");
    else if (msg.type === "confirm") { s.pending = msg.cards; showNextConfirm(); }
    else if (msg.type === "grid") showGrid(msg.card_id);
    else if (msg.type === "suggest") showSuggest(msg);
    else if (msg.type === "status") {
      const c = msg.card;
      const shown = c.intent || c.options?.[0] || { intent: "call_crew", label: "" };
      const state = c.status === "acknowledged" ? "seen" : "sent";
      s.requests.set(c.id, { id: c.id, intent: shown.intent, label: shown.label, message: msg.message, urgent: c.urgent, state });
      if (c.status === "needs_human") closeSheet();
      if (state === "seen" || c.status === "needs_human") { attention(); say(msg.message); }
      bump();
    } else if (msg.type === "reply") {
      const r = s.requests.get(msg.card_id);
      if (r) { r.message = msg.text; r.state = "replied"; attention(); say(msg.text); bump(); }
    } else if (msg.type === "notice") {
      s.titleOverride = msg.message; bump();
      setTimeout(() => { s.titleOverride = null; bump(); }, 6000);
    } else if (msg.type === "pa") showCaption(msg.caption);
    else if (msg.type === "safety") { attention(); showBriefing(msg.template); }
    else if (msg.type === "exit_check") { attention(); showExitCheck(msg.check); }
    else if (msg.type === "triage") { if (s.pending.length) s.waitingTriage = msg; else showTriage(msg); }
    else if (msg.type === "triage_done") {
      say(msg.message);
      setSheet(<div key="tridone" style={{ display: "contents" }}><h2>{msg.message}</h2><button className="primary" onClick={closeSheet}>{t("ok")}</button></div>);
    } else if (msg.type === "reset") { s.pending = []; s.requests.clear(); closeSheet(); }
    else if (msg.type === "exit_done") {
      say(msg.message);
      setSheet(<div key="exitdone" style={{ display: "contents" }}><h2>{t("thanks")}</h2><p>{msg.message}</p><button className="primary" onClick={closeSheet}>{t("ok")}</button></div>);
    } else if (msg.type === "conv_message") {
      s.conv.partial = "";
      const i = s.conv.messages.findIndex((m) => m.id === msg.id);
      if (i >= 0) s.conv.messages[i] = msg; else s.conv.messages = [...s.conv.messages, msg];
      // Crew's reply is always spoken here, in the passenger's language. The passenger's own
      // line is only ALSO spoken here, in Japanese, when no crew tablet is actually connected --
      // real two-device use already has crew's own tablet speak that side (crew/page.jsx), so a
      // real passenger's phone isn't narrating Japanese at them after every sentence; testing
      // solo with one screen, there is no other device to do it, so this one does both.
      // spoken: a message can be re-delivered (a "done" resend, a reconnect) -- speak it once.
      const shouldSpeak = msg.from === "crew" || !msg.crew_listening;
      if (shouldSpeak && msg.done && msg.translated && !s.conv.muted && !s.conv.spoken.has(msg.id)) {
        s.conv.spoken.add(msg.id);
        speak(msg.translated, msg.from === "crew" ? s.lang : "ja");
      }
      bump();
    } else if (msg.type === "conv_partial") {
      s.conv.partial = msg.text; bump();
    }
  }

  // tag(buf): 1-byte header so the hub can tell a still-being-spoken partial (shown only on this
  // screen, as a live caption) from the finished utterance (transcribed, translated, sent on) —
  // see hub/main.py passenger_ws / handle_conv_audio.
  const FINAL = 0, PARTIAL = 1;
  function tag(kind, buf) {
    const out = new Uint8Array(buf.byteLength + 1);
    out[0] = kind; out.set(new Uint8Array(buf), 1);
    return out.buffer;
  }

  async function startConv() {
    if (vad.current) return;
    s.conv.open = true; s.conv.partial = ""; s.conv.spoken.clear(); bump();
    socket.current.send({ type: "conv_start" });
    convUnsub.current = onSpeakingChange((on) => { s.conv.replyPlaying = on; bump(); });
    vad.current = new VadRecorder({
      onUtterance: (buf) => socket.current.sendBinary(tag(FINAL, buf)),
      onPartial: (buf) => socket.current.sendBinary(tag(PARTIAL, buf)),
      onSpeaking: (sp) => { s.conv.speaking = sp; if (!sp) s.conv.partial = ""; bump(); },
      isMuted: () => isSpeaking(),
    });
    try { await vad.current.start(); } catch { s.micNote = "micDenied"; bump(); }
  }

  function stopConv() {
    vad.current?.stop(); vad.current = null;
    convUnsub.current?.(); convUnsub.current = null;
    s.conv.open = false; s.conv.speaking = false; s.conv.replyPlaying = false; s.conv.partial = ""; bump();
    socket.current.send({ type: "conv_end" });
  }

  async function toggleMic() {
    if (s.micState === "idle") {
      recorder.current = new Recorder();
      try {
        await recorder.current.start(8, () => s.micState === "recording" && toggleMic(),
          (v) => { if (level.current) level.current.style.width = `${Math.round(v * 100)}%`; });
        setMic("recording");
      } catch { s.micNote = "micDenied"; bump(); }
    } else if (s.micState === "recording") {
      setMic("thinking");
      if (level.current) level.current.style.width = "0%";
      socket.current.sendBinary(await recorder.current.stop());
    }
  }

  function callCrewByShake() {
    const now = Date.now();
    if (now < shake.current.cooldownUntil) return;
    shake.current.cooldownUntil = now + 8000; // don't send another one while the phone is still being shaken
    socket.current?.send({ type: "icon", intent: "call_crew", source: "shake" });
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    attention();
    s.titleOverride = t("shakeSent"); bump();
    setTimeout(() => { s.titleOverride = null; bump(); }, 4000);
  }

  async function setLanguage(code) {
    s.lang = code;
    try { localStorage.setItem(`auralink-lang-${s.seat}`, code); } catch { /* private mode */ }
    await loadStrings(code);
    s.voiceOK = await canSpeak(code);
    document.documentElement.lang = code;
    bump(); hello();
  }

  function chooseLanguage() {
    setSheet(<div key="choose" style={{ display: "contents" }}>
      <span className="mono" style={{ color: "var(--accent)", fontSize: 12, letterSpacing: ".14em" }}>SEAT {s.seat}</span>
      <h2 className="choose-title">Choose your language</h2>
      <p className="muted" style={{ margin: 0 }}>अपनी भाषा चुनें · உங்கள் மொழியைத் தேர்ந்தெடுக்கவும் · เลือกภาษาของคุณ</p>
      <div className="choose-langs">{s.cfg.languages.map((l, k) => (
        <motion.button key={l.code} className="choose-lang" lang={l.code} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 * k, ease }}
          onClick={async () => { closeSheet(); await setLanguage(l.code); }}>
          <b>{l.name}</b>{l.english !== l.name ? <small lang="en">{l.english}</small> : null}</motion.button>))}</div>
      <p className="muted" style={{ margin: 0 }}>You can change it any time at the top of the screen.</p>
    </div>);
  }

  const aliveRef = useRef(true);

  function boot(seat, p) {
    s.seat = seat;
    let markReady;
    const ready = new Promise((r) => (markReady = r));
    socket.current = connect(`/ws/passenger/${s.seat}`, (msg) => ready.then(() => aliveRef.current && onMessage(msg)), (on) => {
      s.online = on; bump();
      if (on) {
        clearTimeout(offlineTimer.current); offlineTimer.current = 0;
        s.offline = false; bump();
        ready.then(() => hello());
      } else if (!offlineTimer.current) {
        // fails safe: typing and voice need the hub, so after a few failed 1s reconnect tries
        // (not just one dropped frame) switch to a no-server fallback -- the picture grid already
        // renders from what's already loaded (local icons, strings in memory) and keeps working;
        // tapping one still queues over the socket and is delivered the moment it reconnects.
        // hub.js retries every 1s while down, calling this "disconnected" branch again on every
        // failed retry: only arm the timer on the *first* one (while none is already pending), or
        // it would keep getting reset before ever getting 6 uninterrupted seconds to fire.
        offlineTimer.current = setTimeout(() => { offlineTimer.current = 0; s.offline = true; bump(); }, OFFLINE_AFTER_MS);
      }
    }, () => { s.seatInvalid = true; bump(); });
    (async () => {
      let checkedIn = false;
      if (!["lang", "senior", "mode", "read", "accessibility"].some((k) => p.has(k))) {
        try {
          const r = await (await fetch(`/api/seat/${s.seat}`)).json();
          if (r.checked_in) { checkedIn = true; Object.assign(s, { lang: r.lang, senior: r.senior, pictures: r.pictures, readAloud: r.read, accessibility: r.accessibility ?? null }); }
        } catch { /* hub unreachable */ }
      }
      let askLanguage = false;
      if (!p.has("lang") && !checkedIn) {
        let saved = null;
        try { saved = localStorage.getItem(`auralink-lang-${s.seat}`); } catch { /* blocked */ }
        if (s.cfg.languages.some((l) => l.code === saved)) s.lang = saved; else askLanguage = true;
      }
      if (!s.cfg.languages.some((l) => l.code === s.lang)) s.lang = "en";
      await loadStrings(s.lang);
      s.voiceOK = await canSpeak(s.lang);
      if (!Recorder.supported()) { s.micState = "off"; s.micNote = "micOff"; }
      document.documentElement.lang = s.lang;
      s.ready = true; bump();
      markReady();
      // Same gate as the plain language prompt below: skip it for a checked-in seat (already
      // configured at the kiosk) or a demo link with an explicit ?lang=, same as before.
      if (askLanguage) {
        let onboarded = false;
        try { onboarded = localStorage.getItem(`auralink-onboarded-${s.seat}`) === "1"; } catch { /* blocked */ }
        if (onboarded) chooseLanguage(); else { s.onboarding = true; bump(); }
      }
    })();
  }

  // The shared scanner lands here with no ?seat= at all: one QR code for the whole cabin
  // instead of one per seat (there's no screen on every seat to print one onto). The passenger
  // picks their seat on the map below before anything connects to the hub.
  function confirmSeat(seat, name) {
    s.awaitingSeat = false; s.name = name || null; bump();
    boot(seat, params());
  }

  useEffect(() => {
    addEventListener("pointerdown", unlockAudio, { once: true });
    const p = params();
    s.lang = p.get("lang") || "en";
    s.senior = p.get("senior") === "1";
    s.pictures = p.get("mode") === "pictures";
    s.readAloud = p.get("read") === "1";
    s.accessibility = ACCESSIBILITY_META[p.get("accessibility")] ? p.get("accessibility") : null;
    (async () => {
      s.cfg = await loadConfig();
      const seatParam = p.get("seat");
      if (seatParam) boot(seatParam, p);
      else { s.awaitingSeat = true; bump(); }
    })();
    return () => { aliveRef.current = false; socket.current?.close(); vad.current?.stop(); convUnsub.current?.(); clearTimeout(offlineTimer.current); removeEventListener("pointerdown", unlockAudio); };
  }, []); // eslint-disable-line

  // Shake to call the crew: 3 strong jolts within ~2s, same request as tapping "Call crew".
  useEffect(() => {
    const HAS_MOTION = typeof window !== "undefined" && typeof DeviceMotionEvent !== "undefined";
    if (!HAS_MOTION) return;
    const JOLT = 16;          // m/s^2 change between samples that counts as a jolt
    const JOLT_WINDOW_MS = 2000;

    function onMotion(e) {
      const acc = e.accelerationIncludingGravity || e.acceleration;
      if (!acc || acc.x == null) return;
      const st = shake.current;
      if (st.x != null) {
        const delta = Math.abs(acc.x - st.x) + Math.abs(acc.y - st.y) + Math.abs(acc.z - st.z);
        if (delta > JOLT) {
          const now = Date.now();
          if (now - st.lastHitAt > JOLT_WINDOW_MS) st.hits = 0;
          st.lastHitAt = now;
          st.hits += 1;
          if (st.hits >= 3) { st.hits = 0; callCrewByShake(); }
        }
      }
      st.x = acc.x; st.y = acc.y; st.z = acc.z;
    }

    function enable() {
      if (shake.current.listening) return;
      shake.current.listening = true;
      window.addEventListener("devicemotion", onMotion);
    }

    // iOS needs a user gesture to ask for motion permission; piggyback on the first tap anywhere.
    let onFirstTap;
    if (typeof DeviceMotionEvent.requestPermission === "function") {
      onFirstTap = () => { DeviceMotionEvent.requestPermission().then((r) => r === "granted" && enable()).catch(() => {}); };
      document.addEventListener("pointerdown", onFirstTap, { once: true });
    } else {
      enable();
    }
    return () => {
      window.removeEventListener("devicemotion", onMotion);
      if (onFirstTap) document.removeEventListener("pointerdown", onFirstTap);
    };
  }, []); // eslint-disable-line

  if (s.awaitingSeat) return <SeatGate cfg={s.cfg} onConfirm={confirmSeat} />;

  if (s.seatInvalid) return (
    <><Ambient />
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div className="panel" style={{ maxWidth: 360, textAlign: "center", display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 style={{ margin: 0 }}>Seat not found</h2>
          <p className="muted" style={{ margin: 0 }}>“{s.seat}” isn’t a seat on this flight. Pick your seat below instead.</p>
          <button className="primary" onClick={() => { location.href = "/passenger"; }}>Pick my seat</button>
        </div>
      </div>
    </>
  );

  if (!s.ready) return (<><Ambient /><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><span className="mono faint">Auralink · connecting to the cabin…</span></div></>);
  if (s.onboarding) return (
    <Onboarding cfg={s.cfg} seat={s.seat} lang={s.lang} onSelectLanguage={setLanguage}
      accessibility={{ senior: s.senior, pictures: s.pictures, readAloud: s.readAloud, accessibility: s.accessibility }}
      onSetAccessibility={(patch) => { Object.assign(s, patch); bump(); hello(); }}
      onComplete={() => { s.onboarding = false; bump(); }} />
  );

  const reqs = [...s.requests.values()].reverse();
  const micLabel = t({ idle: "speak", recording: "stop", thinking: "thinking", off: "speak" }[s.micState]);
  return (
    <div className={`${bigMode() ? "big" : ""} ${pictureMode() ? "pictures" : ""}`}>
      <Ambient />
      {flashFrame}
      <header className="app-header pax-header">
        <span className="hdr-icon-btn" aria-hidden="true"><span className={`dot ${s.online ? "on" : ""}`} title="Connection" /></span>
        <div className="grow">
          <h1><AnimatePresence mode="wait"><motion.span key={s.titleOverride || "t"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>{s.titleOverride || t("title")}</motion.span></AnimatePresence></h1>
          <p className="hdr-sub">{t("seat")} {s.seat} · {s.cfg.languages.find((l) => l.code === s.lang)?.name || s.lang}</p>
        </div>
        {s.cfg.free_talk ? (
          <button className={`hdr-icon-btn ${s.conv.open ? "on" : ""}`} aria-pressed={s.conv.open}
            aria-label={t("liveConv")} title={t("liveConv")} onClick={s.conv.open ? stopConv : startConv}>
            <Icon id={s.conv.open ? "stop" : "chat"} />
          </button>
        ) : null}
        <a className="hdr-icon-btn" aria-label={t("afterLanding")} title={t("afterLanding")} href={`/arrival?seat=${s.seat}&lang=${s.lang}`}><Icon id="arrived" /></a>
        <button className="hdr-icon-btn" aria-label={t("settingsTitle")} title={t("settingsTitle")} onClick={showSettings}><Icon id="settings" /></button>
      </header>

      <main className="app pax-shell">
        <div className="pax-col pax-col-main">
        {s.offline ? (
          <motion.section className="panel ask-hero offline-card" role="alert" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            <h2><Icon id="alert" />{t("offlineTitle")}</h2>
            <p className="offline-body">{t("offlineBody")}</p>
          </motion.section>
        ) : null}
        {!pictureMode() && !s.offline ? (
          <motion.section className="panel ask-hero" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            {!s.conv.open ? (
              <div className="row" style={{ alignItems: "flex-start" }}>
                <div className="grow">
                  <h2>{t("typeHint")}</h2>
                  {s.micState === "thinking" ? (
                    <p className="sub"><span className="ask-thinking">{[0, 1, 2].map((k) => (
                      <motion.i key={k} animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: k * 0.18 }} />))}</span> {t("thinking")}</p>
                  ) : s.micNote ? <p className="sub">{t(s.micNote)}</p> : null}
                </div>
              </div>
            ) : <h2>{t("liveConv")}</h2>}
            {s.conv.open ? (
              <div className="conv-panel">
                <div className="conv-status">
                  <span className={`listen-dot ${s.conv.speaking ? "speaking" : ""} ${s.conv.replyPlaying ? "muted" : ""}`} />
                  <span className="grow">{t(s.conv.replyPlaying ? "convReplyPlaying" : s.conv.speaking ? "convSpeaking" : "convListening")}</span>
                  <MuteButton muted={s.conv.muted} onClick={() => { s.conv.muted = !s.conv.muted; bump(); }} label={t(s.conv.muted ? "unmute" : "mute")} />
                </div>
                <ConvThread messages={s.conv.messages} mineFrom="passenger" partial={s.conv.partial} />
              </div>
            ) : null}
            {!s.conv.open ? (
              <form className="ask-bar" onSubmit={(e) => {
                e.preventDefault();
                const input = e.currentTarget.elements.text; const text = input.value.trim();
                if (!text) return;
                socket.current.send({ type: "text", text }); input.value = "";
              }}>
                <button type="button" className={`ask-round mic-on ${s.micState === "recording" ? "recording" : ""}`} onClick={toggleMic}
                  disabled={s.micState === "thinking" || s.micState === "off"} aria-label={micLabel} title={micLabel}>
                  {s.micState === "recording" ? <motion.span className="icon" animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1.1 }}><Icon id="mic" /></motion.span> : <Icon id="mic" />}
                  <span className="level" ref={level} />
                </button>
                <input className="grow" name="text" autoComplete="off" placeholder="thoda wotter and kambal" aria-label={t("typeHint")} />
                <button className="ask-round send" type="submit" aria-label={t("send")} title={t("send")}><Icon id="arrow" /></button>
              </form>
            ) : null}
          </motion.section>
        ) : null}

        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease }}>
          <h2>{pictureMode() ? t("tapNeed") : t("orTap")}</h2>
          <IntentGrid intents={s.cfg.intents} lang={s.lang} big={pictureMode()} onPick={(intent) => socket.current.send({ type: "icon", intent })} />
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>{t("shakeHint")}</p>
        </motion.section>
        </div>

        <div className="pax-col pax-col-side">
        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.16, ease }}>
          <h2>{t("requestsLabel")}</h2>
          <div className="list">
            <AnimatePresence initial={false}>
              {reqs.map((r) => (
                <motion.div layout key={r.id} className={`item ${r.urgent ? "is-urgent" : ""}`} initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease }}>
                  <Icon id={r.intent} /><strong>{r.label}</strong>
                  <motion.span key={r.state} className="state" title={t(r.state)} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
                    <Icon id={{ sent: "check", seen: "eye", replied: "reply" }[r.state] || "check"} label={t(r.state)} /></motion.span>
                  <span className="muted grow">{r.message}</span>
                  <Listen lines={[r.label, r.message]} />
                </motion.div>))}
            </AnimatePresence>
            {!reqs.length ? (
              <div className="empty-state">
                <span className="icon"><Icon id="inbox" /></span>
                <p className="empty-title">{t("noRequestsTitle")}</p>
                <p className="empty-sub">{t("noRequestsSub")}</p>
              </div>
            ) : null}
          </div>
        </motion.section>
        </div>
      </main>

      <Sheet content={s.sheet} big={bigMode()} onClose={closeSheet} />

      <AnimatePresence>
        {s.caption ? (
          <motion.div className="pa-banner" role="alert" key="pa" initial={{ y: "-130%" }} animate={{ y: 0 }} exit={{ y: "-130%", opacity: 0 }} transition={{ duration: 0.45, ease }}>
            <Icon id={s.caption.icon} />
            <div><div className="pa-tag">{t("announcement")}</div><p className="pa-text">{s.caption.text}</p>
              {s.lang !== "en" ? <p className="pa-en" lang="en">{s.caption.text_en}</p> : null}</div>
            <div className="pa-acts"><Listen lines={s.caption.text} /><button className="primary" onClick={() => { closeCaption(); bump(); }}>{t("ok")}</button></div>
          </motion.div>) : null}
      </AnimatePresence>

      {!s.sheet && !s.conv.open ? (
        <OnboardingFab seat={s.seat} lang={s.lang} onReplay={() => { s.onboarding = true; bump(); }}
          onAskHelp={() => { attention(); closeSheet(); }} onChangeLanguage={chooseLanguage} onAccessibility={showSettings} />
      ) : null}
    </div>
  );
}

// One scanner for the whole cabin (no screen on every seat to print a per-seat QR onto): the
// passenger taps their own seat on a plane-shaped map before anything connects to the hub, the
// same layout the crew tablet uses so it reads the same way on both sides. They can also just
// say it ("three four kay") -- the same offline phonetic matcher used for every other request,
// run on the seat number instead -- which only pre-picks the seat below; they still tap Continue.
function SeatGate({ cfg, onConfirm }) {
  const [picked, setPicked] = useState(null);
  const [mic, setMic] = useState("idle");   // idle | recording | thinking
  const [heard, setHeard] = useState(null); // {text, seat} | {text, seat: null} | {error: true} | null
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(null); // {seat, name} | {seat: null} | {error: true} | null
  const micRef = useRef("idle");
  const recorder = useRef(null);
  const known = useRef(new Set());
  known.current = new Set((cfg?.seats) || []);

  async function onBarcodeScanned(text) {
    setScanning(false);
    try {
      const res = await fetch("/api/seat/by-boarding-pass", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      const r = await res.json();
      setScanned(r);
      if (r.seat && known.current.has(r.seat)) setPicked(r.seat);
    } catch { setScanned({ error: true }); }
  }

  async function speakSeat() {
    if (micRef.current === "recording") {
      micRef.current = "thinking"; setMic("thinking");
      const pcm = await recorder.current.stop();
      recorder.current = null;
      try {
        const res = await fetch("/api/seat/by-voice", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio_b64: await toBase64(pcm) }),
        });
        const r = await res.json();
        setHeard({ text: r.heard, seat: r.seat });
        if (r.seat && known.current.has(r.seat)) setPicked(r.seat);
      } catch { setHeard({ error: true }); }
      micRef.current = "idle"; setMic("idle");
      return;
    }
    if (!Recorder.supported()) { setHeard({ error: true }); return; }
    setHeard(null);
    recorder.current = new Recorder();
    try {
      await recorder.current.start(6, () => micRef.current === "recording" && speakSeat());
      micRef.current = "recording"; setMic("recording");
    } catch { micRef.current = "idle"; setMic("idle"); }
  }

  if (!cfg) return (<><Ambient /><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><span className="mono faint">Auralink · connecting to the cabin…</span></div></>);
  const rows = [...new Set(cfg.seats.map((x) => x.slice(0, -1)))];
  const known_ = known.current;
  return (
    <>
      <Ambient />
      <main className="app" style={{ maxWidth: 420, minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, paddingBottom: 28 }}>
        <div style={{ textAlign: "center" }}>
          <h1 style={{ font: "800 24px/1.25 var(--display)", margin: "0 0 4px" }}>Which seat are you in?</h1>
          <p className="muted" style={{ margin: 0 }}>Tap your seat, or say it.</p>
        </div>
        {Recorder.supported() ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <button type="button" className={`ask-round mic-on ${mic === "recording" ? "recording" : ""}`}
              disabled={mic === "thinking"}
              aria-label={mic === "recording" ? "Stop and check" : "Say your seat number"}
              title={mic === "recording" ? "Stop and check" : "Say your seat number"} onClick={speakSeat}>
              <Icon id="mic" />
            </button>
            <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
              {mic === "recording" ? "Listening… say your seat, like “three four kay”"
                : mic === "thinking" ? "Checking…"
                : heard?.error ? "Couldn't use the microphone — tap your seat instead."
                : heard && !heard.seat ? `Didn't catch a seat in “${heard.text}” — try again or tap below.`
                : heard?.seat ? `Heard “${heard.text}” → seat ${heard.seat}. Tap Continue, or pick a different seat below.`
                : "Tap to say your seat number"}
            </p>
          </div>
        ) : null}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
          <button type="button" className="ghost" style={{ fontSize: 14 }} onClick={() => { setScanned(null); setScanning(true); }}>
            <Icon id="qr" /> Scan boarding pass
          </button>
          {scanned ? (
            <p className="muted" style={{ margin: 0, fontSize: 13, textAlign: "center" }}>
              {scanned.error ? "Couldn't use the camera — tap your seat instead."
                : scanned.seat ? `${scanned.name ? scanned.name + " · " : ""}Seat ${scanned.seat}. Tap Continue, or pick a different seat below.`
                : "That didn't look like a boarding pass — try again or tap your seat below."}
            </p>
          ) : null}
        </div>
        {scanning ? <BoardingPassScanner onResult={onBarcodeScanned} onClose={() => setScanning(false)} /> : null}
        <div className="seatgate-map">
          {rows.map((row) => (
            <div className="seatgate-row" key={row}>
              <span className="seatgate-row-label">{row}</span>
              <div className="seatgate-seats">
                {["A", "B", "C", null, "D", "E", "G", null, "H", "J", "K"].map((letter, i) => {
                  if (!letter) return <span className="seatgate-aisle" key={`gap-${i}`} />;
                  const id = row + letter;
                  if (!known_.has(id)) return <span className="seatgate-missing" key={id} />;
                  return (
                    <button key={id} type="button" className={`seat seatgate-seat ${picked === id ? "picked pop" : ""}`}
                      aria-pressed={picked === id} aria-label={`Seat ${id}`} onClick={() => setPicked(id)}>{letter}</button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <button className="primary" disabled={!picked}
          onClick={() => picked && onConfirm(picked, scanned?.seat === picked ? scanned.name : undefined)}
          style={{ minHeight: 52, fontSize: 16 }}>
          {picked ? `Continue · ${scanned?.seat === picked && scanned.name ? `${scanned.name}, seat ` : "Seat "}${picked}` : "Pick your seat above"}
        </button>
      </main>
    </>
  );
}

// Live camera read of a boarding pass barcode (IATA BCBP, hub/bcbp.py) -- no airline integration
// needed, since every boarding pass already carries one. Decodes entirely in the browser (jsQR
// against video frames drawn to a hidden canvas); only the decoded text, never the image, goes
// to the hub, which is also the one place that knows which seats exist on this aircraft.
function BoardingPassScanner({ onResult, onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const doneRef = useRef(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    function tick() {
      const video = videoRef.current, canvas = canvasRef.current;
      if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(img.data, img.width, img.height);
      if (code?.data && !doneRef.current) { doneRef.current = true; onResult(code.data); return; }
      rafRef.current = requestAnimationFrame(tick);
    }
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        tick();
      } catch { if (!cancelled) setError(true); }
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []); // eslint-disable-line

  return (
    <motion.div className="bp-scanner" role="dialog" aria-label="Scan boarding pass"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {error ? (
        <p className="muted" style={{ textAlign: "center", padding: 24 }}>Couldn't use the camera. Close this and tap your seat instead.</p>
      ) : (<>
        <video ref={videoRef} playsInline muted className="bp-video" />
        <div className="bp-frame" />
        <p className="muted bp-hint">Point the camera at your boarding pass barcode</p>
      </>)}
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <button className="ghost bp-close" onClick={onClose}><Icon id="close" /> Cancel</button>
    </motion.div>
  );
}

function IntentGrid({ intents, lang, onPick, big = false }) {
  // A plain wrapping grid, not a carousel: 8 intents fit on screen at once without needing to
  // swipe through pages, on a phone or a tablet/laptop alike.
  return (
    <div className={`grid ${big ? "big" : ""}`}>
      {intents.map((i, k) => {
        const label = i.label[lang] || i.label.en;
        return (
          <motion.button key={i.id} className="tile" onClick={() => onPick(i.id)}
            title={label} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.03 * k, duration: 0.45, ease }} whileTap={{ scale: 0.95 }}>
            <Icon id={i.id} />{label}
          </motion.button>
        );
      })}
    </div>
  );
}
