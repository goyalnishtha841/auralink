"use client";
// Crew tablet (Japanese first). Same protocol and behaviour as the original apps/crew.html.
import "./crew.css";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState } from "react";
import { Recorder, connect, crewFetch, loadConfig, postJson, toBase64 } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { Picto } from "@/lib/pictograms";
import { ACCESSIBILITY_META } from "@/lib/accessibility";
import { canSpeak, speakNatural as speak, unlockAudio } from "@/lib/speech";
import { Ambient, AppHeader, Sheet, ease } from "@/components/ui";
import { FreeTalkPanel } from "@/components/freetalk";
import { ConvThread, MuteButton } from "@/components/liveconversation";

const STATUS = {
  urgent_unconfirmed: ["至急・未確認", "Urgent, unconfirmed", "bad"],
  confirmed: ["確認済み", "Confirmed", "ok"],
  needs_human: ["要対応", "Needs human help", "bad"],
  acknowledged: ["対応中", "Acknowledged", "dim"],
};
const HEAT = {
  understood: ["理解", "Understood", "var(--ok)"],
  understood_again: ["再説明で理解", "Understood after re-explaining", "var(--ok)"],
  reexplaining: ["再説明中", "Re-explaining", "var(--violet)"],
  stuck: ["要対応", "Go to seat", "var(--bad)"],
  pending: ["未回答", "No answer yet", "var(--warn)"],
  offline: ["端末なし", "No device", "var(--idle)"],
};
const VERDICT = { sure: ["一致 Matched", "ok"], check: ["要確認 Please check", "call"], none: ["該当なし Not in library", "bad"] };
const RIGHT_TABS = [
  { id: "map", ja: "客室図", en: "Cabin map" },
  { id: "safety", ja: "安全案内", en: "Safety" },
  { id: "pa", ja: "アナウンス", en: "Announcements" },
  { id: "chat", ja: "会話", en: "Live chat" },
  { id: "exit", ja: "非常口", en: "Exit check" },
  { id: "arrival", ja: "遺失物・意見", en: "Lost & found" },
];
const LOST_STATUS = { reported: ["報告済み", "Reported", "amber"], found: ["発見", "Found", "ok"], returned: ["返却済み", "Returned", "dim"] };
const FEEDBACK_CATEGORY = { inconvenience: ["不便", "Inconvenience", "bad"], improvement: ["提案", "Suggestion", "amber"], compliment: ["お褒めの言葉", "Compliment", "ok"] };
const HUB_DOWN_AFTER_MS = 6000;   // hub.js retries every 1s; a handful of failed tries, not one blip

export default function Crew() {
  const [cfg, setCfg] = useState(null);
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(false);
  const [hubDown, setHubDown] = useState(false);   // sustained (not a 1s retry blip): show the fail-safe banner
  const [soundOn, setSoundOn] = useState(true);
  const [readAloud, setReadAloud] = useState(false);
  const [convMuted, setConvMuted] = useState(false);
  const [jaVoice, setJaVoice] = useState(false);
  const [pb, setPb] = useState(null);           // {seat} or null
  const [pickedSeat, setPickedSeat] = useState(null);
  const [rightTab, setRightTab] = useState("map");
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [conv, setConv] = useState({});         // seat -> { open, messages: [] }
  const [pa, setPa] = useState(null);           // match result | {busy} | {error} | {sent}
  const [paPick, setPaPick] = useState(null);
  const [paN, setPaN] = useState("");
  const [paRecOn, setPaRecOn] = useState(false);
  const [paLive, setPaLive] = useState(null);   // caption taking shape while still recording, or null
  const [myName, setMyName] = useState("");
  const [myZone, setMyZone] = useState("all");
  const myInfo = useRef({ name: "", zone: "all" });
  const socket = useRef(null), audio = useRef(null), paRec = useRef(null), paLiveBusy = useRef(false), hubDownTimer = useRef(0);
  const seenUrgent = useRef(new Set()), announced = useRef(null), announcedSymptom = useRef(new Set());
  const opts = useRef({ soundOn: true, readAloud: false, convMuted: false }); opts.current = { soundOn, readAloud, convMuted };

  function beep() {
    if (!opts.current.soundOn || !audio.current) return;
    const a = audio.current;
    [0, 0.28, 0.56].forEach((t0) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = 880; o.connect(g); g.connect(a.destination);
      const t = a.currentTime + t0;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.start(t); o.stop(t + 0.24);
    });
  }

  function sideEffects(msg) {
    const cards = msg.cards;
    const fresh = cards.filter((c) => c.urgent && c.status !== "acknowledged" && !seenUrgent.current.has(c.id));
    fresh.forEach((c) => seenUrgent.current.add(c.id));
    if (fresh.length) beep();
    if (announced.current === null) announced.current = new Set(cards.map((c) => c.id));
    const syms = cards.filter((c) => c.symptom_ja && !announcedSymptom.current.has(c.id));
    syms.forEach((c) => announcedSymptom.current.add(c.id));
    const ra = opts.current.readAloud;
    if (ra && syms.length) speak(syms.map((c) => `${c.seat}、症状は${c.symptom_ja}です`), "ja");
    const newOnes = cards.filter((c) => !announced.current.has(c.id) && c.status !== "acknowledged");
    cards.forEach((c) => announced.current.add(c.id));
    if (!ra || !newOnes.length) return;
    newOnes.sort((a, b) => Number(b.urgent) - Number(a.urgent));
    speak(newOnes.map((c) => `${c.urgent ? "至急。" : ""}${c.seat}、${c.crew_ja || (c.guesses[0] ? c.guesses[0].label_ja : "ご用件が不明です")}`), "ja");
  }

  function sendHello(name, zone) {
    myInfo.current = { name, zone };
    socket.current?.send({ type: "hello", name, zone });
  }

  useEffect(() => {
    const unlock = () => { audio.current ??= new AudioContext(); unlockAudio(); };
    addEventListener("pointerdown", unlock, { once: true });
    canSpeak("ja").then(setJaVoice);
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("auralink-crew-id") || "{}"); } catch { /* blocked */ }
    // crew no longer type a name — a short per-device tag is generated once and reused, so
    // "claim"/"release" on a request still knows which tablet is on it without asking anyone to fill in a field.
    let tag = saved.name;
    if (!tag) {
      const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      tag = `Crew-${letters[Math.floor(Math.random() * letters.length)]}${Math.floor(Math.random() * 10)}`;
    }
    setMyName(tag);
    if (saved.zone) setMyZone(saved.zone);
    myInfo.current = { name: tag, zone: saved.zone || "all" };
    loadConfig().then((c) => {
      setCfg(c);
      socket.current = connect("/ws/crew", (msg) => {
        if (msg.type === "state") {
          sideEffects(msg); setState(msg);
          setConv((c) => {
            const open = new Set(msg.conv_seats || []);
            const next = { ...c };
            for (const seat of open) next[seat] = { messages: [], ...next[seat], open: true };
            for (const seat of Object.keys(next)) if (!open.has(seat)) next[seat] = { ...next[seat], open: false };
            return next;
          });
        }
        else if (msg.type === "conv_state") {
          setConv((c) => ({ ...c, [msg.seat]: { open: msg.open, messages: c[msg.seat]?.messages || [] } }));
        } else if (msg.type === "conv_message") {
          setConv((c) => {
            const prev = c[msg.seat] || { open: true, messages: [] };
            const i = prev.messages.findIndex((m) => m.id === msg.id);
            const messages = i >= 0
              ? prev.messages.map((m, idx) => (idx === i ? msg : m))
              : [...prev.messages, msg];
            return { ...c, [msg.seat]: { ...prev, messages } };
          });
          // a live conversation is spoken, not just displayed: crew hears the passenger's
          // message in Japanese as soon as it finishes streaming, same as the passenger hears
          // crew's reply in their own language (app/passenger/page.jsx's onMessage)
          if (msg.from === "passenger" && msg.done && msg.translated && !opts.current.convMuted) speak(msg.translated, "ja");
        }
      }, (on) => {
        setOnline(on);
        if (on) {
          clearTimeout(hubDownTimer.current); hubDownTimer.current = 0; setHubDown(false);
          if (myInfo.current.name) sendHello(myInfo.current.name, myInfo.current.zone);
        } else if (!hubDownTimer.current) {
          // same fails-safe idea as the passenger phone (app/passenger/page.jsx): only arm on the
          // first failed retry, since hub.js keeps retrying every 1s and each one calls this again
          hubDownTimer.current = setTimeout(() => { hubDownTimer.current = 0; setHubDown(true); }, HUB_DOWN_AFTER_MS);
        }
      });
    });
    return () => { socket.current?.close(); clearTimeout(hubDownTimer.current); removeEventListener("pointerdown", unlock); };
  }, []); // eslint-disable-line

  const send = (m) => socket.current?.send(m);

  function saveIdentity(zone) {
    setMyZone(zone);
    try { localStorage.setItem("auralink-crew-id", JSON.stringify({ name: myName, zone })); } catch { /* blocked */ }
    sendHello(myName, zone);
  }

  async function refreshBriefing() {
    setBriefingLoading(true);
    try {
      const res = await crewFetch("/api/crew/briefing");
      setBriefing(await res.json());
    } catch {
      setBriefing({ summary: null });
    }
    setBriefingLoading(false);
  }

  async function paMatch(body) {
    setPa({ busy: true });
    try {
      const res = await crewFetch("/api/pa/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const r = await res.json();
      if (!res.ok) throw new Error(r.detail || res.status);
      const pick = r.verdict === "none" ? null : r.matches[0];
      setPa(r); setPaPick(pick); setPaN(pick?.n || "");
    } catch (err) { setPa({ error: err.message }); }
  }
  // While the crew keeps recording, show the caption taking shape -- a quick re-match on a growing
  // snapshot of the same audio, with the fast model (never what gets sent; `paMic`'s final match
  // after Stop always re-runs on the accurate model, same as before this existed). Never overlaps
  // itself: a snapshot that arrives while the last one is still matching is simply dropped.
  async function paMatchLive(buf) {
    if (paLiveBusy.current) return;
    paLiveBusy.current = true;
    try {
      const res = await crewFetch("/api/pa/match", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio_b64: await toBase64(buf), fast: true }) });
      if (res.ok) setPaLive(await res.json());
    } catch { /* a dropped live preview is not worth surfacing; the final match still runs on Stop */ }
    paLiveBusy.current = false;
  }
  async function paSend() {
    const n = paN.trim().toUpperCase() || null;
    const res = await crewFetch("/api/pa/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: paPick.id, n }) });
    const out = await res.json();
    setPa(res.ok ? { sent: out.seats } : { error: JSON.stringify(out.detail) });
  }
  async function paMic() {
    if (!paRec.current) {
      if (!Recorder.supported()) { setPa({ error: "マイク不可 Microphone needs https or localhost" }); return; }
      paRec.current = new Recorder();
      setPaLive(null);
      try { await paRec.current.start(28, () => paRec.current && paMic(), null, (buf) => paMatchLive(buf)); } catch { paRec.current = null; return; }
      setPaRecOn(true);
    } else {
      const pcm = await paRec.current.stop(); paRec.current = null; setPaRecOn(false); setPaLive(null);
      paMatch({ audio_b64: await toBase64(pcm) });
    }
  }

  if (!cfg) return <><Ambient /><div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}><span className="mono faint">Auralink · 乗務員パネル…</span></div></>;
  const exitSeats = new Set(cfg.exit_seats);
  const LABEL = Object.fromEntries(cfg.intents.map((i) => [i.id, i.label]));
  const LANG_NAME = Object.fromEntries(cfg.languages.map((l) => [l.code, l.name]));
  const PA = Object.fromEntries((cfg.announcements || []).map((a) => [a.id, a]));
  const cards = state?.cards || [];
  const openUrgent = cards.filter((c) => c.urgent && c.status !== "acknowledged");
  const visibleCards = myZone !== "all" ? cards.filter((c) => c.urgent || c.zone === myZone) : cards;

  return (
    <>
      <Ambient />
      <AppHeader online={online} title="客室乗務員パネル" sub="Crew panel">
        <label className="hdr-field" title="Tells the matcher what part of the flight this is, so it can favour phase-relevant words — e.g. 'meal' makes food items more likely than during cruise.">
          <span className="hdr-field-label">飛行フェーズ Phase</span>
          <select value={state?.phase || "cruise"} onChange={(e) => send({ type: "phase", phase: e.target.value })}>
            {cfg.phases.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>

        <div className="hdr-divider" aria-hidden="true" />

        <button type="button" className={`hdr-icon-btn ${soundOn ? "on" : ""}`} aria-pressed={soundOn} onClick={() => setSoundOn((x) => !x)}
          title="Sound: plays a chime on this tablet the moment a new urgent (possible medical) request comes in. Click to mute.">
          <Icon id="bell" /></button>
        {jaVoice ? (
          <button type="button" className={`hdr-icon-btn ${readAloud ? "on" : ""}`} aria-pressed={readAloud} onClick={() => setReadAloud((x) => !x)}
            title="Read aloud: when a passenger reports a medical symptom, speaks the seat and symptom aloud in Japanese — useful if you're not looking at the screen. Off by default.">
            <Icon id="speaker" /></button>
        ) : null}
        <button className="ghost" onClick={() => setPb({ seat: null })}><Icon id="chat" /> 会話帳 Phrasebook</button>

        <div className="hdr-divider" aria-hidden="true" />

        <label className="hdr-field" title="Filters the request list to your cabin zone (urgent requests always still show). Pick 全体 All to see every request again.">
          <span className="hdr-field-label">担当 Zone</span>
          <select value={myZone} onChange={(e) => saveIdentity(e.target.value)}>
            <option value="all">全体 All</option>
            {(cfg.crew_zones || []).map((z) => <option key={z.id} value={z.id}>区画 {z.id} · rows {Math.min(...z.seats.map((s) => +s.slice(0, -1)))}-{Math.max(...z.seats.map((s) => +s.slice(0, -1)))}</option>)}
          </select></label>
      </AppHeader>
      {(state?.crew_roster?.length) ? (
        <p className="muted mono crew-shell" style={{ margin: "0 auto", padding: "0 20px" }}>
          乗務員 Crew online: {state.crew_roster.map((m) => `${m.name}${m.zone !== "all" ? ` (${m.zone})` : ""}`).join(" · ")}
        </p>
      ) : null}

      <main className="app crew-shell">
        <AnimatePresence>
          {openUrgent.map((c) => (
            <motion.div key={c.id} className="alarm" role="alert" initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ ease }}>
              <b>{c.seat}</b>
              <span>{(c.crew_ja || "体調不良の可能性").startsWith("【至急】") ? "" : "【至急】"}{c.crew_ja || "体調不良の可能性"} · Urgent: {c.label_en || "possible medical"}</span>
              {c.symptom_ja ? <strong> — 症状: {c.symptom_ja} · {c.symptom_en}</strong> : null}
            </motion.div>))}
        </AnimatePresence>

        <AnimatePresence>
          {hubDown ? (
            <motion.div className="alarm hub-down" role="alert" initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ ease }}>
              <Icon id="wifi_off" /><b>ハブ接続なし Hub connection lost</b>
              <span>This tablet can't reach the cabin hub. New requests may not be showing. Print your offline backup (乗客のニーズ Passenger needs panel) if you haven't, and walk the cabin.</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {state?.turbulence ? (
            <motion.div className="alarm turbulence" role="alert" initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ ease }}>
              <b>揺れ? Turbulence?</b>
              <span>{state.turbulence.seats.length} phones shook at once, around {rowRange(state.turbulence.seats)} · 複数の端末が一斉に振られました</span>
              <button className="primary" onClick={() => send({ type: "broadcast", template_id: "turbulence" })}>シートベルト案内 Send seatbelt briefing</button>
              <button onClick={() => send({ type: "dismiss_turbulence" })}>消す Dismiss</button>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="crew-layout">
          <div className="col">
            <section className="panel">
              <h2>リクエスト Requests{myZone !== "all" ? ` · 区画 ${myZone}` : ""}</h2>
              <div className="list">
                <AnimatePresence initial={false}>
                  {visibleCards.map((c) => <CardView key={c.id} c={c} cfg={cfg} send={send} myName={myName} onTalk={() => setPb({ seat: c.seat })} />)}
                </AnimatePresence>
                {!visibleCards.length ? <p className="muted" style={{ margin: 0 }}>リクエストなし · No open requests</p> : null}
              </div>
            </section>
            <section className="panel"><h2>ケアラウンド Care round</h2><Round state={state} LABEL={LABEL} send={send} /></section>
            <section className="panel">
              <h2>乗客のニーズ Passenger needs</h2>
              <p className="muted" style={{ margin: 0 }}>From check-in and the passengers' own settings. Plan who may need help before take-off.</p>
              <div className="row">
                <button className="ghost" title="Print a paper backup of this list -- seat, language, accessibility -- for if the tablet or hub goes down mid-flight and you have to walk the cabin without it." onClick={() => window.print()}>
                  <Icon id="print" /> バックアップ印刷 Print offline backup</button>
              </div>
              <Needs needs={state?.seat_needs || []} LANG_NAME={LANG_NAME} onTalk={(n) => setPb({ seat: n.id })} />
            </section>
          </div>

          <div className="col">
            <div className="tabbar" role="tablist">
              {RIGHT_TABS.filter((t) => t.id !== "chat" || cfg.free_talk).map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={rightTab === t.id}
                  className={`tab ${rightTab === t.id ? "on" : ""}`} onClick={() => setRightTab(t.id)}>
                  {t.ja}<span className="muted"> {t.en}</span>
                </button>))}
            </div>

            {rightTab === "map" ? (
              <section className="panel cabinmap-panel">
                <div className="row"><h2 className="grow" style={{ margin: 0 }}>客室図 Cabin map</h2>
                  <button className="ghost" onClick={refreshBriefing} disabled={briefingLoading}><Icon id="chat" />{briefingLoading ? "…" : "AI briefing"}</button></div>
                {briefing ? (
                  <p className="muted" style={{ margin: 0, fontSize: 14 }}>
                    {briefing.summary || "Nothing needs a summary right now."}
                  </p>
                ) : <p className="muted" style={{ margin: 0, fontSize: 13 }}>Tap "AI briefing" for a one-glance read of what needs attention, from the facts already on this screen. Tap any seat for its detail.</p>}
                <MapLegend />
                <CabinMap state={state} cfg={cfg} exitSeats={exitSeats} selected={pickedSeat} onSelect={(s) => setPickedSeat(s === pickedSeat ? null : s)} />
              </section>
            ) : null}
            <Sheet content={pickedSeat ? (
              <SeatDetail seat={pickedSeat} state={state} cfg={cfg} send={send} myName={myName} LANG_NAME={LANG_NAME}
                onTalk={() => setPb({ seat: pickedSeat })} onChat={() => { setRightTab("chat"); setPickedSeat(null); }} />
            ) : null} onClose={() => setPickedSeat(null)} />

            {rightTab === "safety" ? (
            <section className="panel">
              <h2>安全案内 Safety briefing</h2>
              <div className="row">{cfg.safety.map((x) => <button key={x.id} onClick={() => send({ type: "broadcast", template_id: x.id })}>{x.title.ja} · {x.title.en}</button>)}</div>
              <Safety state={state} cfg={cfg} exitSeats={exitSeats} send={send} />
            </section>
            ) : null}

            {rightTab === "pa" ? (
            <section className="panel">
              <h2>機内アナウンス字幕 Live PA captions</h2>
              <p className="muted" style={{ margin: 0 }}>Make the announcement as usual, with the tablet listening. Every seat sees it in its own language. Only announcements in the library are captioned; nothing is machine-translated.</p>
              <div className="row">
                <button className={`primary pa-mic ${paRecOn ? "recording" : ""}`} onClick={paMic}><Icon id="mic" /> {paRecOn ? "停止 Stop" : "録音 Record announcement"}</button>
                <form className="row grow" style={{ flex: "1 1 280px" }} onSubmit={(e) => { e.preventDefault(); const v = e.currentTarget.elements.pa.value.trim(); if (v) paMatch({ text: v }); }}>
                  <input className="grow" name="pa" autoComplete="off" placeholder="…or type it: We have started our descent, 20 minutes" aria-label="Typed announcement" />
                  <button type="submit">照合 Match</button></form>
              </div>
              <AnimatePresence>
                {paRecOn && paLive?.heard ? (
                  <motion.div className="pa-live" aria-live="polite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <Icon id="mic" /><span className="muted">認識中 Hearing…</span> “{paLive.heard}”
                    {paLive.verdict !== "none" && paLive.matches?.[0] ? (
                      <span className="pill dim">→ {paLive.matches[0].title_ja} · {paLive.matches[0].title_en}</span>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
              <div className="pa-result" aria-live="polite">
                {pa?.busy ? <span className="muted">照合中… Matching…</span> : null}
                {pa?.error ? <span className="pill bad">エラー Error: {pa.error}</span> : null}
                {pa?.sent != null ? <span className="pill ok">送信済み Sent to {pa.sent} seats</span> : null}
                {pa?.verdict ? (<>
                  <div className="row"><span className={`pill ${VERDICT[pa.verdict][1]}`}>{VERDICT[pa.verdict][0]}</span>
                    {pa.latency_ms ? <span className="mono muted">{Object.entries(pa.latency_ms).map(([k, v]) => `${k} ${v} ms`).join(" · ")}</span> : null}</div>
                  {pa.heard ? <p className="muted" style={{ margin: 0 }}>聞き取り Heard: “{pa.heard}”</p> : null}
                  {pa.verdict === "none" ? <p style={{ margin: 0 }}>この案内は字幕にできません。· Not in the library, so no caption was made. Pick one below if it fits, or tell passengers in person.</p>
                    : pa.matches.map((m) => (
                      <button key={m.id} className="pa-opt" aria-pressed={m === paPick} onClick={() => { setPaPick(m); setPaN(m.n || ""); }}>
                        <Icon id={m.icon} /><span><b>{m.title_ja} · {m.title_en}</b><small>{m.text_en}</small></span>
                        <span className="mono muted" title={`key phrases heard: ${m.keys.join(", ")}`}>{m.score.toFixed(1)}</span></button>))}
                  <div className="row">
                    {PA[paPick?.id]?.slot ? <label className="row muted">{PA[paPick.id].slot === "gate" ? "ゲート Gate" : "分 Minutes"}
                      <input style={{ width: 84 }} inputMode="numeric" maxLength={4} value={paN} onChange={(e) => setPaN(e.target.value)} /></label> : null}
                    <button className="primary" disabled={!paPick} onClick={paSend}>全席に送信 Send to all seats</button>
                  </div>
                </>) : null}
              </div>
              <details className="pa-lib"><summary>一覧から選ぶ · Pick from the library</summary>
                <div className="row">{Object.values(PA).map((a) => (
                  <button key={a.id} onClick={() => { const m = { id: a.id, icon: a.icon, title_ja: a.title.ja, title_en: a.title.en, text_en: a.text_en, score: 0, keys: [], n: null };
                    setPa({ verdict: "sure", heard: "", matches: [m] }); setPaPick(m); setPaN(""); }}><Icon id={a.icon} /> {a.title.ja} · {a.title.en}</button>))}</div></details>
              {state?.pa_log?.length ? <div className="pa-log"><strong>送信履歴 Sent</strong>{state.pa_log.map((a, k) => (
                <span key={k}><Icon id={a.icon} /> {new Date(a.at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {a.title_ja} · {a.text_en}</span>))}</div> : null}
            </section>
            ) : null}

            {rightTab === "chat" && cfg.free_talk ? (<>
              <CrewLiveConversation conv={conv} send={send} muted={convMuted} onToggleMute={() => setConvMuted((m) => !m)} />
              <CrewFreeTalk cfg={cfg} LANG_NAME={LANG_NAME} />
            </>) : null}

            {rightTab === "exit" ? (
            <section className="panel">
              <h2>非常口座席の確認 Exit-row check</h2>
              <p className="muted" style={{ margin: 0 }}>Picture check at boarding. Supports your own briefing and confirmation; it does not replace it.</p>
              <div className="row"><button onClick={() => send({ type: "exit_check" })}>確認を開始 Start check (row {[...new Set(cfg.exit_seats.map((x) => x.slice(0, -1)))].join(", ")})</button></div>
              <div className="exit-list">{(state?.exit_checks || []).map((c) => {
                const RES = { pass: ["OK", "ok"], talk: ["要説明 Talk", "bad"], pending: ["未回答 Waiting", "dim"] };
                const [label, tone] = c.connected || c.result !== "pending" ? RES[c.result] : ["端末なし No device", "dim"];
                const why = c.reseat ? "別席希望 Wants another seat" : Object.entries(c.answers).filter(([, v]) => !v).map(([k]) => k.replace("_", " ")).join(", ");
                return <motion.div layout key={c.seat} className="exit-item" title={why}><b>{c.seat}</b><span className={`pill ${tone}`}>{label}</span></motion.div>;
              })}</div>
            </section>
            ) : null}

            {rightTab === "arrival" ? (
            <section className="panel">
              <h2>遺失物 Lost &amp; found</h2>
              <div className="exit-list">
                {(state?.lost_items || []).map((it) => (
                  <motion.div layout key={it.id} className="item">
                    <b>{it.seat}</b><span className="grow muted">{it.description}</span>
                    <span className={`pill ${LOST_STATUS[it.status][2]}`}>{LOST_STATUS[it.status][0]} · {LOST_STATUS[it.status][1]}</span>
                    {it.status !== "found" ? <button onClick={() => postJson(`/api/lost-item/${it.id}/status`, { status: "found" }, { crew: true }).catch(() => {})}>発見 Found</button> : null}
                    {it.status !== "returned" ? <button onClick={() => postJson(`/api/lost-item/${it.id}/status`, { status: "returned" }, { crew: true }).catch(() => {})}>返却 Returned</button> : null}
                  </motion.div>
                ))}
                {!state?.lost_items?.length ? <p className="muted" style={{ margin: 0 }}>報告なし · Nothing reported</p> : null}
              </div>
              <h2>ご意見 Feedback</h2>
              <div className="exit-list">
                {(state?.feedback || []).map((f) => (
                  <motion.div layout key={f.id} className="item">
                    <b>{f.seat}</b>
                    <span className={`pill ${FEEDBACK_CATEGORY[f.category][2]}`}>{FEEDBACK_CATEGORY[f.category][0]} · {FEEDBACK_CATEGORY[f.category][1]}</span>
                    {f.rating ? <span className="pill dim">{"★".repeat(f.rating)}{"☆".repeat(5 - f.rating)}</span> : null}
                    <span className="grow muted">{f.message}</span>
                  </motion.div>
                ))}
                {!state?.feedback?.length ? <p className="muted" style={{ margin: 0 }}>フィードバックなし · No feedback yet</p> : null}
              </div>
            </section>
            ) : null}
          </div>
        </div>
      </main>

      <AnimatePresence>{pb ? <Phrasebook key="pb" cfg={cfg} seat={pb.seat} onClose={() => setPb(null)} /> : null}</AnimatePresence>
      <OfflineRoster needs={state?.seat_needs || []} LANG_NAME={LANG_NAME} exitSeats={exitSeats} />
    </>
  );
}

function rowRange(seats) {
  const rows = [...new Set(seats.map((s) => parseInt(s, 10)))].sort((a, b) => a - b);
  if (!rows.length) return "";
  return rows.length === 1 ? `row ${rows[0]}` : `rows ${rows[0]}–${rows[rows.length - 1]}`;
}

function CardView({ c, cfg, send, myName, onTalk }) {
  const [ja, en, tone] = STATUS[c.status] || ["", c.status, "dim"];
  const mine = c.claimed_by && c.claimed_by === myName;
  const takenByOther = c.claimed_by && !mine;
  return (
    <motion.div layout className={`item citem ${c.urgent ? "is-urgent" : ""}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24, height: 0, padding: 0, margin: 0 }} transition={{ duration: 0.4, ease }}>
      <span className="who">{c.seat}
        {c.name ? <span className="muted" style={{ fontSize: 11, display: "block", fontWeight: 600 }} title="From a scanned boarding pass">{c.name}</span> : null}
        {c.zone ? <span className="muted" style={{ fontSize: 11, display: "block" }}>区画 {c.zone}</span> : null}
      </span>
      <div className="body">
        <div className="what">
          {c.intent ? (<><Icon id={c.intent} /><strong>{c.crew_ja}</strong><span className="muted">{c.label_en}</span></>)
            : c.translated ? (<><Icon id="globe" /><strong>{c.translated}</strong><span className="pill dim">未確認翻訳 unreviewed translation</span></>)
            : (<><strong>推定 Best guesses:</strong>{c.guesses.map((g) => <span key={g.intent} className="guess"><Icon id={g.intent} />{g.label_ja} ({g.score.toFixed(2)})</span>)}</>)}
          <span className={`pill ${tone}`}>{ja} · {en}</span>
          {c.symptom_ja ? <span className="pill bad symptom"><Icon id={c.symptom_icon} />症状 {c.symptom_ja} · {c.symptom_en}</span> : null}
          {c.voice_stress != null ? <span className="pill bad" title={`voice-stress heuristic, unvalidated: ${c.voice_stress}`}><Icon id="alert" />声が動揺 Voice sounded distressed</span> : null}
          {c.pictures ? <span className="pill violet" title="This passenger uses picture-only mode">絵のみ · Pictures only</span> : null}
          {c.source === "shake" ? <span className="pill amber" title="Sent by shaking the phone">📳 振って呼び出し · Shook phone</span> : null}
          {c.accessibility ? <span className="pill bad" title={ACCESSIBILITY_META[c.accessibility]?.en}><Icon id={ACCESSIBILITY_META[c.accessibility]?.icon} />{ACCESSIBILITY_META[c.accessibility]?.ja}</span> : null}
          {c.claimed_by ? <span className={`pill ${mine ? "ok" : "dim"}`}><Icon id="person" />{mine ? "自分が対応中 You're on this" : `${c.claimed_by} が対応中`}</span> : null}
        </div>
        {c.heard ? <span className="muted">“{c.heard}” · {c.lang}</span> : null}
        <div className="acts">
          {c.status !== "acknowledged" ? <button className="primary" onClick={() => send({ type: "ack", card_id: c.id })}>了解 Acknowledge</button> : null}
          {cfg.replies.map((r) => <button key={r.id} title={r.en} onClick={() => send({ type: "reply", card_id: c.id, reply_id: r.id })}>{r.ja}</button>)}
          <button onClick={() => send({ type: "close", card_id: c.id })}>完了 Done</button>
          <button onClick={onTalk}><Icon id="chat" /> 話す Talk</button>
          {mine ? <button onClick={() => send({ type: "release", card_id: c.id })}>手放す Release</button>
            : <button disabled={takenByOther} title={takenByOther ? `${c.claimed_by} is already on this` : undefined}
                onClick={() => send({ type: "claim", card_id: c.id })}>引き受ける Claim</button>}
        </div>
      </div>
    </motion.div>
  );
}

function CrewLiveConversation({ conv, send, muted, onToggleMute }) {
  const openSeats = Object.keys(conv).filter((s) => conv[s]?.open);
  const [picked, setPicked] = useState(null);
  const active = picked && openSeats.includes(picked) ? picked : openSeats[0] || null;
  const thread = active ? conv[active]?.messages || [] : [];

  return (
    <section className="panel">
      <div className="row">
        <span className="panel-title grow">自由会話 Live Conversation <span className="pill dim" style={{ fontWeight: 400, textTransform: "none" }}>unreviewed translation</span></span>
        <MuteButton muted={muted} onClick={onToggleMute} label={muted ? "音声オフ Unmute" : "音声オン Mute"} />
        {openSeats.length ? (
          <select aria-label="Seat" value={active || ""} onChange={(e) => setPicked(e.target.value)}>
            {openSeats.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        ) : null}
      </div>
      {!openSeats.length ? (
        <p className="muted" style={{ margin: 0 }}>進行中のライブ会話はありません · No Live Conversation panel is open right now.</p>
      ) : (<>
        <ConvThread messages={thread} mineFrom="crew" />
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const input = e.currentTarget.elements.text; const text = input.value.trim();
          if (!text) return;
          send({ type: "conv_text", seat: active, text }); input.value = "";
        }}>
          <input className="grow" name="text" autoComplete="off" placeholder="日本語で入力…" />
          <button className="primary" type="submit">送信 Send</button>
        </form>
      </>)}
    </section>
  );
}

function CrewFreeTalk({ cfg, LANG_NAME }) {
  const [lang, setLang] = useState(cfg.languages[0]?.code || "hi");
  return (
    <FreeTalkPanel fromLang="ja" toLang={lang} fromLabel="日本語" toLabel={LANG_NAME[lang] || lang}
      langPicker={
        <select aria-label="Passenger language" value={lang} onChange={(e) => setLang(e.target.value)}>
          {cfg.languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
        </select>
      } />
  );
}

// Cabin map colour key, so crew don't have to guess what a colour means mid-flight.
// Keep in sync with CabinMap's statusFor() and crew.css's .cabinmap .seat.* rules.
const MAP_LEGEND = [
  ["urgent", "var(--bad)", "至急 Urgent", "e.g. possible medical"],
  ["accessibility", "var(--violet)", "要配慮 Accessibility", "request from a passenger with an accessibility need"],
  ["open", "var(--warn)", "対応待ち Open request", "waiting, not yet urgent"],
  ["idle", "var(--idle)", "リクエストなし No request", ""],
];
function MapLegend() {
  return (
    <div className="map-legend" role="note" aria-label="Cabin map colour key">
      {MAP_LEGEND.map(([key, color, label, hint]) => (
        <span key={key} className="map-legend-item" title={hint || undefined}><i className="sw" style={{ background: color }} />{label}</span>
      ))}
    </div>
  );
}

function CabinMap({ state, cfg, exitSeats, selected, onSelect }) {
  if (!state) return null;
  const heat = state.heatmap || {};
  const needBySeat = Object.fromEntries((state.seat_needs || []).map((n) => [n.id, n]));
  const cardsBySeat = {};
  for (const c of state.cards || []) (cardsBySeat[c.seat] ||= []).push(c);
  const rows = [...new Set(cfg.seats.map((x) => x.slice(0, -1)))];

  function statusFor(id) {
    const cards = cardsBySeat[id];
    if (cards?.some((c) => c.urgent && c.status !== "acknowledged")) return "urgent";
    if (cards?.some((c) => c.accessibility)) return "accessibility";
    if (cards?.length) return "open";
    return heat[id] === "offline" ? "offline" : "idle";
  }

  // Laid out like looking down at the plane: each row of the cabin (30, 31, ...) is one column,
  // read front-to-back left-to-right; the 3 seats on each side of the aisle stack top-to-bottom
  // within it, with a gap for the aisle itself -- not a spreadsheet of rows and letters.
  return (
    <div className="cabinmap">
      {rows.map((row) => (
        <div className="cm-row" key={row}>
          <span className="cm-row-label">{row}</span>
          <div className="cm-seats">
            {["A", "B", "C", null, "D", "E", "G", null, "H", "J", "K"].map((letter, i) => {
              if (!letter) return <span className="cm-aisle" key={`gap-${i}`} />;
              const id = row + letter;
              const cards = cardsBySeat[id];
              const need = needBySeat[id];
              const bits = [id];
              if (cards?.length) bits.push(`${cards.length} open request${cards.length > 1 ? "s" : ""}`);
              if (need?.accessibility) bits.push(ACCESSIBILITY_META[need.accessibility]?.en);
              if (exitSeats.has(id)) bits.push("exit row");
              return (
                <button key={id} type="button" className={`seat ${statusFor(id)} ${exitSeats.has(id) ? "exit" : ""} ${selected === id ? "picked" : ""}`}
                  title={bits.join(" · ")} aria-label={bits.join(", ")} onClick={() => onSelect(id)}>
                  {letter}
                  {need?.accessibility ? <span className="seat-badge"><Icon id={ACCESSIBILITY_META[need.accessibility].icon} /></span> : null}
                </button>
              );
            })}
          </div>
        </div>))}
    </div>
  );
}

function SeatDetail({ seat, state, cfg, send, myName, LANG_NAME, onTalk, onChat }) {
  const cards = (state?.cards || []).filter((c) => c.seat === seat);
  const need = (state?.seat_needs || []).find((n) => n.id === seat);
  const lang = need?.lang || "hi";
  const convOpen = state?.conv_seats?.includes(seat);
  return (
    <div key={seat} style={{ display: "contents" }}>
      <div className="row">
        <h2 className="grow">{seat}{need?.name ? <span className="muted" style={{ fontSize: 15, fontWeight: 500 }}> · {need.name}</span> : null}</h2>
        {need ? <span className="pill dim">{LANG_NAME[need.lang] || need.lang}</span> : null}
        {need?.accessibility ? <span className="pill bad"><Icon id={ACCESSIBILITY_META[need.accessibility].icon} />{ACCESSIBILITY_META[need.accessibility].en}</span> : null}
        <span className={`dot ${need?.connected ? "on" : ""}`} title={need?.connected ? "screen connected" : "not connected"} />
      </div>
      {convOpen ? (
        <div className="row">
          <span className="pill violet"><Icon id="chat" />自由会話中 Live conversation open</span>
          <button className="ghost" onClick={onChat}>開く Open chat</button>
        </div>
      ) : null}
      {cards.length ? (
        <div className="list">
          <AnimatePresence initial={false}>
            {cards.map((c) => <CardView key={c.id} c={c} cfg={cfg} send={send} myName={myName} onTalk={() => onTalk(c.lang || lang)} />)}
          </AnimatePresence>
        </div>
      ) : (
        <p className="muted" style={{ margin: 0 }}>No open requests for this seat. <button className="link" onClick={() => onTalk(lang)}>話す Talk</button></p>
      )}
    </div>
  );
}

function Safety({ state, cfg, exitSeats, send }) {
  if (!state) return null;
  const b = state.broadcast, heat = state.heatmap || {};
  const tally = {};
  Object.values(heat).forEach((x) => (tally[x] = (tally[x] || 0) + 1));
  const rows = [...new Set(cfg.seats.map((x) => x.slice(0, -1)))];
  const stuck = b ? Object.entries(b.detail).filter(([, a]) => a.status === "stuck") : [];
  return (<>
    <div className="brief-title">{b ? (<><strong>{b.title_ja} · {b.title_en}</strong><button onClick={() => send({ type: "end_broadcast" })}>終了 End</button></>)
      : <span className="muted">No briefing running. Choose one above.</span>}</div>
    {b ? <div className="counts">{Object.entries(HEAT).filter(([k]) => tally[k]).map(([k, [ja, en, color]]) => (
      <span key={k}><i className="sw" style={{ background: color }} />{ja} {en}: {tally[k]}</span>))}</div> : null}
    <div className="seatmap">
      {rows.map((row) => (
        <Fragment key={row}>
          <span className="faint">{row}</span>
          {[..."ABCDEGHJK"].map((letter, i) => {
            const id = row + letter, st = heat[id];
            const step = b?.detail[id]?.step;
            const tip = `${id}: ${HEAT[st]?.[1] || st}${step != null ? ` at step ${step + 1}` : ""}${exitSeats.has(id) ? " · exit row" : ""}`;
            return (<Fragment key={id}>{i === 3 || i === 6 ? <span /> : null}
              <span className={`seat ${st || ""} ${exitSeats.has(id) ? "exit" : ""}`} title={tip} aria-label={tip}>{letter}</span></Fragment>);
          })}
        </Fragment>))}
    </div>
    {stuck.length ? <div className="goto"><strong>このお席へ · Go to these seats</strong>
      {stuck.map(([seat, a]) => { const x = b.steps[a.step] || {}; return (
        <motion.div key={seat} className="item" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}>
          <span className="who" style={{ font: "800 20px var(--display)" }}>{seat}</span><Picto id={x.pictogram} />
          <div className="grow"><strong>手順 {a.step + 1}: {x.ja || ""}</strong><br /><span className="muted">Step {a.step + 1}: {x.en || ""}</span></div>
        </motion.div>); })}</div> : null}
  </>);
}

// Fails safe: printed in advance (Passenger needs -> "Print offline backup"), this is the one
// thing that still works once the tablet can't reach the hub -- walk the cabin with paper instead
// of a live screen. Invisible on screen; CSS (crew.css) shows only this and hides everything else
// when the browser is told to print, same trick as the boarding-time seat QR cards (app/seats).
function OfflineRoster({ needs, LANG_NAME, exitSeats }) {
  return (
    <div className="offline-roster">
      <h1>Auralink — オフライン控え Offline backup</h1>
      <p>Printed {new Date().toLocaleString()}. If the tablet or hub stops working, walk the cabin
        and check these seats first -- their language, accessibility and any other noted needs.
        Exit rows: {[...exitSeats].sort().join(", ") || "none set"}.</p>
      {needs.length ? (
        <table>
          <thead><tr><th>Seat 座席</th><th>Language 言語</th><th>Accessibility 配慮事項</th><th>Notes</th></tr></thead>
          <tbody>
            {[...needs].sort((a, b) => a.id.localeCompare(b.id)).map((n) => (
              <tr key={n.id}>
                <td>{n.id}</td>
                <td>{LANG_NAME[n.lang] || n.lang}</td>
                <td>{n.accessibility ? `${ACCESSIBILITY_META[n.accessibility]?.en} · ${ACCESSIBILITY_META[n.accessibility]?.ja}` : ""}</td>
                <td>{[n.pictures && "Pictures only", n.senior && "Large text", n.read && "Read aloud"].filter(Boolean).join(", ")}</td>
              </tr>))}
          </tbody>
        </table>
      ) : <p>No special needs recorded -- everyone is using English with default settings.</p>}
    </div>
  );
}

function Needs({ needs, LANG_NAME, onTalk }) {
  if (!needs.length) return <p className="muted" style={{ margin: 0 }}>特記事項なし · Everyone uses English with default settings.</p>;
  const order = (n) => (n.accessibility || n.pictures ? 0 : n.senior ? 1 : 2);
  return (<div className="needs">{[...needs].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id)).map((n) => (
    <div key={n.id} className="need">
      <span className={`dot ${n.connected ? "on" : ""}`} title={n.connected ? "screen connected" : "not connected"} />
      <b>{n.id}</b>{n.name ? <span className="muted">{n.name}</span> : null}<span className="pill dim">{LANG_NAME[n.lang] || n.lang}</span>
      {n.pictures ? <span className="pill violet">絵のみ · Pictures only</span> : null}
      {n.senior ? <span className="pill ok">大きな文字 · Large text</span> : null}
      {n.read ? <span className="pill dim">読み上げ · Read aloud</span> : null}
      {n.accessibility ? <span className="pill bad"><Icon id={ACCESSIBILITY_META[n.accessibility]?.icon} />{ACCESSIBILITY_META[n.accessibility]?.ja}</span> : null}
      {n.checked_in ? <span className="muted">チェックイン時 · set at check-in</span> : null}
      <button onClick={() => onTalk(n)}><Icon id="chat" /> 話す Talk</button>
    </div>))}</div>);
}

function Round({ state, LABEL, send }) {
  if (!state) return null;
  const r = state.round, p = state.round_plan;
  const stopView = (st, active, k) => {
    const items = Object.entries(st.items.reduce((m, i) => ({ ...m, [i]: (m[i] || 0) + 1 }), {}));
    return (
      <motion.div layout key={st.seat} className={`stop ${st.care ? "care" : ""} ${st.done ? "done" : ""}`}>
        <span className="n">{k + 1}</span><b>{st.seat}</b>
        <span className="what">{items.map(([i, n]) => <span key={i} className="pill dim"><Icon id={i} />{LABEL[i]?.ja}{n > 1 ? ` ×${n}` : ""}</span>)}
          {st.care ? <span className="pill violet" title="Has not asked for anything for a while.">声かけ Check-in · {st.care.minutes} 分 min quiet{st.care.accessibility ? ` · ${ACCESSIBILITY_META[st.care.accessibility]?.ja}` : st.care.pictures ? " · 絵のみ" : st.care.senior ? " · 大きな文字" : ""}</span> : null}</span>
        {active && !st.done ? <button onClick={() => send({ type: "stop_done", seat: st.seat })}>完了 Done</button> : <span />}
      </motion.div>);
  };
  if (r) {
    const left = r.stops.filter((x) => !x.done).length;
    return (<>
      <p style={{ margin: 0 }}><span className="pill ok">ラウンド中 On round</span> 残り {left} / {r.stops.length} stops left</p>
      <div className="stops">{r.stops.map((x, k) => stopView(x, true, k))}</div>
      <div className="row"><button onClick={() => send({ type: "end_round" })}>ラウンド終了 End round</button></div>
    </>);
  }
  if (!p?.stops.length) return <p className="muted" style={{ margin: 0 }}>お届け待ちなし · Nothing to bring, nobody waiting for a check-in.</p>;
  const leftAisle = p.stops.filter((x) => "ABCDE".includes(x.seat.slice(-1)));
  const saved = p.walk_rows.separate ? Math.round(100 * (1 - p.walk_rows.round / p.walk_rows.separate)) : 0;
  return (<>
    <p className="muted" style={{ margin: 0 }}>Everything open that you carry, as one loop from the front galley: down the left aisle, back up the right.</p>
    <div className="load" aria-label="Trolley load"><strong>積載 Load</strong>{Object.entries(p.load).map(([i, n]) => <span key={i}><Icon id={i} />{LABEL[i]?.ja} · {LABEL[i]?.en} ×{n}</span>)}</div>
    {leftAisle.length ? <p className="aisle">左通路 LEFT AISLE ↓</p> : null}
    <div className="stops">{p.stops.map((x, k) => (<Fragment key={x.seat}>{k === leftAisle.length ?<p className="aisle">右通路 RIGHT AISLE ↑</p> : null}{stopView(x, false, k)}</Fragment>))}</div>
    {p.requests > 1 ? <p className="saving">1回で {p.requests} 件 · {p.requests} requests in one trip: about {saved}% less walking</p> : null}
    <div className="row"><button className="primary" onClick={() => send({ type: "start_round" })}>ラウンド開始 Start round ({p.stops.length} stops{p.care_stops ? `, ${p.care_stops} check-in` : ""})</button></div>
  </>);
}

function Phrasebook({ cfg, seat, onClose }) {
  const PB = cfg.phrasebook;
  const lang = "en";   // kept simple on purpose: crew's own Japanese plus a universal English fallback
  const [ui, setUi] = useState({});
  const [phrase, setPhrase] = useState(null);
  const [answer, setAnswer] = useState("");
  const log = useRef([]);
  useEffect(() => {
    fetch(`/api/i18n/${lang}`).then((r) => r.json()).then(setUi).catch(() => setUi({}));
  }, []); // eslint-disable-line
  const text = phrase ? phrase.text[lang] || phrase.text.en : "";
  // Always attempt it, rather than hiding the button behind an async voice pre-check that can be
  // wrong or slow: speak() already no-ops harmlessly if the browser truly has no voice for this.
  useEffect(() => { if (phrase) speak(text, lang); setAnswer(""); }, [phrase]); // eslint-disable-line
  const answerWith = (ja, en) => {
    setAnswer(`回答: ${ja} · ${en}`);
    log.current.push(`${seat || ""} ${phrase.text.ja} → ${ja} (${en})`);
    speak(ui.thanks || "", lang);
  };
  return (
    <motion.div className="pb" role="dialog" aria-label="Phrasebook" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: 0.35, ease }}>
      <div className="pb-top">
        <h2>{seat ? `${seat} · ` : ""}会話帳 Phrasebook</h2>
        <button onClick={onClose}><Icon id="close" /> 閉じる Close</button>
      </div>
      <AnimatePresence mode="wait">
        {!phrase ? (
          <motion.div key="list" className="pb-body" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {log.current.length ? <div className="pa-log"><strong>回答 Answers</strong>{log.current.slice(-5).reverse().map((x, k) => <span key={k}>{x}</span>)}</div> : null}
            {PB.groups.map((g) => (
              <section key={g.id} className="pb-group"><h3>{g.ja} · {g.en}</h3>
                <div className="pb-list">{PB.phrases.filter((p) => p.group === g.id).map((p, k) => (
                  <button key={k} onClick={() => setPhrase(p)}><b>{p.text.ja}</b><small>{p.text.en}</small>{p.yes_no ? <span className="yn">はい / いいえ · Yes / No</span> : null}</button>))}</div>
              </section>))}
          </motion.div>
        ) : (
          <motion.div key="show" className="show" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ ease }}>
            <p className="hint">タブレットをお客様に向けてください · Turn the tablet to the passenger</p>
            <p className="bigtext" lang={lang}>{text}</p>
            <p className="muted" style={{ fontSize: 16, margin: 0 }}>{phrase.text.ja} · {phrase.text.en}</p>
            <div><button onClick={() => speak(text, lang)}><Icon id="speaker" /> もう一度 Again</button></div>
            {phrase.yes_no ? <div className="answers">
              <button className="yes" onClick={() => answerWith("はい", "Yes")}>{ui.yes || "Yes"}</button>
              <button className="no" onClick={() => answerWith("いいえ", "No")}>{ui.no || "No"}</button>
              <button onClick={() => answerWith("分からない", "Not clear")}>{ui.stillUnclear || "Not clear"}</button></div> : null}
            <p className="answer-out" role="status">{answer}</p>
            <div><button className="primary" onClick={() => setPhrase(null)}>← 一覧へ Back to phrases</button></div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
