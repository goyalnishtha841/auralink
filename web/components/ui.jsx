"use client";
// Shared building blocks: header, sheet (dialog), reveal-on-scroll, PIN dialog, brand mark.
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/lib/icons";

export const ease = [0.2, 0.8, 0.2, 1];

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
      {home ? <a href="/" aria-label="Home"><button className="ghost"><Icon id="home" /></button></a> : null}
    </header>
  );
}

export function Ambient() {
  return (<><div className="ambient" aria-hidden="true" /><div className="grain" aria-hidden="true" /></>);
}

// Dialog that slides up softly. `content` null = closed.
export function Sheet({ content, big = false, onBackdrop }) {
  return (
    <AnimatePresence>
      {content ? (
        <motion.div className="overlay" key="ov" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }} onClick={(e) => { if (e.target === e.currentTarget && onBackdrop) onBackdrop(); }}>
          <motion.div className={`sheet ${big ? "big" : ""}`} role="dialog" aria-modal="true"
            key={content.key || "sheet"} initial={{ opacity: 0, y: 28, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }} transition={{ duration: 0.38, ease }}>
            {content}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Reveal({ children, delay = 0, y = 26, className = "", as = "div", ...rest }) {
  const M = motion[as];
  return (
    <M className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "0px 0px -8% 0px" }}
      transition={{ duration: 0.8, delay, ease }} {...rest}>
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
          The 6-digit PIN is on <a href="/start.html" style={{ color: "var(--fg)" }}>the Start page</a> of the laptop running Auralink, or in its terminal.</p>
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
