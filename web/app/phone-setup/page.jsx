"use client";
import "../tools.css";
import { useEffect, useState } from "react";
import { Recorder } from "@/lib/hub";
import { Ambient, AppHeader } from "@/components/ui";

export default function PhoneSetup() {
  const [info, setInfo] = useState(null);
  const [os, setOs] = useState("ios");
  const [secure, setSecure] = useState(false);
  const [mic, setMic] = useState({ busy: false, text: "", level: 0 });
  useEffect(() => {
    fetch("/api/hub-info").then((r) => r.json()).then(setInfo);
    setSecure(window.isSecureContext);
    if (/android/i.test(navigator.userAgent)) setOs("android");
  }, []);
  if (!info) return <Ambient />;
  const here = `${info.public_url}/phone-setup`;
  const host = new URL(info.public_url).host;
  const ok = Recorder.supported();
  const cells = [
    ["Secure page (https, or opened on the laptop itself)", secure ? "Yes" : "No", secure ? "ok" : "bad"],
    ["Microphone allowed here", ok ? "Yes" : "No, needs https", ok ? "ok" : "bad"],
    ["Certificate on the laptop", info.ca_available ? "Ready" : "Not made yet", info.ca_available ? "ok" : "warn"],
  ];
  async function test() {
    if (!ok) { setMic({ ...mic, text: "This page is not secure yet, so the phone blocks the microphone. Follow the steps below." }); return; }
    const rec = new Recorder();
    try { await rec.start(3, () => {}); } catch { setMic({ ...mic, text: "The microphone was refused. Allow it for this site in the browser settings and try again." }); return; }
    setMic({ busy: true, text: "Listening… say something.", level: 0 });
    await new Promise((r) => setTimeout(r, 2000));
    const pcm = new Int16Array(await rec.stop());
    const peak = pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0) / 32768;
    setMic({ busy: false, level: Math.min(100, peak * 140), text: peak > 0.03 ? "Microphone works. This phone is ready for the passenger screen." : "We could not hear anything. Check the phone is not muted, speak closer, and try again." });
  }
  const P = ({ children }) => <span className="path">{children}</span>;
  return (
    <>
      <Ambient />
      <AppHeader online title="Phone setup" sub="so the microphone works" />
      <main className="app" style={{ maxWidth: 780 }}>
        <section className="panel"><h2>This phone right now</h2>
          <div className="ps-status">{cells.map(([k, v, tone]) => <div key={k} className={`ps-st ${tone}`}><span>{k}</span><b>{v}</b></div>)}</div>
          <button className="primary" disabled={mic.busy} onClick={test}>Test the microphone (speak for 2 seconds)</button>
          <div className="ps-level" aria-hidden="true"><i style={{ width: `${mic.level}%` }} /></div>
          <p className="muted" role="status" style={{ margin: 0 }}>{mic.text}</p></section>
        <section className="panel"><h2>Why this is needed</h2>
          <p className="muted" style={{ margin: 0 }}>Phones only let a web page use the microphone if the page is secure (https). The hub makes its own certificate with mkcert, so each phone has to trust it once. Typing and pictures work without this; only voice needs it. Do this once per phone, before the demo.</p>
          {!info.ca_available ? <p className="notice" style={{ margin: 0 }}>The laptop has no certificate yet. On the laptop run <P>scripts/setup_https.sh</P>, then <P>scripts/demo.sh</P>, and reload this page.</p> : null}</section>
        <section className="panel">
          <div className="ps-tabs" role="tablist">{[["ios", "iPhone"], ["android", "Android"]].map(([k, l]) => <button key={k} role="tab" aria-selected={os === k} onClick={() => setOs(k)}>{l}</button>)}</div>
          {os === "ios" ? (
            <ol className="ps-steps">
              <li><b>Join the same Wi-Fi as the laptop</b><p>The hub laptop is at <P>{host}</P>.</p></li>
              <li><b>Open this page in Safari on the phone</b><p>Scan this code with the camera:</p><img className="qr" src={`/api/qr?data=${encodeURIComponent(here)}`} alt="QR code for this page" />
                <p>If Safari says the connection is not private: tap <P>Show Details</P> → <P>visit this website</P>. This is expected the first time.</p></li>
              <li><b>Download the certificate</b><p><a href="/api/ca.pem"><button>Download certificate</button></a> then tap <P>Allow</P>.</p></li>
              <li><b>Install it</b><p>Open <P>Settings</P> → <P>Profile Downloaded</P> (near the top) → <P>Install</P>, enter your passcode.</p></li>
              <li><b>Trust it</b><p><P>Settings → General → About → Certificate Trust Settings</P> → turn on the switch for <P>mkcert</P>.</p></li>
              <li><b>Check</b><p>Reload this page. "Secure page" should be green, then tap <P>Test the microphone</P>.</p></li>
            </ol>
          ) : (
            <ol className="ps-steps">
              <li><b>Join the same Wi-Fi as the laptop</b><p>The hub laptop is at <P>{host}</P>.</p></li>
              <li><b>Open this page in Chrome on the phone</b><p>Scan this code with the camera:</p><img className="qr" src={`/api/qr?data=${encodeURIComponent(here)}`} alt="QR code for this page" />
                <p>If Chrome says the connection is not private: tap <P>Advanced</P> → <P>Proceed</P>. This is expected the first time.</p></li>
              <li><b>Download the certificate</b><p><a href="/api/ca.pem"><button>Download certificate</button></a></p></li>
              <li><b>Install it</b><p><P>Settings → Security &amp; privacy → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate</P>, then pick <P>auralink-hub.pem</P>. Menu names differ a little between phone brands; search Settings for "certificate".</p></li>
              <li><b>Check</b><p>Reload this page. "Secure page" should be green, then tap <P>Test the microphone</P>.</p></li>
              <li><b>No-certificate shortcut (Android Chrome only)</b><p>Open <P>chrome://flags</P>, search "Insecure origins treated as secure", add <P>http://{host}</P>, set it to Enabled and relaunch. Then use the http address. Remove it after the demo.</p></li>
            </ol>
          )}
        </section>
        <section className="panel"><h2>After the hackathon: remove it</h2>
          <p className="muted" style={{ margin: 0 }}>iPhone: <P>Settings → General → VPN &amp; Device Management</P> → the mkcert profile → Remove. Android: <P>Encryption &amp; credentials → Trusted credentials → User</P> → remove it. Laptop: run <P>mkcert -uninstall</P>.</p></section>
      </main>
    </>
  );
}
