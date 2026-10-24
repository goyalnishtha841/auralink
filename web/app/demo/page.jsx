"use client";
// The main screen for the demo: one QR, shown to the whole room (a monitor at the gate, a slide,
// a tablet propped on the seat). Scanning it sends a passenger to their seat screen and a crew
// member to the crew tablet (web/app/go) — the same code works for both, chosen after the scan,
// so there is nothing to explain before anyone has even opened their phone.
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Ambient, BrandMark, ease } from "@/components/ui";
import { Icon } from "@/lib/icons";

export default function Demo() {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    fetch("/api/hub-info").then((r) => r.json()).then((i) => setUrl(`${i.public_url}/go`)).catch(() => setUrl(`${location.origin}/go`));
  }, []);
  return (
    <>
      <Ambient />
      <main className="app" style={{ maxWidth: 920, minHeight: "100dvh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 36, textAlign: "center" }}>
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} transition={{ ease }} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}>
          <BrandMark size={56} />
          <h1 style={{ font: "800 40px/1.1 var(--display)", margin: 0 }}>Scan to talk to the cabin</h1>
          <p className="muted" style={{ margin: 0, fontSize: 17, maxWidth: 520 }}>
            Passengers and crew use the same code. Point your camera at it — no app, nothing to type.
          </p>
        </motion.div>

        <motion.div className="panel" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.1, ease }}
          style={{ padding: 28, display: "inline-flex" }}>
          {url ? <img className="qr" width={320} height={320} src={`/api/qr?data=${encodeURIComponent(url)}`} alt="QR code: scan to open Auralink" />
            : <div style={{ width: 320, height: 320, display: "grid", placeItems: "center" }} className="muted">Loading…</div>}
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.18, ease }}
          style={{ display: "flex", gap: 28, flexWrap: "wrap", justifyContent: "center" }}>
          <span className="row muted"><Icon id="person" /> Passenger → their seat screen, in their language</span>
          <span className="row muted"><Icon id="tablet" /> Crew → the crew tablet, PIN required</span>
        </motion.div>
        <p className="muted mono" style={{ fontSize: 12, margin: 0 }}>Runs on this laptop's own Wi-Fi. Nothing leaves the aircraft.</p>
      </main>
    </>
  );
}
