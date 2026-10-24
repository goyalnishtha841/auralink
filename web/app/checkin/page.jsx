"use client";
import "../tools.css";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { loadConfig, params } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { canSpeak } from "@/lib/speech";
import { Ambient, AppHeader, ease } from "@/components/ui";

export default function Checkin() {
  const [cfg, setCfg] = useState(null);
  const [info, setInfo] = useState(null);
  const [S, setS] = useState({ S: {}, EN: {} });
  const [state, setState] = useState({ lang: "en", senior: false, pictures: false, read: false });
  const [voice, setVoice] = useState(false);
  const [seat, setSeat] = useState("34K");
  const [done, setDone] = useState(null);
  const [error, setError] = useState("");
  const t = (k) => S.S[k] ?? S.EN[k] ?? k;

  async function setLang(code) {
    const get = (c) => fetch(`/api/i18n/${c}`).then((r) => r.json());
    const [EN, SS] = await Promise.all([get("en"), get(code)]);
    setS({ S: SS, EN });
    document.documentElement.lang = code;
    const v = await canSpeak(code);
    setVoice(v);
    setState((x) => ({ ...x, lang: code, read: v ? x.read : false }));
  }
  useEffect(() => {
    const p = params();
    Promise.all([loadConfig(), fetch("/api/hub-info").then((r) => r.json())]).then(([c, i]) => { setCfg(c); setInfo(i); });
    setSeat(p.get("seat") || "34K");
    setLang(p.get("lang") || "en");
  }, []);

  function toggle(key) {
    setState((x) => {
      const n = { ...x, [key]: !x[key] };
      if (key === "pictures" && n.pictures) n.read = false;
      if (key === "read" && n.read) n.pictures = false;
      return n;
    });
  }
  async function save() {
    setError("");
    const res = await fetch("/api/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ seat, ...state }) });
    const r = await res.json();
    if (!res.ok) { setError(typeof r.detail === "string" ? r.detail : "Could not save. Try again."); return; }
    setDone({ ...r, url: `${info.public_url}${r.passenger_path}` });
  }

  const opts = [
    ["senior", <span key="a" className="c-bigA" aria-hidden="true">A</span>, t("seniorLabel"), t("largeDesc")],
    ["pictures", <Icon key="h" id="hand" />, t("picturesLabel"), t("picturesDesc")],
    ...(voice ? [["read", <Icon key="s" id="speaker" />, t("readLabel"), t("readDesc")]] : []),
  ];
  return (
    <>
      <Ambient />
      <AppHeader online title="Auralink" sub="Airport · boarding gate" />
      <main className="app" style={{ maxWidth: 780 }}>
        <AnimatePresence mode="wait">
          {!done ? (
            <motion.section key="form" className="panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ ease }}>
              <span className="t-eyebrow">— Check-in</span>
              <h1 style={{ font: "800 32px/1.15 var(--display)", margin: 0, letterSpacing: "-.03em" }}>{t("checkinTitle")}</h1>
              <p className="muted" style={{ margin: 0, fontSize: 15 }}>{t("checkinIntro")}</p>
              <h2>{t("language")}</h2>
              <div className="c-langs">{cfg?.languages.map((l) => <button key={l.code} aria-pressed={state.lang === l.code} onClick={() => setLang(l.code)}>{l.name}</button>)}</div>
              <h2>{t("yourSeat")}</h2>
              <select value={seat} onChange={(e) => setSeat(e.target.value)} aria-label="Seat" style={{ fontSize: 22, minHeight: 54, alignSelf: "flex-start" }}>{cfg?.seats.map((x) => <option key={x}>{x}</option>)}</select>
              <div className="c-opts">{opts.map(([key, ic, title, desc]) => (
                <button key={key} className="c-opt" aria-pressed={state[key]} onClick={() => toggle(key)}>{ic}<span><b>{title}</b><small>{desc}</small></span><span className="c-tick" aria-hidden="true" /></button>))}</div>
              <button className="primary" style={{ minHeight: 62, fontSize: 20 }} onClick={save}>{t("saveSeat")}</button>
              {error ? <p className="notice bad" role="alert" style={{ margin: 0 }}>{error}</p> : null}
            </motion.section>
          ) : (
            <motion.section key="done" className="panel" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ ease }}>
              <div className="c-done">
                <img className="qr" src={`/api/qr?data=${encodeURIComponent(done.url)}`} alt="QR code for your seat" />
                <div className="list">
                  <p style={{ margin: 0, font: "600 18px var(--display)" }}>{t("savedSeat")}</p>
                  <div className="chips"><span className="chip2">{t("yourSeat")}: {done.seat}</span><span className="chip2">{cfg.languages.find((l) => l.code === done.lang)?.name || done.lang}</span>
                    {done.senior ? <span className="chip2">{t("seniorLabel")}</span> : null}{done.pictures ? <span className="chip2">{t("picturesLabel")}</span> : null}{done.read ? <span className="chip2">{t("readLabel")}</span> : null}</div>
                  <p className="muted" style={{ margin: 0 }}>{t("scanAtSeat")}: <span className="mono">{done.url}</span></p>
                  <button onClick={() => { setDone(null); setState({ lang: "en", senior: false, pictures: false, read: false }); setLang("en"); }}>{t("nextPassenger")}</button>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </>
  );
}
