"use client";
// "Under the hood": renders hub/explain.py output. Live from /ws/judge, or typed via /api/explain.
import "./judge.css";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { connect } from "@/lib/hub";
import { Ambient, Brand, ease } from "@/components/ui";

const RULE_PILL = { confident: ["Confident", "ok"], split: ["Split", "ok"], close: ["Ask", "amber"], flat: ["Not sure", "amber"], empty: ["No speech", "dim"] };
const SCALE_MAX = 1.2;   // context priors can lift a score above 1
const pct = (v) => `${Math.min(100, (v / SCALE_MAX) * 100).toFixed(1)}%`;
const ms = (v) => (v == null ? "–" : v >= 100 ? `${Math.round(v)} ms` : `${v.toFixed(1)} ms`);
const STAGES = [["vad", "Silence filter"], ["encode", "Whisper encoder"], ["decode_en", "English guesses"], ["decode_hi", "Hindi guesses"], ["match", "Phonetic matcher"]];
const EXAMPLES = ["Shawchale kaha hai", "Madham thora wotar and cumble please", "I can't breathe", "शोचाले कहा है", "Mujhi ik takyaadiji"];

export default function Judge() {
  const [history, setHistory] = useState([]);
  const [current, setCurrent] = useState(0);
  const [live, setLive] = useState(false);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState("cruise");

  const add = (entry) => { setHistory((h) => [entry, ...h].slice(0, 12)); setCurrent(0); };
  useEffect(() => {
    const sock = connect("/ws/judge", (msg) => {
      if (msg.type !== "result" || !msg.explain) return;
      add({ x: msg.explain, source: msg.source, seat: msg.seat, label: msg.explain.nbest[0]?.text || "(silence)", id: Math.random() });
    }, setLive);
    return () => sock.close();
  }, []);

  async function explainTyped(t) {
    const res = await fetch("/api/explain", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t, phase }) });
    if (!res.ok) return;
    const body = await res.json();
    add({ x: body.explain, source: "typed", seat: null, label: t, id: Math.random() });
  }

  const entry = history[current];
  return (
    <>
      <Ambient />
      <header className="app-header">
        <Brand crumb="Under the hood" />
        <span className={`j-live ${live ? "on" : ""}`}><i /><span>{live ? "Live: listening to the cabin" : "Connecting…"}</span></span>
        <form className="j-try" onSubmit={(e) => { e.preventDefault(); if (text.trim()) explainTyped(text.trim()); }}>
          <input placeholder="Type a phrase, or speak on a passenger screen" autoComplete="off" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} aria-label="Try a phrase" />
          <select value={phase} onChange={(e) => setPhase(e.target.value)} aria-label="Flight phase">
            <option value="boarding">Boarding</option><option value="cruise">Cruise</option><option value="meal">Meal service</option><option value="post_meal">After meal</option><option value="descent">Descent</option>
          </select>
          <button className="primary" type="submit">Explain</button>
        </form>
      </header>

      <main className="app" style={{ maxWidth: 1300 }}>
        {!entry ? (
          <motion.section className="j-empty" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease }}>
            <span className="mono" style={{ color: "var(--accent)", fontSize: 12, letterSpacing: ".18em" }}>— GLASS BOX</span>
            <h1>Every decision, <span>in the open.</span></h1>
            <p>Speak on a passenger screen or type a phrase above. This screen shows what Auralink heard, which sounds it matched, how it scored them, and why it asked or didn’t.</p>
            <div className="examples">{EXAMPLES.map((x) => <button key={x} onClick={() => { setText(x); explainTyped(x); }}>{x}</button>)}</div>
          </motion.section>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={entry.id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease }} style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <View entry={entry} />
            </motion.div>
          </AnimatePresence>
        )}
        {history.length ? (
          <section className="panel history"><h2>Recent</h2>
            <ol>{history.map((h, i) => <li key={h.id}><button className={i === current ? "on" : ""} onClick={() => setCurrent(i)} title={h.label}>{h.source === "voice" ? "🎤 " : ""}{h.label}</button></li>)}</ol>
          </section>) : null}
      </main>
    </>
  );
}

function View({ entry }) {
  const { x, source, seat } = entry;
  const heard = new Set(x.cards.flatMap((c) => c.candidates.slice(0, 1).flatMap((k) => k.heard.split(" "))));
  const [name, tone] = x.urgent ? ["Urgent", "bad"] : RULE_PILL[x.rule] || ["?", "dim"];
  const nbest = x.nbest.length ? x.nbest : [{ text: "(nothing)", conf: 0, lang: null }];
  const meter = (label, value, target) => (
    <div className={`meter ${value != null && value > target ? "over" : ""}`}>
      <div className="meter-row"><span>{label}</span><span>{value == null ? "not used" : `${ms(value)} of ${target} ms budget`}</span></div>
      <div className="meter-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${value == null ? 0 : Math.min(100, (value / target) * 100)}%` }} transition={{ duration: 0.9, ease }} /></div>
    </div>);
  return (<>
    <section className="pipeline" aria-label="Pipeline timing">
      {STAGES.map(([key, label], k) => { const v = x.latency_ms[key]; return (
        <motion.div key={key} className={`stage ${v == null ? "off" : ""}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: v == null ? 0.35 : 1, y: 0 }} transition={{ delay: k * 0.07, ease }}>
          <span className="s-name">{label}</span><b>{v == null ? (source === "typed" ? "typed" : "–") : ms(v)}</b></motion.div>); })}
      <div className="budget">{meter("Speech to text", x.stages.speech_to_text, x.targets_ms.speech_to_text)}{meter("Matching", x.stages.match, x.targets_ms.match)}</div>
    </section>

    <div className="grid2">
      <section className="panel jpanel">
        <h2><span className="n">1</span>What was heard</h2>
        <Wave x={x} source={source} />
        <ol className="nbest">{nbest.map((h, k) => (
          <motion.li key={k} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * k }}>
            <span className={`lang ${h.lang || "typed"}`}>{h.lang ? h.lang.toUpperCase() : "TXT"}</span>
            <span className="nb-text" lang={h.lang === "hi" ? "hi" : "en"}>{h.text}</span>
            <span className="nb-conf">{source === "typed" ? "typed" : `p ${h.conf.toFixed(2)}`}</span></motion.li>))}</ol>
      </section>
      <section className="panel jpanel">
        <h2><span className="n">2</span>Words that matter</h2>
        <p className="hint">Filler words are ignored, matched by sound too, so “madham” counts as “madam”.</p>
        <div className="tokens">{(x.tokens.length ? x.tokens : [{ text: "(no words)", filler: true }]).map((tk, k) => (
          <motion.span key={k} className={`tok ${tk.filler ? "filler" : heard.has(tk.text) ? "hit" : ""}`} title={tk.filler ? "ignored filler word" : ""}
            initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + k * 0.06, ease }}>{tk.text}</motion.span>))}</div>
        <div className="decision">
          <div className="rule"><span className={`pill ${tone}`}>{name}</span>Rule: {x.rule}</div>
          <p>{x.rule_text}</p>
          {x.urgent ? <p className="urgent-line">Medical request: crew alerted immediately, before the passenger confirms.</p> : null}
          <p className="mono" style={{ fontSize: 12, color: "var(--faint)" }}>{source === "typed" ? "typed" : `seat ${seat} · ${source}`} · phase {x.phase} · matcher {x.matcher} · t1 {x.thresholds.t1} · t2 {x.thresholds.t2}</p>
        </div>
      </section>
    </div>

    <section className="panel jpanel">
      <h2><span className="n">3</span>Requests found, and how each was scored</h2>
      {!x.cards.length ? (
        <p className="hint" style={{ margin: 0 }}>No request scored above t1 = {x.thresholds.t1}. {x.best_guesses.length ? `Best guesses: ${x.best_guesses.map((b) => `${b.intent} ${b.score.toFixed(2)}`).join(", ")}. ` : ""}
          The passenger sees the picture grid; after two misses the crew get a “please help” card with these guesses.</p>
      ) : (
        <div className="jcards">{x.cards.map((card, n) => {
          const top = card.candidates[0];
          const status = card.urgent ? ["Urgent", "bad"] : card.status === "close" ? ["Ask: two pictures", "amber"] : ["Confirm with one tap", "ok"];
          return (
            <motion.article key={n} className={`jcard ${card.urgent ? "urgent" : ""}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 + n * 0.1, ease }}>
              <div className="card-head"><h3>Card {n + 1}: {top.label}</h3><span className="span">from “{card.span}”</span><span className={`pill ${status[1]}`}>{status[0]}</span></div>
              <div className="scale">{card.candidates.map((c, k) => (
                <div key={k} className={`jcand ${k === 0 ? "top" : ""} ${c.urgent ? "urgent" : ""}`}>
                  <span className="cand-name">{c.label}<small lang="ja">{c.label_ja}</small></span>
                  <span className="track"><motion.i initial={{ width: 0 }} animate={{ width: pct(c.score) }} transition={{ duration: 0.9, delay: 0.2 + k * 0.06, ease }} />
                    {k === 0 ? <span className="mark" style={{ left: pct(x.thresholds.t1) }}><span>t1 {x.thresholds.t1}</span></span> : null}
                    {k === 0 && c.urgent ? <span className="mark urg" style={{ left: pct(x.thresholds.urgent) }}><span>urgent</span></span> : null}</span>
                  <span className="why">{c.score.toFixed(2)} · “{c.heard}” ≈ “{c.matched}”</span>
                </div>))}</div>
              {card.margin != null ? <div className="margin-note">Gap to second guess <b>{card.margin.toFixed(2)}</b>
                {card.margin < x.thresholds.t2 ? ` < t2 ${x.thresholds.t2} → too close, ask the passenger` : ` ≥ t2 ${x.thresholds.t2} → clear winner`}</div> : null}
              {top.detail ? <Alignment c={top} /> : null}
              {card.status === "close" && card.candidates[1]?.detail ? <Alignment c={card.candidates[1]} /> : null}
            </motion.article>);
        })}</div>
      )}
    </section>
  </>);
}

function Alignment({ c }) {
  const d = c.detail;
  const reasons = [...new Set(d.steps.filter((s) => s.why && s.cost < 1).map((s) => `${s.heard || "∅"}→${s.word || "∅"}: ${s.why} (+${s.cost})`))];
  return (
    <div className="align">
      <div className="align-title"><span>“{c.heard}” sounds like “{c.matched}”</span>
        <span className="eq">sound <b>{d.sound ?? d.score}</b> · spelling <b>{d.spelling ?? "–"}</b> → <b>{c.raw}</b>{c.prior !== 1 ? <> × phase prior {c.prior} = <b>{c.score}</b></> : null}</span></div>
      <div className="phones" role="img" aria-label={`Phoneme alignment of ${c.heard} and ${c.matched}`}>
        <span className="rowlab">heard</span><span className="rowlab" /><span className="rowlab">word</span>
        {d.steps.flatMap((s, k) => {
          const cls = `col-${s.op} ${s.cost >= 0.75 ? "costly" : s.cost > 0 ? "cheap" : ""}`;
          const anim = { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.3 + k * 0.04 } };
          return [
            <motion.span key={`h${k}`} className={cls} {...anim}><span className={`ph ${s.heard ? "" : "gap"}`}>{s.heard || "–"}</span></motion.span>,
            <motion.span key={`o${k}`} className={`op ${cls}`} {...anim}>{s.op === "match" ? "=" : s.op === "skip" ? "" : `+${s.cost}`}</motion.span>,
            <motion.span key={`w${k}`} className={cls} {...anim}><span className={`ph ${s.word ? "" : "gap"}`}>{s.word || "–"}</span></motion.span>,
          ];
        })}
      </div>
      {d.inside ? <div className="inside-note">Found inside a longer word (words run together), score × 0.9</div> : null}
      {reasons.length ? <div className="reasons">{reasons.map((r) => <span key={r} className="reason">{r}</span>)}</div> : null}
    </div>);
}

function Wave({ x, source }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!x.waveform || !ref.current) return;
    const canvas = ref.current;
    const draw = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2), w = canvas.clientWidth, h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
      ctx.fillStyle = "rgba(255,91,91,.10)";
      for (const [a, b] of x.waveform.speech) ctx.fillRect(a * w, 0, (b - a) * w, h);
      const peaks = x.waveform.peaks, bw = w / peaks.length, max = Math.max(...peaks, 0.05);
      peaks.forEach((p, i) => {
        const inSpeech = x.waveform.speech.some(([a, b]) => i / peaks.length >= a && i / peaks.length <= b);
        ctx.fillStyle = inSpeech ? "#ff5b5b" : "#33333a";
        const bh = Math.max(2, (p / max) * (h - 12));
        ctx.fillRect(i * bw + 1, (h - bh) / 2, Math.max(1, bw - 2), bh);
      });
    };
    draw(); addEventListener("resize", draw);
    return () => removeEventListener("resize", draw);
  }, [x]);
  if (!x.waveform) return <div className="typed">{source === "typed" ? "Typed phrase: no audio. Speak on a passenger screen to see the waveform." : x.rejected ? `Rejected before speech-to-text: ${x.rejected}` : "No audio"}</div>;
  return (<div className="wave"><canvas ref={ref} role="img" aria-label="Waveform with detected speech highlighted" />
    <div className="wave-cap"><span>{x.waveform.seconds} s recorded</span><span>highlighted: speech found by the silence filter</span></div></div>);
}
