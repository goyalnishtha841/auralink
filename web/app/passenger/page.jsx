"use client";
// Passenger seat screen. Same protocol and behaviour as the original apps/passenger.html.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useReducer, useRef } from "react";
import { Recorder, VadRecorder, connect, loadConfig, params } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { ACCESSIBILITY_META } from "@/lib/accessibility";
import { Picto } from "@/lib/pictograms";
import { canSpeak, isSpeaking, onSpeakingChange, speakNatural as speak, unlockAudio } from "@/lib/speech";
import { Ambient, Carousel, Sheet, ease, useFlash } from "@/components/ui";
import { ConvThread, MuteButton } from "@/components/liveconversation";

export default function Passenger() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const st = useRef(null);
  const level = useRef(null);
  const [flashFrame, flash] = useFlash();
  if (!st.current) st.current = { ready: false, strings: {}, fallback: {}, lang: "en", senior: false, pictures: false, readAloud: false, accessibility: null, voiceOK: false,
    micState: "idle", micNote: "", requests: new Map(), pending: [], waitingTriage: null, sheet: null, caption: null, online: false, titleOverride: null, seat: "34K",
    conv: { open: false, speaking: false, replyPlaying: false, muted: false, partial: "", messages: [], spoken: new Set() } };
  const s = st.current;
  const socket = useRef(null);
  const recorder = useRef(null);
  const vad = useRef(null);
  const convUnsub = useRef(null);
  const captionTimer = useRef(0);
  const flashRef = useRef(flash); flashRef.current = flash;
  const shake = useRef({ x: null, y: null, z: null, hits: 0, lastHitAt: 0, cooldownUntil: 0, listening: false });

  const t = (k) => s.strings[k] ?? s.fallback[k] ?? k;
  const hello = () => socket.current?.send({ type: "hello", lang: s.lang, senior: s.senior, pictures: s.pictures, read: s.readAloud, accessibility: s.accessibility });
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

  useEffect(() => {
    addEventListener("pointerdown", unlockAudio, { once: true });
    let alive = true, markReady;
    const ready = new Promise((r) => (markReady = r));
    const p = params();
    s.seat = p.get("seat") || "34K";
    s.lang = p.get("lang") || "en";
    s.senior = p.get("senior") === "1";
    s.pictures = p.get("mode") === "pictures";
    s.readAloud = p.get("read") === "1";
    s.accessibility = ACCESSIBILITY_META[p.get("accessibility")] ? p.get("accessibility") : null;
    socket.current = connect(`/ws/passenger/${s.seat}`, (msg) => ready.then(() => alive && onMessage(msg)), (on) => {
      s.online = on; bump();
      if (on) ready.then(() => hello());
    });
    (async () => {
      s.cfg = await loadConfig();
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
      if (askLanguage) chooseLanguage();
    })();
    return () => { alive = false; socket.current?.close(); vad.current?.stop(); convUnsub.current?.(); removeEventListener("pointerdown", unlockAudio); };
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

  if (!s.ready) return (<><Ambient /><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><span className="mono faint">Auralink · connecting to the cabin…</span></div></>);

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
        <button className="hdr-icon-btn" aria-label={t("settingsTitle")} title={t("settingsTitle")} onClick={showSettings}><Icon id="settings" /></button>
      </header>

      <main className="app pax-shell">
        <div className="pax-col pax-col-main">
        {!pictureMode() ? (
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
    </div>
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
