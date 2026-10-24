"use client";
// Passenger seat screen. Same protocol and behaviour as the original apps/passenger.html.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useReducer, useRef } from "react";
import { Recorder, connect, loadConfig, params } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { Picto } from "@/lib/pictograms";
import { canSpeak, speak } from "@/lib/speech";
import { Ambient, Sheet, ease, useFlash } from "@/components/ui";

export default function Passenger() {
  const [, bump] = useReducer((x) => x + 1, 0);
  const st = useRef(null);
  const level = useRef(null);
  const [flashFrame, flash] = useFlash();
  if (!st.current) st.current = { ready: false, strings: {}, fallback: {}, lang: "en", senior: false, pictures: false, readAloud: false, voiceOK: false,
    micState: "idle", micNote: "", requests: new Map(), pending: [], waitingTriage: null, sheet: null, caption: null, online: false, titleOverride: null, seat: "34K" };
  const s = st.current;
  const socket = useRef(null);
  const recorder = useRef(null);
  const captionTimer = useRef(0);
  const flashRef = useRef(flash); flashRef.current = flash;

  const t = (k) => s.strings[k] ?? s.fallback[k] ?? k;
  const hello = () => socket.current?.send({ type: "hello", lang: s.lang, senior: s.senior, pictures: s.pictures, read: s.readAloud });
  const say = (lines) => { if (s.readAloud && s.voiceOK && !s.pictures) speak(lines, s.lang); };
  const Listen = ({ lines }) => (!s.voiceOK || s.pictures ? null :
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

  function showTriage(msg) {
    attention(); say(msg.triage.title);
    setSheet(<div key={`tri-${msg.card_id}`} style={{ display: "contents" }}>
      <div className="row"><h2 className="grow urgent-title">{msg.triage.title}</h2><Listen lines={msg.triage.title} /></div>
      <div className="grid triage">{msg.triage.symptoms.map((x) => (
        <button key={x.id} className="tile" onClick={() => socket.current.send({ type: "symptom", card_id: msg.card_id, symptom: x.id })}><Icon id={x.icon} />{x.label}</button>))}</div>
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
    if (["confirm", "grid", "status", "error"].includes(msg.type) && s.micState === "thinking") setMic("idle");
    if (msg.type === "thinking") setMic("thinking");
    else if (msg.type === "confirm") { s.pending = msg.cards; showNextConfirm(); }
    else if (msg.type === "grid") showGrid(msg.card_id);
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
    }
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
    let alive = true, markReady;
    const ready = new Promise((r) => (markReady = r));
    const p = params();
    s.seat = p.get("seat") || "34K";
    s.lang = p.get("lang") || "en";
    s.senior = p.get("senior") === "1";
    s.pictures = p.get("mode") === "pictures";
    s.readAloud = p.get("read") === "1";
    socket.current = connect(`/ws/passenger/${s.seat}`, (msg) => ready.then(() => alive && onMessage(msg)), (on) => {
      s.online = on; bump();
      if (on) ready.then(() => hello());
    });
    (async () => {
      s.cfg = await loadConfig();
      let checkedIn = false;
      if (!["lang", "senior", "mode", "read"].some((k) => p.has(k))) {
        try {
          const r = await (await fetch(`/api/seat/${s.seat}`)).json();
          if (r.checked_in) { checkedIn = true; Object.assign(s, { lang: r.lang, senior: r.senior, pictures: r.pictures, readAloud: r.read }); }
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
    return () => { alive = false; socket.current?.close(); };
  }, []); // eslint-disable-line

  if (!s.ready) return (<><Ambient /><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><span className="mono faint">Auralink · connecting to the cabin…</span></div></>);

  const reqs = [...s.requests.values()].reverse();
  const micLabel = t({ idle: "speak", recording: "stop", thinking: "thinking", off: "speak" }[s.micState]);
  return (
    <div className={`${s.senior ? "big" : ""} ${s.pictures ? "pictures" : ""}`}>
      <Ambient />
      {flashFrame}
      <header className="app-header">
        <span className={`dot ${s.online ? "on" : ""}`} title="Connection" />
        <h1><AnimatePresence mode="wait"><motion.span key={s.titleOverride || "t"} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>{s.titleOverride || t("title")}</motion.span></AnimatePresence></h1>
        <span className="pill dim">{t("seat")} {s.seat}</span>
        <select aria-label="Language" value={s.lang} onChange={(e) => setLanguage(e.target.value)}>
          {s.cfg.languages.map((l) => <option key={l.code} value={l.code}>{l.english && l.english !== l.name ? `${l.name} · ${l.english}` : l.name}</option>)}
        </select>
        <label className="row muted"><input type="checkbox" checked={s.senior} onChange={(e) => { s.senior = e.target.checked; bump(); hello(); }} /> {t("seniorLabel")}</label>
        <label className="row muted"><input type="checkbox" checked={s.pictures} onChange={(e) => { s.pictures = e.target.checked; bump(); hello(); }} /> {t("picturesLabel")}</label>
        {s.voiceOK && !s.pictures ? <label className="row muted"><input type="checkbox" checked={s.readAloud}
          onChange={(e) => { s.readAloud = e.target.checked; if (s.readAloud) speak(t("readLabel"), s.lang); bump(); hello(); }} /> {t("readLabel")}</label> : null}
      </header>

      <main className="app" style={{ maxWidth: 980 }}>
        {!s.pictures ? (
          <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            <h2>{t("typeHint")}</h2>
            <button type="button" className={`mic ${s.micState === "recording" ? "recording" : ""}`} onClick={toggleMic}
              disabled={s.micState === "thinking" || s.micState === "off"}>
              {s.micState === "recording" ? <motion.span className="icon" animate={{ scale: [1, 1.25, 1] }} transition={{ repeat: Infinity, duration: 1.1 }}><Icon id="mic" /></motion.span> : <Icon id="mic" />}
              <span>{micLabel}</span>
              {s.micState === "thinking" ? <motion.span style={{ display: "inline-flex", gap: 4 }}>{[0, 1, 2].map((k) => (
                <motion.i key={k} style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent)", display: "block" }}
                  animate={{ opacity: [0.2, 1, 0.2] }} transition={{ repeat: Infinity, duration: 1, delay: k * 0.18 }} />))}</motion.span> : null}
              <span className="level" ref={level} style={{ width: 0 }} />
            </button>
            {s.micNote ? <p className="muted" style={{ margin: 0 }}>{t(s.micNote)}</p> : null}
            <form className="row" onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.text; const text = input.value.trim();
              if (!text) return;
              socket.current.send({ type: "text", text }); input.value = "";
            }}>
              <input className="grow" name="text" autoComplete="off" placeholder="thoda wotter and kambal" />
              <button className="primary" type="submit">{t("send")}</button>
            </form>
          </motion.section>
        ) : null}

        <motion.section className="panel" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.08, ease }}>
          <h2>{s.pictures ? t("tapNeed") : t("orTap")}</h2>
          <IntentGrid intents={s.cfg.intents} lang={s.lang} big={s.pictures} onPick={(intent) => socket.current.send({ type: "icon", intent })} />
        </motion.section>

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
            {!reqs.length ? <p className="faint" style={{ margin: 0, fontSize: 14 }}>—</p> : null}
          </div>
        </motion.section>
      </main>

      <Sheet content={s.sheet} big={s.senior} />

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
  return (
    <div className="grid" style={big ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 14 } : undefined}>
      {intents.map((i, k) => (
        <motion.button key={i.id} className="tile" onClick={() => onPick(i.id)} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.03 * k, duration: 0.45, ease }} whileTap={{ scale: 0.95 }}
          style={big ? { padding: "28px 8px", fontSize: 20, fontWeight: 600 } : undefined}>
          <Icon id={i.id} />{i.label[lang] || i.label.en}
        </motion.button>))}
    </div>
  );
}
