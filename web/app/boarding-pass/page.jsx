"use client";
// Demo tool: nobody at a hackathon has a real JAL boarding pass to test with, so this stands in
// for the airline's own departure-control system -- type a name and a seat, get back a real IATA
// BCBP barcode (hub/bcbp.py) to scan with the passenger seat gate's "Scan boarding pass" button.
import "../tools.css";
import { useEffect, useState } from "react";
import { loadConfig } from "@/lib/hub";
import { Ambient, AppHeader } from "@/components/ui";

export default function BoardingPassDemo() {
  const [cfg, setCfg] = useState(null);
  const [name, setName] = useState("Yuki Tanaka");
  const [seat, setSeat] = useState("34K");
  const [bp, setBp] = useState(null);   // {text} | {error}
  const [busy, setBusy] = useState(false);

  useEffect(() => { loadConfig().then((c) => { setCfg(c); setSeat(c.seats[0]); }); }, []);

  async function generate(e) {
    e?.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/boarding-pass/demo?${new URLSearchParams({ name, seat })}`);
      const r = await res.json();
      setBp(res.ok ? r : { error: r.detail || "Couldn't generate a boarding pass" });
    } catch { setBp({ error: "Hub unreachable" }); }
    setBusy(false);
  }

  if (!cfg) return <Ambient />;
  return (
    <>
      <Ambient />
      <AppHeader online title="Boarding pass simulator" sub="issue a test pass to scan on a phone" />
      <main className="app">
        <section className="panel no-print">
          <p className="muted" style={{ margin: 0 }}>
            Stands in for the airline's departure-control system, since nobody here has a real
            boarding pass for this flight. The QR below encodes a real IATA BCBP barcode string —
            the same format every airline already prints — so it scans with Auralink's
            <b> Scan boarding pass</b> button the same way a genuine one would.
          </p>
          <form className="row" style={{ alignItems: "flex-end" }} onSubmit={generate}>
            <label className="r-field">Passenger name
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First Last" required /></label>
            <label className="r-field">Seat
              <select value={seat} onChange={(e) => setSeat(e.target.value)}>
                {cfg.seats.map((s) => <option key={s} value={s}>{s}</option>)}
              </select></label>
            <button className="primary" type="submit" disabled={busy}>{busy ? "…" : "Issue boarding pass"}</button>
          </form>
        </section>

        {bp?.error ? <section className="panel"><p style={{ margin: 0, color: "var(--bad)" }}>{bp.error}</p></section> : null}

        {bp?.text ? (
          <section className="panel" style={{ alignItems: "center", textAlign: "center" }}>
            <img src={`/api/qr?data=${encodeURIComponent(bp.text)}`} alt={`Boarding pass barcode for ${name}, seat ${seat}`}
              style={{ width: 260, height: 260, background: "#fff", padding: 12, borderRadius: 12 }} />
            <p style={{ margin: 0 }}><b>{name}</b> · Seat {seat}</p>
            <p className="muted mono" style={{ fontSize: 12, wordBreak: "break-all", maxWidth: 420 }}>{bp.text}</p>
            <p className="muted" style={{ margin: 0, maxWidth: 420 }}>
              Open <code>/passenger</code> on another phone (no <code>?seat=</code> in the URL), tap
              <b> Scan boarding pass</b>, and point its camera at this code.
            </p>
          </section>
        ) : null}
      </main>
    </>
  );
}
