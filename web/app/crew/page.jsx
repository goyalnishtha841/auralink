"use client";
// Crew tablet (Japanese first). Same protocol and behaviour as the original apps/crew.html.
import "./crew.css";
import { AnimatePresence, motion } from "framer-motion";
import { Fragment, useEffect, useRef, useState } from "react";
import { Recorder, connect, crewFetch, loadConfig, toBase64 } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { Picto } from "@/lib/pictograms";
import { canSpeak, speak } from "@/lib/speech";
import { Ambient, AppHeader, ease } from "@/components/ui";

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

export default function Crew() {
  const [cfg, setCfg] = useState(null);
  const [state, setState] = useState(null);
  const [online, setOnline] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [readAloud, setReadAloud] = useState(false);
  const [jaVoice, setJaVoice] = useState(false);
  const [pb, setPb] = useState(null);           // {seat, lang}
  const [pa, setPa] = useState(null);           // match result | {busy} | {error} | {sent}
  const [paPick, setPaPick] = useState(null);
  const [paN, setPaN] = useState("");
  const [paRecOn, setPaRecOn] = useState(false);
  const socket = useRef(null), audio = useRef(null), paRec = useRef(null);
  const seenUrgent = useRef(new Set()), announced = useRef(null), announcedSymptom = useRef(new Set());
  const opts = useRef({ soundOn: true, readAloud: false }); opts.current = { soundOn, readAloud };

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

  useEffect(() => {
    const unlock = () => { audio.current ??= new AudioContext(); };
    addEventListener("pointerdown", unlock, { once: true });
    canSpeak("ja").then(setJaVoice);
    loadConfig().then((c) => {
      setCfg(c);
      socket.current = connect("/ws/crew", (msg) => { if (msg.type === "state") { sideEffects(msg); setState(msg); } }, setOnline);
    });
    return () => { socket.current?.close(); removeEventListener("pointerdown", unlock); };
  }, []); // eslint-disable-line

  const send = (m) => socket.current?.send(m);

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
      try { await paRec.current.start(28, () => paRec.current && paMic()); } catch { paRec.current = null; return; }
      setPaRecOn(true);
    } else {
      const pcm = await paRec.current.stop(); paRec.current = null; setPaRecOn(false);
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

  return (
    <>
      <Ambient />
      <AppHeader online={online} title="客室乗務員パネル" sub="Crew panel">
        <label className="row muted">飛行フェーズ Phase
          <select value={state?.phase || "cruise"} onChange={(e) => send({ type: "phase", phase: e.target.value })}>
            {cfg.phases.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <button className="ghost" aria-pressed={soundOn} onClick={() => setSoundOn((x) => !x)}><Icon id="bell" /> {soundOn ? "音 Sound on" : "消音 Muted"}</button>
        <button className="ghost" onClick={() => setPb({ seat: null, lang: "hi" })}><Icon id="chat" /> 会話帳 Phrasebook</button>
        {jaVoice ? <label className="row muted"><input type="checkbox" checked={readAloud} onChange={(e) => setReadAloud(e.target.checked)} /> 読み上げ Read aloud</label> : null}
      </AppHeader>

      <main className="app" style={{ maxWidth: 1320 }}>
        <AnimatePresence>
          {openUrgent.map((c) => (
            <motion.div key={c.id} className="alarm" role="alert" initial={{ opacity: 0, y: -16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, height: 0 }} transition={{ ease }}>
              <b>{c.seat}</b>
              <span>{(c.crew_ja || "体調不良の可能性").startsWith("【至急】") ? "" : "【至急】"}{c.crew_ja || "体調不良の可能性"} · Urgent: {c.label_en || "possible medical"}</span>
              {c.symptom_ja ? <strong> — 症状: {c.symptom_ja} · {c.symptom_en}</strong> : null}
            </motion.div>))}
        </AnimatePresence>

        <div className="crew-layout">
          <div className="col">
            <section className="panel">
              <h2>リクエスト Requests</h2>
              <div className="list">
                <AnimatePresence initial={false}>
                  {cards.map((c) => <CardView key={c.id} c={c} cfg={cfg} send={send} onTalk={() => setPb({ seat: c.seat, lang: c.lang })} />)}
                </AnimatePresence>
                {!cards.length ? <p className="muted" style={{ margin: 0 }}>リクエストなし · No open requests</p> : null}
              </div>
            </section>
            <section className="panel"><h2>ケアラウンド Care round</h2><Round state={state} LABEL={LABEL} send={send} /></section>
            <section className="panel">
              <h2>乗客のニーズ Passenger needs</h2>
              <p className="muted" style={{ margin: 0 }}>From check-in and the passengers' own settings. Plan who may need help before take-off.</p>
              <Needs needs={state?.seat_needs || []} LANG_NAME={LANG_NAME} onTalk={(n) => setPb({ seat: n.id, lang: n.lang })} />
            </section>
          </div>

          <div className="col">
            <section className="panel">
              <h2>安全案内 Safety briefing</h2>
              <div className="row">{cfg.safety.map((x) => <button key={x.id} onClick={() => send({ type: "broadcast", template_id: x.id })}>{x.title.ja} · {x.title.en}</button>)}</div>
              <Safety state={state} cfg={cfg} exitSeats={exitSeats} send={send} />
            </section>

            <section className="panel">
              <h2>機内アナウンス字幕 Live PA captions</h2>
              <p className="muted" style={{ margin: 0 }}>Make the announcement as usual, with the tablet listening. Every seat sees it in its own language. Only announcements in the library are captioned; nothing is machine-translated.</p>
              <div className="row">
                <button className={`primary pa-mic ${paRecOn ? "recording" : ""}`} onClick={paMic}><Icon id="mic" /> {paRecOn ? "停止 Stop" : "録音 Record announcement"}</button>
                <form className="row grow" style={{ flex: "1 1 280px" }} onSubmit={(e) => { e.preventDefault(); const v = e.currentTarget.elements.pa.value.trim(); if (v) paMatch({ text: v }); }}>
                  <input className="grow" name="pa" autoComplete="off" placeholder="…or type it: We have started our descent, 20 minutes" aria-label="Typed announcement" />
                  <button type="submit">照合 Match</button></form>
              </div>
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
          </div>
        </div>
      </main>

      <AnimatePresence>{pb ? <Phrasebook key="pb" cfg={cfg} seat={pb.seat} lang={pb.lang} onLang={(l) => setPb({ ...pb, lang: l })} onClose={() => setPb(null)} /> : null}</AnimatePresence>
    </>
  );
}

function CardView({ c, cfg, send, onTalk }) {
  const [ja, en, tone] = STATUS[c.status] || ["", c.status, "dim"];
  return (
    <motion.div layout className={`item citem ${c.urgent ? "is-urgent" : ""}`} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24, height: 0, padding: 0, margin: 0 }} transition={{ duration: 0.4, ease }}>
      <span className="who">{c.seat}</span>
      <div className="body">
        <div className="what">
          {c.intent ? (<><Icon id={c.intent} /><strong>{c.crew_ja}</strong><span className="muted">{c.label_en}</span></>)
            : (<><strong>推定 Best guesses:</strong>{c.guesses.map((g) => <span key={g.intent} className="guess"><Icon id={g.intent} />{g.label_ja} ({g.score.toFixed(2)})</span>)}</>)}
          <span className={`pill ${tone}`}>{ja} · {en}</span>
          {c.symptom_ja ? <span className="pill bad symptom"><Icon id={c.symptom_icon} />症状 {c.symptom_ja} · {c.symptom_en}</span> : null}
          {c.pictures ? <span className="pill violet" title="This passenger uses picture-only mode">絵のみ · Pictures only</span> : null}
        </div>
        {c.heard ? <span className="muted">“{c.heard}” · {c.lang}</span> : null}
        <div className="acts">
          {c.status !== "acknowledged" ? <button className="primary" onClick={() => send({ type: "ack", card_id: c.id })}>了解 Acknowledge</button> : null}
          {cfg.replies.map((r) => <button key={r.id} title={r.en} onClick={() => send({ type: "reply", card_id: c.id, reply_id: r.id })}>{r.ja}</button>)}
          <button onClick={() => send({ type: "close", card_id: c.id })}>完了 Done</button>
          <button onClick={onTalk}><Icon id="chat" /> 話す Talk</button>
        </div>
      </div>
    </motion.div>
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

function Needs({ needs, LANG_NAME, onTalk }) {
  if (!needs.length) return <p className="muted" style={{ margin: 0 }}>特記事項なし · Everyone uses English with default settings.</p>;
  const order = (n) => (n.pictures ? 0 : n.senior ? 1 : 2);
  return (<div className="needs">{[...needs].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id)).map((n) => (
    <div key={n.id} className="need">
      <span className={`dot ${n.connected ? "on" : ""}`} title={n.connected ? "screen connected" : "not connected"} />
      <b>{n.id}</b><span className="pill dim">{LANG_NAME[n.lang] || n.lang}</span>
      {n.pictures ? <span className="pill violet">絵のみ · Pictures only</span> : null}
      {n.senior ? <span className="pill ok">大きな文字 · Large text</span> : null}
      {n.read ? <span className="pill dim">読み上げ · Read aloud</span> : null}
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
          {st.care ? <span className="pill violet" title="Has not asked for anything for a while.">声かけ Check-in · {st.care.minutes} 分 min quiet{st.care.pictures ? " · 絵のみ" : st.care.senior ? " · 大きな文字" : ""}</span> : null}</span>
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

function Phrasebook({ cfg, seat, lang, onLang, onClose }) {
  const PB = cfg.phrasebook;
  const [ui, setUi] = useState({});
  const [voice, setVoice] = useState(false);
  const [phrase, setPhrase] = useState(null);
  const [answer, setAnswer] = useState("");
  const log = useRef([]);
  useEffect(() => {
    fetch(`/api/i18n/${lang}`).then((r) => r.json()).then(setUi).catch(() => setUi({}));
    canSpeak(lang).then(setVoice);
    setPhrase(null);
  }, [lang]);
  const text = phrase ? phrase.text[lang] || phrase.text.en : "";
  useEffect(() => { if (phrase && voice) speak(text, lang); setAnswer(""); }, [phrase]); // eslint-disable-line
  const answerWith = (ja, en) => {
    setAnswer(`回答: ${ja} · ${en}`);
    log.current.push(`${seat || ""} ${phrase.text.ja} → ${ja} (${en})`);
    if (voice) speak(ui.thanks || "", lang);
  };
  return (
    <motion.div className="pb" role="dialog" aria-label="Phrasebook" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 30 }} transition={{ duration: 0.35, ease }}>
      <div className="pb-top">
        <h2>{seat ? `${seat} · ` : ""}会話帳 Phrasebook</h2>
        <select aria-label="Passenger language" value={lang} onChange={(e) => onLang(e.target.value)}>{cfg.languages.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}</select>
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
            {voice ? <div><button onClick={() => speak(text, lang)}><Icon id="speaker" /> もう一度 Again</button></div> : null}
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
