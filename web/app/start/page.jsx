"use client";
import "../tools.css";
import { useEffect, useState } from "react";
import { Ambient, BrandMark, Reveal } from "@/components/ui";
import { Icon } from "@/lib/icons";

const PAGES = [
  ["/passenger", "mic", "Passenger", "Passenger’s phone", "Pick a seat, then ask for help by speaking, typing or tapping a picture; read replies, briefings and announcements"],
  ["/crew", "tablet", "Crew tablet", "Cabin crew (PIN)", "Requests in Japanese, one-tap replies, safety briefings, PA captions, care rounds, phrasebook"],
  ["/checkin", "qr", "Check-in", "Airport kiosk", "Passenger picks language and needs before boarding; the seat opens set up"],
  ["/judge", "question", "Under the hood", "Jury (PIN)", "How each request was understood, step by step"],
  ["/presenter", "clock", "Presenter console", "Presenter (PIN)", "Pitch timer, health check, backup buttons, reset between rehearsals"],
  ["/report", "grid", "Flight report", "JAL manager (PIN)", "How the flight went: waiting times, recovery, safety understanding"],
  ["/seats", "qr", "Seat QR cards", "Demo setup", "Printable QR cards for each seat"],
  ["/boarding-pass", "qr", "Boarding pass simulator", "Demo setup", "Issues a test boarding pass to scan with the passenger's Scan boarding pass option"],
  ["/phone-setup", "settings", "Phone setup", "Each demo phone, once", "Lets a phone use its microphone with the laptop"],
  ["/noise", "speaker", "Cabin noise", "Demo", "Plays engine noise to show it works in a loud cabin"],
  ["/record", "person", "Record voices", "Volunteers", "Records test voices so we can measure accuracy"],
];

export default function Start() {
  const [info, setInfo] = useState(null);
  const [pin, setPin] = useState(null);
  useEffect(() => {
    fetch("/api/hub-info").then((r) => r.json()).then(setInfo).catch(() => setInfo(false));
    fetch("/api/crew/pin-hint").then((r) => (r.ok ? r.json() : null)).then((d) => setPin(d ? d.pin : false)).catch(() => setPin(false));
  }, []);
  const base = info ? info.public_url : "";
  return (
    <>
      <Ambient />
      <main className="app" style={{ paddingTop: 28 }}>
        <Reveal className="panel t-hero">
          <div className="t-hero-mark"><BrandMark size={30} /></div>
          <span className="t-eyebrow">Demo guide</span>
          <h1>Run the Auralink demo in <span>3 steps</span></h1>
          <p>Auralink runs on this laptop. Passengers’ phones and the crew tablet connect to it over Wi-Fi, like on a plane. Nothing goes to the internet.</p>
        </Reveal>

        <Reveal className="panel" delay={0.05}>
          <h2>How it works without the internet</h2>
          <div className="t-flow" role="img" aria-label="Passenger phones and the crew tablet connect over the cabin Wi-Fi to this laptop, which runs Auralink. No internet.">
            <div className="t-node"><span className="icon"><Icon id="mic" /></span><b>Passenger phones</b><small>Scan the QR code on the seat. Opens a web page: no app to install.</small></div>
            <div className="arrow" aria-hidden="true">⇄</div>
            <div className="t-node hub"><span className="icon"><Icon id="wave" /></span><b>This laptop: the Auralink hub</b><small>Speech to text, matching, all screens. On a plane: a small computer on the aircraft’s own Wi-Fi.</small></div>
            <div className="arrow" aria-hidden="true">⇄</div>
            <div className="t-node"><span className="icon"><Icon id="tablet" /></span><b>Crew tablet</b><small>Requests in Japanese, replies, briefings. Locked with the crew PIN.</small></div>
          </div>
          <p className="muted" style={{ margin: 0 }}>All devices join the same Wi-Fi (the cabin Wi-Fi, or for the demo a phone hotspot or a router). The internet cable can be unplugged: everything keeps working.</p>
          {info ? <p className="mono" style={{ margin: 0, fontSize: 13 }}>Phones open: <span style={{ color: "var(--accent)" }}>{base}</span></p> : null}
        </Reveal>

        <div className="t-steps">
          <Reveal className="panel t-step" delay={0.05}>
            <span className="num-badge">1</span>
            <span className="num">Step 1 · Passenger</span>
            <h2 className="big">Scan the seat QR code</h2>
            {info ? <img className="qr" src={`/api/qr?data=${encodeURIComponent(`${base}/passenger?seat=34K`)}`} alt="QR code for the passenger screen of seat 34K" /> : null}
            <p>Point a phone camera at this code. In a real plane it is printed on each seat back. The phone first asks for a language, then the passenger speaks, types or taps a picture.</p>
            {info && !info.https ? <p className="notice">Typing and tapping pictures work on any phone now. To <b>speak</b> into a phone, it needs a secure link once: follow <a href="/phone-setup">Phone setup</a>.</p> : null}
            <div className="t-links"><a href="/seats"><button>Print all seat cards</button></a><a href="/passenger?seat=34K" target="_blank" rel="noopener"><button>Open seat 34K here</button></a></div>
          </Reveal>
          <Reveal className="panel t-step" delay={0.12}>
            <span className="num-badge">2</span>
            <span className="num">Step 2 · Crew</span>
            <h2 className="big">Open the crew tablet</h2>
            {info ? <img className="qr" src={`/api/qr?data=${encodeURIComponent(`${base}/crew`)}`} alt="QR code for the crew tablet" /> : null}
            <p>Open on a tablet (or a second window). It asks once for the <b>crew PIN</b>, so passengers on the same Wi-Fi cannot open it:</p>
            <div className="t-pin" aria-label="Crew PIN">{pin || "······"}</div>
            <p>{pin
              ? (typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname)
                  ? "Shown here for this demo. Set AURALINK_PUBLIC_PIN=0 (the default) to hide it from anyone but this laptop."
                  : "Shown only on this laptop. Set your own with AURALINK_CREW_PIN when starting Auralink.")
              : "For safety the PIN is only shown on the laptop that runs Auralink, or in its terminal."}</p>
            <div className="t-links"><a href="/crew" target="_blank" rel="noopener"><button className="primary">Open crew tablet</button></a></div>
          </Reveal>
          <Reveal className="panel t-step" delay={0.19}>
            <span className="num-badge">3</span>
            <span className="num">Step 3 · Jury</span>
            <h2 className="big">Show how it decides</h2>
            <p><b style={{ color: "var(--fg)" }}>Under the hood</b> shows, live, every guess the speech model made, which words were ignored, how the sounds were matched and why Auralink asked instead of guessing.</p>
            <p>The <b style={{ color: "var(--fg)" }}>presenter console</b> has the pitch timer, a health check and backup buttons if a phone fails on stage.</p>
            <div className="t-links"><a href="/judge" target="_blank" rel="noopener"><button>Under the hood</button></a><a href="/presenter" target="_blank" rel="noopener"><button>Presenter console</button></a></div>
          </Reveal>
        </div>

        <Reveal className="panel">
          <h2>No phone? Try it on this laptop</h2>
          <p className="muted" style={{ margin: 0 }}>Open both, put the windows side by side, and type <b style={{ color: "var(--fg)" }}>thoda wotter and kambal</b> on the passenger screen. Two cards appear on the crew tablet in Japanese.</p>
          <div className="t-links"><a href="/passenger?seat=34K" target="_blank" rel="noopener"><button className="primary">1 · Passenger (seat 34K)</button></a><a href="/crew" target="_blank" rel="noopener"><button className="primary">2 · Crew tablet</button></a></div>
        </Reveal>

        <Reveal className="panel">
          <h2>Every page, at a glance</h2>
          <div className="t-page-grid">
            {PAGES.map(([href, icon, name, who, what], i) => (
              <Reveal as="a" className="t-page-card" href={href} key={href} delay={i * 0.03}>
                <span className="icon"><Icon id={icon} /></span>
                <b>{name}</b>
                <span className="who">{who}</span>
                <p>{what}</p>
              </Reveal>
            ))}
          </div>
        </Reveal>

        <Reveal className="panel">
          <h2>Questions people ask</h2>
          <div>
            <details className="t-faq"><summary>Why does the passenger screen ask for a language?</summary><p>Each passenger picks their own language the first time they open their seat (English, Hindi, Tamil or Thai, each also written in English). The phone remembers it. If the passenger chose a language at check-in, the seat opens in it straight away. Crew always see Japanese and English.</p></details>
            <details className="t-faq"><summary>What is the crew PIN?</summary><p>A 6-digit code, like a door code. Passengers and crew share the same Wi-Fi, so the crew screens are locked. It is shown above (only on this laptop) and printed in the terminal when Auralink starts. Each device asks once, then stays unlocked for 24 hours.</p></details>
            <details className="t-faq"><summary>Does it need the internet?</summary><p>No. Speech to text, matching, fonts and every screen run on this laptop. Phones only need to reach the laptop over Wi-Fi. You can unplug the internet during the demo to prove it.</p></details>
            <details className="t-faq"><summary>A phone cannot open the QR link</summary><p>The phone must be on the same Wi-Fi as this laptop, and mobile data should be off or it may try the internet. Some guest Wi-Fi networks block devices from seeing each other: use a phone hotspot or your own router.</p></details>
            <details className="t-faq"><summary>There's no screen at every seat — how does a passenger scan anything?</summary><p>One shared code at the galley or on a seatback card opens <code>/passenger</code> with no seat baked in; the passenger taps their own seat on a plane-shaped map before anything connects. Per-seat QR codes (<a href="/seats">Seat QR cards</a>) still work the same as before where you can print one per seat.</p></details>
            <details className="t-faq"><summary>What do the colours on the crew's cabin map mean?</summary><p>Red is urgent (e.g. a possible medical request); violet is an open request from a passenger with an accessibility need on file; amber is any other open request; dark grey is no open request. The crew tablet shows this key above its own cabin map too.</p></details>
            <details className="t-faq"><summary>Does Auralink need to integrate with the airline's reservation system to know a seat?</summary><p>No. Every boarding pass, paper or digital, already carries an IATA-standard barcode (BCBP) with the seat number in it. The seat gate's <b>Scan boarding pass</b> option just reads that barcode with the phone's camera, fully offline — no airline API, no partnership, no network call. <a href="/boarding-pass">Boarding pass simulator</a> issues a real BCBP-format pass to test with, since nobody at a hackathon has a genuine one.</p></details>
          </div>
        </Reveal>
      </main>
    </>
  );
}
