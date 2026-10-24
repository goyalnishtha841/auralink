"use client";
// The one QR code for the demo: scanning it lands here, and whoever's holding the phone picks
// their own role. Replaces making the audience read URLs off a slide — one code, two paths.
import "../tools.css";
import { motion } from "framer-motion";
import { Ambient, BrandMark, ease } from "@/components/ui";
import { Icon } from "@/lib/icons";

function tap() { if (navigator.vibrate) navigator.vibrate(30); }

export default function Go() {
  return (
    <>
      <Ambient />
      <main className="app" style={{ maxWidth: 520, minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 28 }}>
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ ease }}
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <BrandMark size={44} />
          <h1 style={{ font: "800 26px/1.2 var(--display)", margin: 0, textAlign: "center" }}>Who are you on this flight?</h1>
          <p className="muted" style={{ margin: 0, textAlign: "center" }}>One tap takes you to the right screen.</p>
        </motion.div>

        <motion.a href="/passenger?seat=34K" onClick={tap}
          className="panel" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 18, padding: 24, textDecoration: "none", color: "inherit" }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, ease }} whileTap={{ scale: 0.97 }}>
          <span className="tile static" style={{ minHeight: 0, padding: 16, flex: "0 0 auto" }}><Icon id="person" /></span>
          <span className="grow">
            <b style={{ display: "block", fontSize: 19 }}>I'm a passenger</b>
            <span className="muted">Ask for help, in your language</span>
          </span>
          <Icon id="arrow" />
        </motion.a>

        <motion.a href="/crew" onClick={tap}
          className="panel" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 18, padding: 24, textDecoration: "none", color: "inherit" }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16, ease }} whileTap={{ scale: 0.97 }}>
          <span className="tile static" style={{ minHeight: 0, padding: 16, flex: "0 0 auto" }}><Icon id="tablet" /></span>
          <span className="grow">
            <b style={{ display: "block", fontSize: 19 }}>I'm cabin crew</b>
            <span className="muted">Crew PIN needed · requests, briefings, rounds</span>
          </span>
          <Icon id="arrow" />
        </motion.a>

        <p className="muted mono" style={{ textAlign: "center", fontSize: 12, margin: 0 }}>Nothing here leaves this Wi-Fi.</p>
      </main>
    </>
  );
}
