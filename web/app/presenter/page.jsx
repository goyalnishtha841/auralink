"use client";
import "../tools.css";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { crewFetch, loadConfig, postJson } from "@/lib/hub";
import { Ambient, AppHeader } from "@/components/ui";

// the pitch as a checklist (seconds from the start)
const STEPS = [
  [0, "Mrs. Sharma's story", "Landing page hero. Start the cabin noise."],
  [40, "The problem", "Nothing repairs a misheard request; nobody checks understanding."],
  [70, "She scans and speaks", "Passenger phone, with noise playing.", "say-wotter"],
  [110, "Crew card and reply", "Crew tablet: Japanese card, one-tap reply, Hindi answer."],
  [130, "Under the hood", "Guesses, fillers, sound alignment, score above t1."],
  [170, "Urgent", "\"I have chest pain\": red alarm before she confirms.", "say-pain"],
  [190, "Turbulence briefing", "Explain again, Still not clear, red seat with the step.", "brief-turbulence"],
  [220, "Unplug the internet", "Everything keeps working."],
  [240, "Results", "First-try accuracy vs baseline; real-voice test in progress."],
  [270, "Close", "Add a language by data. Invite a judge to try it."],
];
const LIMIT = 300;
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function Presenter() {
  const [cfg, setCfg] = useState(null);
  const [now, setNow] = useState(0);
  const [running, setRunning] = useState(false);
  const [health, setHealth] = useState(null);
  const [toast, setToast] = useState("");
  const [armed, setArmed] = useState(false);
  const [seat, setSeat] = useState("34K");
  const [text, setText] = useState("");
  const clock = useRef({ started: 0, elapsed: 0 });
  const armTimer = useRef(0);

  async function refresh() {
    try {
      const s = await (await crewFetch("/api/status")).json();
      setHealth([
        ["Hub", "online", "ok"],
        ["Speech-to-text", s.speech_model ? `Whisper ${s.speech_model} ready` : "loads on first voice request", s.speech_model ? "ok" : "warn"],
        ["Matcher", s.matcher, s.matcher === "hybrid" ? "ok" : "warn"],
        ["Passenger screens", s.seats_connected.length ? s.seats_connected.join(", ") : "none", s.seats_connected.length ? "ok" : "warn"],
        ["Crew tablets", String(s.crew_screens), s.crew_screens ? "ok" : "bad"],
        ["Under the hood", String(s.judge_screens), s.judge_screens ? "ok" : "warn"],
        ["Open requests", String(s.open_requests), ""],
        ["Urgent waiting", String(s.urgent_open), s.urgent_open ? "bad" : "ok"],
        ["Phase / briefing", `${s.phase}${s.briefing ? ` · ${s.briefing}` : ""}`, ""],
        ...(s.restored_from ? [["Crash recovery", `restored state from ${new Date(s.restored_from * 1000).toLocaleTimeString()}`, "warn"]] : []),
      ]);
    } catch { setHealth(false); }
  }
  useEffect(() => {
    loadConfig().then(setCfg);
    refresh();
    const h = setInterval(refresh, 2000);
    const c = setInterval(() => { const k = clock.current; setNow(k.started ? k.elapsed + (Date.now() - k.started) / 1000 : k.elapsed); }, 250);
    return () => { clearInterval(h); clearInterval(c); };
  }, []);

  async function say(s, t) {
    try { const r = await postJson("/api/presenter/say", { seat: s, text: t }, { crew: true });
      setToast(`Sent “${t}” from ${s}.${r.seat_has_screen ? "" : ` No passenger screen is open for ${s}, so only the crew and Under the hood will show it.`}`);
    } catch (e) { setToast(e.message); }
    refresh();
  }
  async function crew(msg) {
    try { await postJson("/api/presenter/crew", msg, { crew: true }); setToast(`Done: ${msg.type}${msg.template_id ? ` (${msg.template_id})` : ""}.`); }
    catch (e) { setToast(e.message); }
    refresh();
  }
  const ACTIONS = {
    "say-wotter": ["34K says “thoda wotter and kambal”", "Two cards, confirm in Hindi", () => say("34K", "thoda wotter and kambal")],
    "say-pain": ["34K says “I have chest pain”", "Urgent alarm on the crew tablet", () => say("34K", "I have chest pain"), "urgent"],
    "say-toilet": ["30A says “Shawchale kaha hai”", "Accent match, good for Under the hood", () => say("30A", "Shawchale kaha hai")],
    "say-tamil": ["35A says “konjam thanni venum”", "Tamil request (open 35A in Tamil first)", () => say("35A", "konjam thanni venum")],
    "say-unsure": ["34K says “hmm”", "Not sure: picture grid instead of guessing", () => say("34K", "hmm")],
    "brief-turbulence": ["Send turbulence briefing", "Pictures on every passenger screen", () => crew({ type: "broadcast", template_id: "turbulence" })],
    "exit-check": ["Start exit-row check", "Row 30 gets three picture questions", () => crew({ type: "exit_check" })],
    "phase-meal": ["Set phase: meal service", "Food requests get a small boost", () => crew({ type: "phase", phase: "meal" })],
  };
  function toggle() {
    const k = clock.current;
    if (k.started) { k.elapsed += (Date.now() - k.started) / 1000; k.started = 0; setRunning(false); }
    else { k.started = Date.now(); setRunning(true); }
  }
  async function reset() {
    if (!armed) { setArmed(true); armTimer.current = setTimeout(() => setArmed(false), 4000); return; }
    clearTimeout(armTimer.current); setArmed(false);
    try { await postJson("/api/presenter/reset", {}, { crew: true }); setToast("Cabin reset."); } catch (e) { setToast(e.message); }
    refresh();
  }
  const idx = STEPS.findLastIndex(([at]) => now >= at);

  return (
    <>
      <Ambient />
      <AppHeader online={health !== false && !!health} title="Presenter console" sub="keep this on your laptop, not the projector" />
      <main className="app" style={{ maxWidth: 1260 }}>
        <div className="p-layout">
          <div className="p-col">
            <section className="panel">
              <div className="row"><span className={`p-clock grow ${now > LIMIT ? "over" : now > LIMIT - 30 ? "late" : ""}`}>{fmt(now)}</span>
                <button className="primary" onClick={toggle}>{running ? "Pause" : "Start"}</button>
                <button onClick={() => { clock.current = { started: 0, elapsed: 0 }; setRunning(false); setNow(0); }}>Reset timer</button></div>
              <div className="r-progress"><div style={{ width: `${Math.min(100, (now / LIMIT) * 100)}%` }} /></div>
              <ol className="p-steps">{STEPS.map(([at, title, hint, action], i) => (
                <motion.li key={title} layout className={i === idx ? "now" : i < idx ? "done" : ""}>
                  <span className="t">{fmt(at)}</span><span className="what"><b>{title}</b><span>{hint}</span></span>
                  {action ? <button onClick={ACTIONS[action][2]}>Backup</button> : <span />}
                </motion.li>))}</ol>
            </section>
          </div>
          <div className="p-col">
            <section className="panel"><h2>Health</h2>
              <div className="p-health">{health ? health.map(([k, v, tone]) => <div key={k} className={`p-h ${tone}`}><span>{k}</span><b>{v}</b></div>)
                : health === false ? <div className="p-h bad"><span>Hub</span><b>offline</b></div> : null}</div></section>
            <section className="panel"><h2>Backup buttons</h2>
              <p className="muted" style={{ margin: 0 }}>If a phone or the microphone fails, send the request from here. Screens react exactly as if it was live.</p>
              <div className="p-actions">{Object.entries(ACTIONS).map(([id, [label, sub, fn, cls]]) => <button key={id} className={cls || ""} onClick={fn}><span>{label}</span><small>{sub}</small></button>)}</div>
              <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) say(seat, text.trim()); }}>
                <select value={seat} onChange={(e) => setSeat(e.target.value)} aria-label="Seat">{(cfg?.seats || ["34K"]).map((x) => <option key={x}>{x}</option>)}</select>
                <input className="grow" placeholder="Any request, e.g. pani aur takiya" value={text} onChange={(e) => setText(e.target.value)} aria-label="Request text" />
                <button type="submit">Send as passenger</button>
              </form>
              <p className="muted" role="status" style={{ minHeight: 20, margin: 0 }}>{toast}</p>
            </section>
            <section className="panel"><h2>Between rehearsals</h2>
              <div className="row"><button className="danger" onClick={reset}>{armed ? "Tap again to reset" : "Reset cabin"}</button>
                <span className="muted grow">{armed ? "This clears everything on the crew tablet." : "Clears all requests, briefings and exit checks. Phones stay connected."}</span></div></section>
            <section className="panel"><h2>Open screens</h2>
              <div className="t-links">{[["/passenger.html?seat=34K&lang=hi", "Passenger 34K (Hindi)"], ["/crew.html", "Crew tablet"], ["/judge.html", "Under the hood"], ["/noise.html", "Cabin noise"],
                ["/seats.html", "Seat cards"], ["/report.html", "Flight report"], ["/phone-setup.html", "Phone setup"], ["/checkin.html", "Check-in (airport)"]].map(([h, l]) =>
                <a key={h} href={h} target="_blank" rel="noopener"><button>{l}</button></a>)}</div></section>
          </div>
        </div>
      </main>
    </>
  );
}
