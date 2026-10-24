"use client";
import "../tools.css";
import { useEffect, useState } from "react";
import { loadConfig } from "@/lib/hub";
import { Ambient, AppHeader } from "@/components/ui";

export default function Seats() {
  const [cfg, setCfg] = useState(null);
  const [rows, setRows] = useState("demo");
  const [base, setBase] = useState("");
  useEffect(() => {
    Promise.all([loadConfig(), fetch("/api/hub-info").then((r) => r.json())]).then(([c, i]) => { setCfg(c); setBase(i.public_url); });
  }, []);
  if (!cfg) return <Ambient />;
  const exit = new Set(cfg.exit_seats);
  const seats = rows === "exit" ? cfg.exit_seats : rows === "all" ? cfg.seats : ["34K", "30A", "31C"];
  const b = base.trim().replace(/\/$/, "");
  return (
    <>
      <Ambient />
      <AppHeader online title="Seat QR cards" sub="print and stick on the demo seat" />
      <main className="app">
        <section className="panel no-print">
          <div className="row" style={{ alignItems: "flex-end" }}>
            <label className="r-field">Which seats<select value={rows} onChange={(e) => setRows(e.target.value)}>
              <option value="demo">Demo seats (34K, 30A, 31C)</option><option value="exit">Exit row only</option><option value="all">All 54 seats</option></select></label>
            <label className="r-field">Phones open<input size={34} spellCheck={false} value={base} onChange={(e) => setBase(e.target.value)} /></label>
            <button className="primary" onClick={() => print()}>Print cards</button>
          </div>
          {b.startsWith("https://") ? <div style={{ color: "var(--ok)" }}>Phones will open {b}/passenger.html?seat=…</div>
            : <div className="notice">This address is http, not https. Phones will open the page but block the microphone; typing and pictures still work. For voice, set up HTTPS (mkcert) and restart the hub.</div>}
        </section>
        <section className="panel"><div className="s-grid">{seats.map((seat) => {
          const url = `${b}/passenger.html?seat=${seat}`;
          return (
            <article key={seat} className={`seatcard ${exit.has(seat) ? "exit" : ""}`}>
              <div>
                <div className="no">{seat}</div>
                {exit.has(seat) ? <span className="exit-tag">EXIT ROW · 非常口座席</span> : null}
                <div className="lines"><span lang="en">Scan to ask the crew</span><span lang="hi">क्रू से मदद माँगने के लिए स्कैन करें</span><span lang="ja">スキャンして乗務員にご依頼ください</span></div>
              </div>
              <img src={`/api/qr?data=${encodeURIComponent(url)}`} alt={`QR code for seat ${seat}`} />
              <div className="foot">
                <span className="sbrand"><svg viewBox="0 0 40 26" width="22" height="14" fill="none" strokeLinecap="round"><path d="M3 18 C7 4, 11 4, 14 13 S 21 22, 24 11 S 32 2, 37 18" stroke="#ff5b5b" strokeWidth="3" /><path d="M3 23 H37" stroke="#0c0c0c" strokeWidth="2" /></svg>Auralink</span>
                <span>cabin Wi-Fi · no app · no internet</span>
              </div>
            </article>);
        })}</div></section>
      </main>
    </>
  );
}
