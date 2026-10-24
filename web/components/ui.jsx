"use client";
// Shared building blocks: header, sheet (dialog), reveal-on-scroll, PIN dialog, brand mark.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";

export const ease = [0.2, 0.8, 0.2, 1];

// A horizontally-swipeable row of tiles instead of dumping every option on screen at once.
// Snaps one tile at a time (good for a thumb) and shows dots for how many more there are.
export function Carousel({ children, big = false, stacked = false, className = "" }) {
  const ref = useRef(null);
  const [index, setIndex] = useState(0);
  const count = Array.isArray(children) ? children.length : 1;
  const cols = stacked ? Math.ceil(count / 2) : count;   // stacked: 2 tiles per column, 1 dot per column

  function onScroll() {
    const el = ref.current;
    const card = el?.firstElementChild;
    if (!el || !card) return;
    const style = getComputedStyle(el);
    const step = card.getBoundingClientRect().width + parseFloat(style.columnGap || style.gap || "14");
    setIndex(Math.max(0, Math.min(cols - 1, Math.round(el.scrollLeft / step))));
  }
  function scrollTo(i) {
    const el = ref.current;
    const card = el?.children[stacked ? i * 2 : i];
    card?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
  }

  return (
    <div className="carousel-wrap">
      <div ref={ref} onScroll={onScroll} className={`grid carousel ${big ? "big" : ""} ${stacked ? "stacked" : ""} ${className}`}>
        {children}
      </div>
      {cols > 1 ? (
        <div className="carousel-dots" role="tablist" aria-label="More options, swipe to see">
          {Array.from({ length: cols }, (_, k) => (
            <button key={k} type="button" role="tab" aria-selected={k === index} aria-label={`Option ${k + 1} of ${cols}`}
              className={`dot-mini ${k === index ? "on" : ""}`} onClick={() => scrollTo(k)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function BrandMark({ size = 34 }) {
  return (
    <svg viewBox="0 0 40 26" width={size} height={(size * 26) / 40} aria-hidden="true" fill="none" strokeLinecap="round">
      <path d="M3 18 C7 4, 11 4, 14 13 S 21 22, 24 11 S 32 2, 37 18" stroke="var(--accent)" strokeWidth="2.6" />
      <path d="M3 23 H37" stroke="#f5f5f5" strokeWidth="1.6" opacity=".7" />
    </svg>
  );
}

export function Brand({ crumb }) {
  return (
    <a className="brand" href="/" aria-label="Auralink home">
      <BrandMark /><span>Auralink</span>
      {crumb ? <span className="mono faint" style={{ fontSize: 12, fontWeight: 400, letterSpacing: ".08em" }}>/ {crumb}</span> : null}
    </a>
  );
}

export function AppHeader({ online, title, sub, children, home = true }) {
  return (
    <header className="app-header">
      <span className={`dot ${online ? "on" : ""}`} title={online ? "Connected" : "Offline"} />
      <h1>{title}{sub ? <span className="muted">{sub}</span> : null}</h1>
      {children}
      {home ? <a href="/" aria-label="Home"><button type="button" className="hdr-icon-btn"><Icon id="home" /></button></a> : null}
    </header>
  );
}

export function Ambient() {
  return (<><div className="ambient" aria-hidden="true" /><div className="grain" aria-hidden="true" /><Sakura /></>);
}

// A few cherry-blossom petals drifting slowly behind every screen (桜). Behind the panels, so they
// only show in the gaps; very sparse and slow, so they never compete with the content.
// Turned off for prefers-reduced-motion.
export function Sakura({ count = 7 }) {
  const [petals, setPetals] = useState([]);
  useEffect(() => {
    setPetals(Array.from({ length: count }, (_, i) => ({
      key: i, left: `${Math.random() * 100}%`, s: `${6 + Math.random() * 6}px`,
      d: `${24 + Math.random() * 16}s`, delay: `${-Math.random() * 40}s`, sway: `${40 + Math.random() * 80}px`,
    })));
  }, [count]);
  return (
    <div className="sakura" aria-hidden="true">
      {petals.map((p) => <i key={p.key} style={{ left: p.left, "--s": p.s, "--d": p.d, "--delay": p.delay, "--sway": p.sway }} />)}
    </div>
  );
}

// Water ripple (波紋) where a button or link is tapped: a thin ring that spreads and fades.
// Fixed-position overlay, so it never changes any layout. Off for prefers-reduced-motion.
export function TapRipple() {
  const [rings, setRings] = useState([]);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let n = 0;
    const on = (e) => {
      if (!e.target.closest?.("button, a, [role=button], .tile")) return;
      const id = ++n;
      setRings((r) => [...r.slice(-4), { id, x: e.clientX, y: e.clientY }]);
      setTimeout(() => setRings((r) => r.filter((x) => x.id !== id)), 900);
    };
    addEventListener("pointerdown", on, { passive: true });
    return () => removeEventListener("pointerdown", on);
  }, []);
  return <>{rings.map((r) => <span key={r.id} className="hamon" style={{ left: r.x, top: r.y }} aria-hidden="true" />)}</>;
}

// Dialog that slides up softly. `content` null = closed. Always closable: a visible X, the
// backdrop, and Escape all work, so the passenger is never stuck on a screen with no way back.
export function Sheet({ content, big = false, onClose }) {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <AnimatePresence>
      {content ? (
        <motion.div className="overlay" key="ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }} onClick={(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
          <motion.div className={`sheet ${big ? "big" : ""}`} role="dialog" aria-modal="true"
            key={content.key || "sheet"} initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }} transition={{ duration: 0.38, ease }}>
            {onClose ? <button className="sheet-close" aria-label="Close" onClick={onClose}><Icon id="close" /></button> : null}
            {content}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Reveal({ children, delay = 0, y = 18, className = "", as = "div", ...rest }) {
  const M = motion[as];
  // margin expands the viewport downward, so content starts fading in before it's scrolled
  // to, instead of sitting blank while the page catches up to a fast scroll.
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px 20% 0px" }}
      transition={{ duration: 0.55, delay, ease }} {...rest}>
      {children}
    </M>
  );
}

// stagger children in a list
export const list = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
export const itemV = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } } };

// Crew PIN prompt. Opens when lib/hub.askCrewPin() fires (401 or socket close 4401).
export function PinDialog() {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [pin, setPin] = useState("");
  const input = useRef(null);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("auralink:pin", on);
    return () => window.removeEventListener("auralink:pin", on);
  }, []);
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 80); }, [open]);
  async function submit(e) {
    e.preventDefault();
    const res = await fetch("/api/crew/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin }) });
    if (res.ok) { location.reload(); return; }
    setErr((await res.json().catch(() => ({}))).detail || "PINが違います / Wrong PIN");
    input.current?.select();
  }
  return (
    <Sheet content={open ? (
      <form className="pin-form" onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <span className="mono" style={{ color: "var(--accent)", fontSize: 12, letterSpacing: ".14em" }}>CREW ONLY</span>
        <h2>乗務員PIN <span className="muted" style={{ fontWeight: 400 }}>· Crew PIN</span></h2>
        <p className="muted" style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>Passengers share the cabin Wi-Fi, so crew screens are locked.
          The 6-digit PIN is on <a href="/start" style={{ color: "var(--fg)" }}>the Start page</a> of the laptop running Auralink, or in its terminal.</p>
        <input ref={input} className="pin-input" type="password" inputMode="numeric" autoComplete="off" maxLength={32} required
          aria-label="乗務員PIN / Crew PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        <p role="alert" style={{ margin: 0, minHeight: "1.4em", color: "var(--bad)" }}>{err}</p>
        <button className="primary" type="submit" disabled={!pin}>入る / Enter</button>
      </form>
    ) : null} />
  );
}

// a coral frame that pulses (replaces a sound for passengers who may not hear)
export function useFlash() {
  const [n, setN] = useState(0);
  const frame = n ? <div key={n} className="flash-frame" aria-hidden="true" /> : null;
  return [frame, () => { setN((x) => x + 1); if (navigator.vibrate) navigator.vibrate([180, 90, 180]); }];
}
