"use client";
import "./landing.css";
import { AnimatePresence, motion, useScroll, useTransform, animate, useInView } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/lib/icons";
import { BrandMark, Reveal, Sakura, ease } from "@/components/ui";

const WORDS = [
  ["understood.", "en"], ["समझा गया।", "hi"], ["伝わる。", "ja"], ["เข้าใจแล้ว", "th"], ["புரிந்தது.", "ta"], ["dimengerti.", "id"],
];
const splitStop = (w) => (/[.。।]$/.test(w) ? [w.slice(0, -1), w.slice(-1)] : [w, ""]);

/* ---------- hero: sound ribbons that start chaotic and calm into the window (meaning: noisy speech → one clear request) ---------- */
function makeSimplex() {
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const p = new Uint8Array(256).map((_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512), perm12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; perm12[i] = perm[i] % 12; }
  const g = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1, 0, -1];
  return (x, y) => {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s), t = (i + j) * G2;
    const x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    const c = (tx, ty, gi) => { let tt = 0.5 - tx * tx - ty * ty; if (tt < 0) return 0; tt *= tt; return tt * tt * (g[gi * 2] * tx + g[gi * 2 + 1] * ty); };
    return 70 * (c(x0, y0, perm12[ii + perm[jj]]) + c(x1, y1, perm12[ii + i1 + perm[jj + j1]]) + c(x2, y2, perm12[ii + 1 + perm[jj + 1]]));
  };
}

function Ribbons() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current, ctx = canvas.getContext("2d"), noise = makeSimplex();
    // one clear, quiet thread — not a tangle of lines (the point is noise resolving to one request)
    const lines = [
      ["255,91,91", 0.28, 1],
    ];
    // static: drawn once (and again on resize), never animated or moved by the pointer
    let w = 0, h = 0;
    const t = 0.35;
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };
    const sm = (a, b, x) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
    function draw() {
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      const mobile = w < 900;
      const cy = h * (mobile ? 0.36 : 0.55), end = mobile ? 1 : 0.7, amp = Math.min(h * 0.05, 34);
      lines.forEach(([rgb, alpha, width], idx) => {
        ctx.beginPath();
        for (let x = 0; x <= w * end + 6; x += 5) {
          const u = x / (w * end);
          const chaos = 1 - sm(0.1, 0.75, u);
          const stir = 1;
          const n = noise(x * 0.0022 * stir, idx * 9.7 + t);
          const pulse = Math.sin(t * 0.6 + idx) * 0.12 + 0.88;
          const y = cy + n * amp * (chaos * 0.55 + 0.12) * pulse * stir + (idx - (lines.length - 1) / 2) * 16 * chaos;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const grad = ctx.createLinearGradient(0, 0, w * end, 0);
        grad.addColorStop(0, `rgba(${rgb},0)`);
        grad.addColorStop(0.3, `rgba(${rgb},${alpha * 0.5})`);
        grad.addColorStop(0.75, `rgba(${rgb},${alpha})`);
        grad.addColorStop(1, `rgba(${rgb},0)`);
        ctx.strokeStyle = grad;
        ctx.lineWidth = width * 4; ctx.globalAlpha = 0.045; ctx.stroke();
        ctx.lineWidth = width; ctx.globalAlpha = 1; ctx.stroke();
      });
      ctx.globalCompositeOperation = "source-over";
    }
    addEventListener("resize", resize);
    resize();
    return () => removeEventListener("resize", resize);
  }, []);
  return <canvas className="hero-canvas" ref={ref} aria-hidden="true" />;
}

function Petals() {
  const [petals, setPetals] = useState([]);
  useEffect(() => {
    setPetals(Array.from({ length: 16 }, (_, i) => ({
      left: `${38 + Math.random() * 62}%`, s: `${8 + Math.random() * 12}px`, d: `${11 + Math.random() * 12}s`,
      delay: `${-Math.random() * 20}s`, sway: `${30 + Math.random() * 90}px`, key: i,
    })));
  }, []);
  return (
    <div className="petals" aria-hidden="true">
      {petals.map((p) => <i key={p.key} className="petal" style={{ left: p.left, "--s": p.s, "--d": p.d, "--delay": p.delay, "--sway": p.sway }} />)}
    </div>
  );
}

/* sakura soundwave divider: sits in the whitespace between two sections only (never above the first
   section, never inside a card). One glowing coral→white curve, a small cropped branch framing each
   edge, a few static scattered petals — reused as-is between every major section. */
const DIVIDER_PETALS = [
  { s: "9px", left: "16%", top: "28%", r: "-18deg", o: 0.5 },
  { s: "7px", left: "27%", top: "62%", r: "24deg", o: 0.4 },
  { s: "11px", left: "46%", top: "18%", r: "8deg", o: 0.45 },
  { s: "8px", left: "62%", top: "66%", r: "-30deg", o: 0.4 },
  { s: "10px", left: "78%", top: "32%", r: "16deg", o: 0.5 },
  { s: "7px", left: "88%", top: "58%", r: "-10deg", o: 0.38 },
];
function Divider() {
  return (
    <div className="divider" aria-hidden="true">
      <img className="divider-branch left" src="/sakura-branch.svg" alt="" />
      <svg className="divider-wave" viewBox="0 0 1200 90" preserveAspectRatio="none">
        <defs>
          <linearGradient id="waveGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ff5b5b" stopOpacity="0" />
            <stop offset="0.18" stopColor="#ff5b5b" stopOpacity="0.85" />
            <stop offset="0.5" stopColor="#ffd2c4" stopOpacity="0.95" />
            <stop offset="0.82" stopColor="#ff5b5b" stopOpacity="0.85" />
            <stop offset="1" stopColor="#ff5b5b" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d="M0 45 C 150 10, 300 80, 450 45 C 600 14, 750 76, 900 45 C 1000 24, 1100 60, 1200 45"
          fill="none" stroke="url(#waveGrad)" strokeWidth="10" opacity="0.12" />
        <path d="M0 45 C 150 10, 300 80, 450 45 C 600 14, 750 76, 900 45 C 1000 24, 1100 60, 1200 45"
          fill="none" stroke="url(#waveGrad)" strokeWidth="1.6" />
      </svg>
      <img className="divider-branch right" src="/sakura-branch.svg" alt="" />
      {DIVIDER_PETALS.map((p, i) => (
        <i key={i} className="divider-petal" style={{ left: p.left, top: p.top, "--s": p.s, "--r": p.r, "--o": p.o }} />
      ))}
    </div>
  );
}

function Rotor() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => { if (!document.hidden) setI((x) => (x + 1) % WORDS.length); }, 2600);
    return () => clearInterval(id);
  }, []);
  const [word, lang] = WORDS[i];
  const [body, stop] = splitStop(word);
  return (
    <span className="rotor" aria-label="understood">
      <AnimatePresence initial={false}>
        <motion.span key={word} lang={lang} initial={{ y: "70%", opacity: 0, filter: "blur(10px)" }}
          animate={{ y: "0%", opacity: 1, filter: "blur(0px)" }} exit={{ y: "-70%", opacity: 0, filter: "blur(8px)" }}
          transition={{ duration: 0.8, ease }}>
          {body}<span className="stop">{stop || "."}</span>
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function Hero() {
  const { scrollY } = useScroll();
  const imgY = useTransform(scrollY, [0, 800], [0, 120]);
  const copyY = useTransform(scrollY, [0, 800], [0, -60]);
  const fade = useTransform(scrollY, [0, 600], [1, 0.2]);
  const up = (d) => ({ initial: { opacity: 0, y: 26 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.9, delay: d, ease } });
  return (
    <section className="hero" id="top">
      <motion.div className="hero-art" aria-hidden="true" initial={{ opacity: 0, scale: 1.06 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.8, ease }} style={{ y: imgY }}>
        <img src="/hero.jpg" alt="" />
      </motion.div>
      <Ribbons />
      <Petals />
      <motion.p className="vertical-jp" lang="ja" {...up(1.1)}>言葉の先に、つながる旅。</motion.p>
      <motion.div className="wrap" style={{ y: copyY, opacity: fade }}>
        <div className="hero-copy">
          <motion.p className="flight-strip" {...up(0.15)}>
            <span className="line" /><span>JAL-PS-02</span><span className="sep" />
            <span>DEL</span>
            <span className="plane"><svg viewBox="0 0 34 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
              <motion.path d="M1 6 H31 M26 1 L31 6 L26 11" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, delay: 0.6, ease }} />
            </svg></span>
            <span>HND</span><span className="sep" /><span>Accessible cabin communication</span>
          </motion.p>
          <h1>
            <motion.span className="l1" {...up(0.25)}>Every passenger,</motion.span>
            <motion.span {...up(0.4)} style={{ display: "block" }}><Rotor /></motion.span>
          </h1>
          <motion.p className="jp-sub" lang="ja" {...up(0.55)}>すべての乗客が、理解される旅を。</motion.p>
          <motion.p className="lede" {...up(0.68)}>Auralink helps passengers and cabin crew understand each other across languages and accents in
            <strong> real time</strong>. When speech is unclear, it <strong>asks the passenger a simple question</strong> instead of guessing.</motion.p>
          <motion.div className="hero-cta" {...up(0.8)}>
            <a className="btn btn-call" href="#try"><Icon id="keyboard" />Try the engine</a>
            <a className="btn btn-ghost" href="#problem">See the problem<Icon id="arrow" /></a>
          </motion.div>
          <motion.ul className="hero-points" {...up(0.95)}>
            <li><Icon id="wifi_off" />Works offline in the cabin</li>
            <li><Icon id="qr" />No app to install</li>
            <li><Icon id="globe" />Hindi, Tamil, Thai, English, Hinglish</li>
          </motion.ul>
        </div>
      </motion.div>
      <span className="scroll-cue" aria-hidden="true" />
    </section>
  );
}

/* ---------- story: hear → check → deliver ---------- */
function Story() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  useEffect(() => {
    if (!playing) return;
    const id = setTimeout(() => setI((x) => (x + 1) % 3), i === 2 ? 4200 : 3400);
    return () => clearTimeout(id);
  }, [i, playing]);
  const stages = [
    <div className="st" key="hear">
      <div className="st-label"><Icon id="mic" />Passenger says</div>
      <div className="bars" aria-hidden="true">{Array.from({ length: 22 }, (_, k) => <i key={k} style={{ animationDelay: `${(k * 0.07) % 1}s` }} />)}</div>
      <p className="st-quote" lang="hi-Latn">“Madam, thoda <mark>wotter</mark> and <mark>kambal</mark>…”</p>
      <p className="st-asr"><span className="mono">Plain speech-to-text:</span> “thoda water and <s>camel</s>”</p>
    </div>,
    <div className="st" key="ask">
      <div className="st-label"><Icon id="question" />Auralink checks, in Hindi</div>
      <p className="st-q" lang="hi">क्या आपका मतलब यह था?</p>
      <div className="chips">
        <motion.span className="chip" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}><Icon id="water" /><span lang="hi">पानी</span><b>Water</b></motion.span>
        <motion.span className="chip" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}><Icon id="blanket" /><span lang="hi">कंबल</span><b>Blanket</b></motion.span>
      </div>
      <motion.div className="tap" initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: [0.8, 1.08, 1], opacity: 1 }} transition={{ delay: 1.1, duration: 0.6 }}><Icon id="hand" />हाँ · Yes</motion.div>
    </div>,
    <div className="st" key="crew">
      <div className="st-label"><Icon id="tablet" />Crew tablet, in Japanese</div>
      {[["water", "お水をご希望です"], ["blanket", "毛布をご希望です"]].map(([id, ja], k) => (
        <motion.div className="crew-card" key={id} initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + k * 0.18, ease }}>
          <Icon id={id} /><span lang="ja">{ja}</span><span className="pill ok">34K</span>
        </motion.div>
      ))}
      <motion.p className="st-reply" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.9 }}>
        <span lang="ja">ただいまお持ちいたします。</span> → <span lang="hi">अभी लेकर आ रहे हैं।</span></motion.p>
    </div>,
  ];
  return (
    <figure className="story" aria-label="Example: a passenger asks for water and a blanket">
      <div className="story-head"><span>SEAT 34K · HINDI · LARGE TEXT</span>
        <button onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause animation" : "Play animation"}><Icon id={playing ? "pause" : "play"} /></button></div>
      <div className="story-stage">
        <AnimatePresence mode="wait">
          <motion.div key={i} initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -14 }} transition={{ duration: 0.45, ease }} style={{ position: "absolute", inset: 0 }}>
            {stages[i]}
          </motion.div>
        </AnimatePresence>
      </div>
      <ol className="story-steps">{["Hear", "Check", "Deliver"].map((s, k) => (
        <li key={s} className={k <= i ? "on" : ""} onClick={() => { setI(k); setPlaying(false); }} style={{ cursor: "pointer" }}>{s}</li>))}</ol>
    </figure>
  );
}

/* ---------- try the real engine ---------- */
const INTENTS = ["water", "tea", "blanket", "pillow", "toilet", "meal", "medical", "call_crew"];
const LABELS = { water: "Water", tea: "Tea or coffee", blanket: "Blanket", pillow: "Pillow", toilet: "Toilet", meal: "Food", medical: "I feel unwell", call_crew: "Call crew" };
const RULES = {
  confident: ["Confident", "ok", "Clear. The passenger confirms it with one tap."],
  split: ["Two requests", "ok", "Two requests in one sentence, so each gets its own card."],
  close: ["Asks to check", "call", "Two meanings are close, so Auralink asks with big pictures instead of guessing."],
  flat: ["Not sure", "call", "Auralink could not tell, so instead of guessing it shows the picture grid."],
  empty: ["Nothing yet", "call", "Type what a passenger might say."],
};
const EXAMPLES = [
  ["thoda wotter and kambal"], ["mujhe dawai chahiye"], ["Shochale kaha hai"], ["पानी और चाय", "hi"], ["konjam thanni venum", null, "Tamil"],
  ["ขอผ้าห่มกับหมอนหน่อยค่ะ", "th", "Thai"], ["ห้องน้ำอยู่ที่ไหน", "th", "Thai"], ["I have chest pain"], ["hmm sorry"],
];
const PHASES = [["boarding", "Boarding"], ["cruise", "Cruise"], ["meal", "Meal service"], ["post_meal", "After meal"], ["descent", "Descent"]];

function Lab() {
  const [text, setText] = useState("thoda wotter and kambal");
  const [phase, setPhase] = useState("cruise");
  const [out, setOut] = useState(null);
  const seq = useRef(0);
  async function run(t = text, p = phase) {
    const mine = ++seq.current;
    if (!t.trim()) { setOut({ r: { rule: "empty", cards: [], urgent: false }, ms: 0 }); return; }
    const t0 = performance.now();
    try {
      const res = await fetch("/api/interpret", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: t.trim(), phase: p, lang: "en" }) });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (mine === seq.current) setOut({ r: data, ms: (data.latency_ms?.match ?? performance.now() - t0).toFixed(1) });
    } catch { if (mine === seq.current) setOut({ offline: true }); }
  }
  useEffect(() => { run(); }, []); // eslint-disable-line
  useEffect(() => { const id = setTimeout(() => run(), 320); return () => clearTimeout(id); }, [text]); // eslint-disable-line
  const r = out?.r;
  const [name, tone, why] = r ? (r.urgent ? ["Urgent", "bad", "Sounds like a medical problem, so it skips the queue."] : RULES[r.rule] || RULES.flat) : [];
  return (
    <Reveal className="lab">
      <form className="lab-input" onSubmit={(e) => { e.preventDefault(); run(); }}>
        <label htmlFor="tryText" className="sr-only">Passenger request</label>
        <input id="tryText" autoComplete="off" maxLength={200} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-call" type="submit">Understand<Icon id="arrow" /></button>
      </form>
      <div className="lab-examples" role="group" aria-label="Examples">
        {EXAMPLES.map(([ex, lang, tag]) => <button key={ex} lang={lang || undefined} onClick={() => { setText(ex); run(ex); }}>{ex}{tag ? <small lang="en">{tag}</small> : null}</button>)}
      </div>
      <div className="lab-phase" role="radiogroup" aria-label="Flight phase">
        <span>Flight phase</span>
        {PHASES.map(([id, label]) => <button key={id} role="radio" aria-checked={phase === id} onClick={() => { setPhase(id); run(text, id); }}>{label}</button>)}
      </div>
      <div className="lab-out" aria-live="polite">
        {out?.offline ? <p className="lab-offline">The live engine runs on the Auralink hub. Start it with <span className="mono">scripts/run.sh</span> and open this page from the hub to try it.</p> : null}
        {r ? (<>
          <div className="verdict"><span className={`pill ${tone}`}>{name}</span><span className="verdict-text">{why}</span><span className="mono faint" style={{ fontSize: 12 }}>matched in {out.ms} ms</span></div>
          {r.urgent ? <motion.div className="urgent-bar" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}><Icon id="alert" />Urgent: the crew are alerted now, while the passenger confirms.</motion.div> : null}
          {r.cards.length ? (
            <div className="rcards">
              {r.cards.map((c, n) => {
                const top = c.candidates[0];
                return (
                  <motion.article key={`${text}-${n}`} className={`rcard ${c.urgent ? "is-urgent" : ""}`} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: n * 0.08, ease }}>
                    <div className="rcard-head"><Icon id={top.intent} /><div><div className="rcard-title">{top.label}</div><div className="rcard-ja" lang="ja">{c.crew_ja}</div></div>
                      {c.urgent ? <span className="pill bad">Urgent</span> : c.status === "close" ? <span className="pill call">Check</span> : <span className="pill ok">Clear</span>}</div>
                    {c.candidates.map((x, k) => (
                      <div key={x.intent + k} className={`cand ${k === 0 ? "top" : ""}`}><span>{LABELS[x.intent] || x.intent}</span>
                        <span className="cand-bar"><motion.i initial={{ width: 0 }} animate={{ width: `${Math.min(100, x.score * 100).toFixed(0)}%` }} transition={{ duration: 0.8, delay: 0.1 + k * 0.05, ease }} /></span>
                        <span className="cand-score">{x.score.toFixed(2)}</span></div>
                    ))}
                    <div className="rcard-why">heard “{top.heard}” ≈ “{top.matched}”</div>
                  </motion.article>
                );
              })}
            </div>
          ) : r.rule === "flat" ? (
            <div className="grid-fallback">{INTENTS.map((id) => <span key={id}><Icon id={id} />{LABELS[id]}</span>)}</div>
          ) : null}
        </>) : null}
      </div>
    </Reveal>
  );
}

/* ---------- safety heat map ---------- */
function SafetyMap() {
  const letters = [..."ABCDEGHJK"], rows = [30, 31, 32, 33, 34, 35];
  const NEEDS = new Set(["32E", "34K"]), NO = new Set(["33A"]);
  const ids = useMemo(() => rows.flatMap((r) => letters.map((l) => `${r}${l}`)), []); // eslint-disable-line
  const [state, setState] = useState({});
  const [ok, setOk] = useState(0);
  const timers = useRef([]);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  function play() {
    timers.current.forEach(clearTimeout); timers.current = [];
    setState({}); setOk(0);
    const order = [...ids].sort(() => Math.random() - 0.5);
    order.forEach((id, k) => {
      if (NO.has(id)) return;
      timers.current.push(setTimeout(() => {
        setState((s) => ({ ...s, [id]: NEEDS.has(id) ? "bad" : "ok" }));
        if (!NEEDS.has(id)) setOk((n) => n + 1);
      }, 300 + k * 60));
    });
  }
  useEffect(() => { if (inView) play(); }, [inView]); // eslint-disable-line
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  return (
    <>
      <figure className="cabin" ref={ref} aria-label="Cabin seat map: most seats turn green as passengers confirm, two stay red">
        <div className="cabin-top"><span>TURBULENCE BRIEFING</span><span><b>{ok}</b> / {ids.length} understood</span></div>
        <div className="seatmap">
          {rows.map((r) => [
            <span key={`r${r}`} className="faint">{r}</span>,
            ...letters.flatMap((l, k) => {
              const id = `${r}${l}`;
              const seat = <motion.span key={id} className={`seat ${state[id] || ""}`} title={id} animate={state[id] ? { scale: [1, 1.2, 1] } : {}} transition={{ duration: 0.35 }}>{l}</motion.span>;
              return k === 3 || k === 6 ? [<span key={`g${id}`} />, seat] : [seat];
            }),
          ])}
        </div>
        <figcaption>ROWS 30–35 · 3-3-3 LAYOUT</figcaption>
      </figure>
      <button className="btn btn-ghost" onClick={play} style={{ marginTop: 18 }}><Icon id="replay" />Replay</button>
    </>
  );
}

/* ---------- count-up ---------- */
function CountUp({ to, dec = 0, prefix = "", suffix = "" }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.6 });
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!inView) return;
    const c = animate(0, to, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: setV });
    return () => c.stop();
  }, [inView, to]);
  return <b ref={ref}>{prefix}{v.toFixed(dec)}{suffix}</b>;
}

function Compare() {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const rows = [["Baseline: first guess, keywords", 56.1, false], ["Auralink, hybrid matcher", 91.2, true]];
  return (
    <Reveal className="compare">
      <h3>First-try accuracy, same 65 accented and code-mixed requests</h3>
      <div ref={ref} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {rows.map(([label, v, ours]) => (
          <div key={label} className={`cmp-row ${ours ? "ours" : ""}`}>
            <span className="lab">{label}</span>
            <span className="cmp-bar"><motion.i initial={{ width: 0 }} animate={inView ? { width: `${v}%` } : {}} transition={{ duration: 1.3, delay: ours ? 0.25 : 0, ease }} /></span>
            <span className="v">{v}%</span>
          </div>
        ))}
      </div>
      <p className="note" style={{ margin: 0 }}>A development benchmark the matcher was tuned on, so it is optimistic; wrong confident cards: 0% for both. Final claims come from held-out volunteer recordings.</p>
    </Reveal>
  );
}

function Spot({ children, className = "", delay = 0 }) {
  const [pos, setPos] = useState({ x: -400, y: -400 });
  return (
    <Reveal className={`btile ${className}`} delay={delay}
      onPointerMove={(e) => { const b = e.currentTarget.getBoundingClientRect(); setPos({ x: e.clientX - b.left, y: e.clientY - b.top }); }}>
      <span className="spot" style={{ left: pos.x, top: pos.y }} />
      {children}
    </Reveal>
  );
}

function HubStatus() {
  const [s, setS] = useState(null);
  useEffect(() => {
    fetch("/api/config").then((r) => (r.ok ? r.json() : Promise.reject())).then((c) => setS({ on: true, text: `Hub online · ${c.seats.length} seats · ${c.intents.length} request types` }))
      .catch(() => setS({ on: false, text: "Hub offline. Run scripts/run.sh to use the live screens." }));
  }, []);
  return <span className={`status ${s ? (s.on ? "on" : "off") : ""}`}><i /><span>{s ? s.text : "Checking the hub…"}</span></span>;
}

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 24);
    addEventListener("scroll", on, { passive: true }); on();
    return () => removeEventListener("scroll", on);
  }, []);
  return (
    <>
      <div className="ambient" aria-hidden="true" /><div className="grain" aria-hidden="true" /><Sakura count={24} />
      <a className="skip" href="#main">Skip to content</a>
      <header className={`nav ${scrolled ? "scrolled" : ""}`}>
        <div className="wrap nav-inner">
          <a className="brand" href="#top" aria-label="Auralink home"><BrandMark /><span>Auralink</span></a>
          <nav aria-label="Sections">
            <a href="#problem">Problem</a><a href="#solution">How it works</a><a href="#try">Try it</a><a href="#safety">Safety</a><a href="#proof">Results</a>
          </nav>
          <a className="btn btn-outline-call" href="/start">Start the demo<Icon id="arrow" /></a>
        </div>
      </header>

      <main id="main">
        <Hero />

        <section className="section" id="problem">
          <div className="wrap">
            <div className="problem-top">
              <div>
                <Reveal as="p" className="eyebrow">The problem</Reveal>
                <Reveal as="h2" delay={0.05}>When speech fails at 35,000 feet, nothing repairs it.</Reveal>
              </div>
              <Reveal className="persona" delay={0.15}>
                <div className="ring" aria-hidden="true">72</div>
                <p>Mrs. Sharma, 72, is flying Delhi to Tokyo to see her son. She speaks soft Hinglish. The cabin is loud.
                  She asks for <em>“thoda wotter and kambal”</em>. The crew member asks her to repeat, then guesses.
                  After the second try she stops asking. Later a safety announcement plays in fast English. She nods.
                  Nobody knows she did not understand.</p>
              </Reveal>
            </div>
            <div className="fails">
              {[["wave", "The machine guesses once", "Speech-to-text takes its first guess as final, even when it is unsure. “Kambal” becomes “camel”, and the request is lost."],
                ["ear", "“Please repeat” is the only fix", "Saying it again, louder, is hardest for seniors, soft speakers and anyone with hearing or speech difficulty."],
                ["alert", "A nod is not understanding", "Crew cannot tell which passengers actually understood a safety instruction, so they repeat it to everyone."]].map(([ic, h, p], k) => (
                <Reveal as="article" className="fail" key={h} delay={k * 0.1}><span className="n">0{k + 1}</span><Icon id={ic} /><h3>{h}</h3><p>{p}</p></Reveal>
              ))}
            </div>
            <Reveal as="p" className="reframe">The real gap is <strong>repair</strong>: when meaning is lost, in either direction, nothing brings it back.</Reveal>
          </div>
        </section>

        <Divider />

        <section className="section" id="onboard">
          <div className="wrap story-grid">
            <div>
              <Reveal as="p" className="eyebrow">On board</Reveal>
              <Reveal as="h2" delay={0.05}>Hear. Check. Deliver.</Reveal>
              <Reveal as="p" className="sub" delay={0.1}>A passenger scans the seat QR and speaks. Auralink matches what it heard by <strong>how it sounds</strong>,
                checks with her in Hindi, and the crew get one clear card in polite Japanese. The reply comes back in her language.</Reveal>
            </div>
            <Reveal delay={0.15}><Story /></Reveal>
          </div>
        </section>

        <Divider />

        <section className="section" id="solution">
          <div className="wrap">
            <Reveal as="p" className="eyebrow">How Auralink fixes it</Reveal>
            <Reveal as="h2" delay={0.05}>Ask, don’t guess. Then make sure everyone understood.</Reveal>
            <ol className="flow">
              <motion.span className="flow-line" initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease }} />
              {[["mic", "Say it any way", <>Speak, tap a picture or type, in Hindi, Tamil, Thai, English or a mix. Scan the seat QR code; there is nothing to install.</>],
                ["wave", "Listen for meaning", <>Auralink compares what it heard with words people really use on board, like <em>paani</em>, <em>kambal</em> and <em>dawai</em>, and considers the moment, for example meal time.</>],
                ["question", "Ask the easiest question", <>If it is not sure, it shows two big pictures to choose from. If it is still unsure, the crew get a “please help” card with its best guesses.</>, true],
                ["tablet", "One clear card for crew", <>The crew see the request in polite Japanese and reply with one tap. The passenger reads the reply in their own language.</>]].map(([ic, h, p, call], k) => (
                <Reveal as="li" key={h} delay={k * 0.1}><div className={`ficon ${call ? "call" : ""}`}><Icon id={ic} /></div><h3>{h}</h3><p>{p}</p></Reveal>
              ))}
            </ol>
            <Reveal className="urgent-note"><Icon id="alert" /><p><strong>Urgent requests skip the queue.</strong> If it sounds like a medical problem, the crew are alerted straight away while the passenger confirms.</p></Reveal>
          </div>
        </section>

        <Divider />

        <section className="section" id="try">
          <div className="wrap">
            <Reveal as="p" className="eyebrow">Try the real engine</Reveal>
            <Reveal as="h2" delay={0.05}>Type a request the way a passenger might say it.</Reveal>
            <Reveal as="p" className="sub" delay={0.1}>This box sends your text to the same matcher the cabin hub uses. Nothing reaches any crew.</Reveal>
            <Lab />
          </div>
        </section>

        <Divider />

        <section className="section" id="safety">
          <div className="wrap safety-grid">
            <div>
              <Reveal as="p" className="eyebrow">The other direction</Reveal>
              <Reveal as="h2" delay={0.05}>Know who understood the safety briefing.</Reveal>
              <Reveal as="p" className="sub" delay={0.1}>The crew send a pre-approved message. Each passenger sees pictures and a caption in their own
                language, then taps <strong>I understood</strong> or <strong>Explain again</strong>.</Reveal>
              <ul className="legend">
                <li><i className="sw" style={{ background: "var(--ok)" }} />Understood</li>
                <li><i className="sw" style={{ background: "var(--idle)" }} />No answer yet</li>
                <li><i className="sw" style={{ background: "var(--bad)" }} />Asked to explain again</li>
              </ul>
              <Reveal as="p" className="sub" delay={0.1}>Instead of repeating the announcement to 54 people, the crew walk to the few seats that need help.
                At boarding, exit-row passengers get a picture check too, supporting the crew’s own confirmation.</Reveal>
            </div>
            <Reveal delay={0.1}><SafetyMap /></Reveal>
          </div>
        </section>

        <Divider />

        <section className="section" id="cabin">
          <div className="wrap">
            <Reveal as="p" className="eyebrow">Built for a real cabin</Reveal>
            <Reveal as="h2" delay={0.05}>Simple for crew. Reliable at altitude.</Reveal>
            <div className="bento">
              <Spot className="wide"><Icon id="wifi_off" /><h3>No internet needed</h3><p>A laptop-sized hub on board runs the speech engine. Phones connect over the cabin network. If the hub fails, crew simply carry on as they do today.</p></Spot>
              <Spot delay={0.05}><Icon id="qr" /><h3>Scan and speak</h3><p>The seat QR code opens Auralink in the browser, already set to that seat.</p></Spot>
              <Spot delay={0.1}><Icon id="globe" /><h3>New language? Add words</h3><p>Languages are word lists in a file. No retraining: Tamil and Thai were added this way.</p></Spot>
              <Spot><Icon id="bell" /><h3>One tap for crew</h3><p>A card, an Acknowledge button and polite replies in Japanese.</p></Spot>
              <Spot delay={0.05}><Icon id="hand" /><h3>No phone? No problem</h3><p>A tactile seat panel with four raised buttons, or the in-seat screen, does the same job.</p></Spot>
              <Spot className="wide" delay={0.1}><Icon id="shield" /><h3>Dignity and privacy first</h3><p>Large text for seniors, a picture-only mode for hearing or speech difficulty, gentle wording like “Let’s find it together”, and speech used only for the request, never stored.</p></Spot>
            </div>
          </div>
        </section>

        <Divider />

        <section className="section" id="proof">
          <div className="wrap">
            <Reveal as="p" className="eyebrow">Measured, not promised</Reveal>
            <Reveal as="h2" delay={0.05}>Our first numbers, on a laptop CPU.</Reveal>
            <div className="stats">
              <Reveal className="stat"><CountUp to={0.67} dec={2} suffix=" s" /><span>speech to text, English and Hindi at once</span></Reveal>
              <Reveal className="stat" delay={0.08}><CountUp to={1.0} dec={1} prefix="≈ " suffix=" s" /><span>from the end of speech to the confirm screen (target under 2 s)</span></Reveal>
              <Reveal className="stat" delay={0.16}><CountUp to={88} suffix="%" /><span>of requests understood on synthetic test voices with cabin-like noise</span></Reveal>
            </div>
            <Compare />
            <Reveal as="p" className="note">The 88% comes from computer-generated Indian English and Hindi voices, so treat it as a smoke test.
              We are recording real volunteers, including seniors, to measure accuracy, wrong-action rate and recovery properly.</Reveal>
          </div>
        </section>

        <Divider />

        <section className="section launch" id="launch">
          <div className="wrap">
            <Reveal as="p" className="eyebrow">Live demo</Reveal>
            <Reveal as="h2" delay={0.05}>Open the cabin.</Reveal>
            <p className="sub"><HubStatus /></p>
            <p className="sub">First time? <a href="/start"><b>Start here</b></a>: who uses which screen, the seat QR code, the crew PIN, and how it works with no internet.</p>
            <div className="launch-grid">
              {[["/passenger?seat=34K", "mic", "Passenger", "Seat 34K. Speak, tap or type a request."],
                ["/crew", "tablet", "Crew tablet", "Request cards, replies and the safety heat map."],
                ["/judge", "wave", "Under the hood", "Every guess, score and decision, live."],
                ["/record", "check", "Record voices", "Help us test with your own accent."]].map(([href, ic, h, p], k) => (
                <Reveal as="a" className="launch-card" href={href} key={href} delay={k * 0.07}><Icon id={ic} /><h3>{h}</h3><p>{p}</p><span className="go">Open<Icon id="arrow" /></span></Reveal>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap foot-inner">
          <div><a className="brand" href="#top"><BrandMark /><span>Auralink</span></a>
            <p>Auralink does not just hear passengers. It makes sure they are understood, and that they understand.</p></div>
          <p className="foot-small">Thapar Japan Hackathon 2026 · Problem statement JAL-PS-02. A prototype communication aid, not a certified safety system.
            Built with Whisper, Silero VAD, eSpeak NG, FastAPI, Next.js and open fonts (OFL). Quality depends on speech recognition; extreme noise or rare speech may still need crew judgement.</p>
        </div>
        <div className="wrap foot-legal">
          <p className="foot-copy">© 2026 The Auralink team · Code released under the <a href="https://github.com/goyalnishtha841/auralink/blob/main/LICENSE">MIT License</a></p>
          <p>Student prototype. Not affiliated with, endorsed by or sponsored by Japan Airlines; “JAL” and “Japan Airlines” are trademarks of their owner, used here only to name the hackathon problem statement.</p>
          <p>Third-party components keep their own licences: Whisper, faster-whisper, Silero VAD, FastAPI, Next.js, React and Framer Motion: MIT · eSpeak NG: GPL-3.0 · fonts: SIL OFL 1.1.</p>
        </div>
      </footer>
    </>
  );
}
