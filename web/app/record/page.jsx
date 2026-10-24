"use client";
import "../tools.css";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useReducer, useRef, useState } from "react";
import { Recorder, params, toBase64 } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { S } from "@/lib/recordStrings";
import { Ambient, AppHeader, ease } from "@/components/ui";

const LANGS = [["en", "English"], ["hi", "हिन्दी"], ["ta", "தமிழ்"], ["th", "ไทย"]];
const FIRST = [["hindi", "Hindi · हिन्दी"], ["punjabi", "Punjabi · ਪੰਜਾਬੀ"], ["bengali", "Bengali · বাংলা"], ["tamil", "Tamil · தமிழ்"], ["telugu", "Telugu · తెలుగు"],
  ["marathi", "Marathi · मराठी"], ["gujarati", "Gujarati · ગુજરાતી"], ["kannada", "Kannada · ಕನ್ನಡ"], ["malayalam", "Malayalam · മലയാളം"], ["urdu", "Urdu · اردو"],
  ["english", "English"], ["japanese", "Japanese · 日本語"], ["thai", "Thai · ไทย"], ["vietnamese", "Vietnamese · Tiếng Việt"], ["indonesian", "Indonesian · Bahasa"], ["other", "Other"]];

function shuffle(list) { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function wavUrl(buffer) {
  const data = new Uint8Array(buffer), header = new DataView(new ArrayBuffer(44));
  const str = (o, s) => [...s].forEach((c, i) => header.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF"); header.setUint32(4, 36 + data.length, true); str(8, "WAVE");
  str(12, "fmt "); header.setUint32(16, 16, true); header.setUint16(20, 1, true); header.setUint16(22, 1, true);
  header.setUint32(24, 16000, true); header.setUint32(28, 32000, true); header.setUint16(32, 2, true); header.setUint16(34, 16, true);
  str(36, "data"); header.setUint32(40, data.length, true);
  return URL.createObjectURL(new Blob([header, data], { type: "audio/wav" }));
}

export default function Record() {
  const [lang, setLang] = useState("en");
  const [step, setStep] = useState("consent");
  const [form, setForm] = useState({ age_band: "18-29", first_lang: "hindi", english_level: "basic", consent: false, environment: "quiet" });
  const [err, setErr] = useState("");
  const [stats, setStats] = useState(null);
  const [supported, setSupported] = useState(true);
  const [w, setW] = useState({ code: "", confirm: false, result: "" });
  const [, bump] = useReducer((x) => x + 1, 0);
  const r = useRef({ speakerId: null, queue: [], index: 0, pcm: null, mic: "idle", all: [], notice: null, noticeBad: false, saving: false, audio: null, recorder: null });
  const s = r.current;
  const t = (k, ...a) => { const v = S[lang]?.[k] ?? S.en[k]; return typeof v === "function" ? v(...a) : v; };

  async function api(method, path, body) {
    const res = await fetch(`/api/recordings${path}`, { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const d = data.detail; throw new Error(d?.code ? t(d.code) : typeof d === "string" ? d : `Error ${res.status}`); }
    return data;
  }
  const loadStats = () => api("GET", "/stats").then(setStats).catch(() => {});
  useEffect(() => {
    const l = params().get("lang");
    if (l && S[l]) { setLang(l); setForm((f) => ({ ...f, first_lang: { hi: "hindi", ta: "tamil", th: "thai" }[l] || f.first_lang })); }
    setSupported(Recorder.supported());
    api("GET", "/prompts").then((p) => { s.all = p; });
    loadStats();
  }, []); // eslint-disable-line
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  function notice(text, bad = false) { s.notice = text; s.noticeBad = bad; bump(); }
  function startSession() {
    const mine = s.all.filter((p) => !p.for || p.for.includes(lang));
    s.queue = [...shuffle(mine.filter((p) => p.kind === "free")), ...shuffle(mine.filter((p) => p.kind === "read"))];
    s.index = 0; s.pcm = null; s.mic = "idle"; s.notice = null;
    setStep("record");
  }
  function next() {
    s.pcm = null; s.notice = null; s.index += 1; s.mic = "idle";
    if (s.index >= s.queue.length) { setStep("done"); loadStats(); return; }
    bump();
  }
  async function begin() {
    setErr("");
    try {
      const coarse = matchMedia("(pointer: coarse)").matches;
      const res = await api("POST", "/speakers", { consent: true, age_band: form.age_band, first_lang: form.first_lang, english_level: form.english_level, device: coarse ? "phone" : "laptop" });
      s.speakerId = res.speaker_id; startSession();
    } catch (e) { setErr(e.message); }
  }
  async function mic() {
    if (s.mic === "idle") {
      s.recorder = new Recorder();
      try { await s.recorder.start(12, () => s.mic === "recording" && mic()); s.notice = null; s.mic = "recording"; bump(); }
      catch { notice(t("mic_missing"), true); }
    } else if (s.mic === "recording") {
      s.pcm = await s.recorder.stop(); s.audio = wavUrl(s.pcm); s.mic = "review"; bump();
    }
  }
  async function save() {
    s.saving = true; bump();
    try {
      const res = await api("POST", "/clips", { speaker_id: s.speakerId, prompt_id: s.queue[s.index].id, environment: form.environment, page_lang: lang, audio_b64: await toBase64(s.pcm) });
      next();
      if (res.warning) notice(t(res.warning));
    } catch (e) { notice(e.message, true); s.pcm = null; s.mic = "idle"; }
    finally { s.saving = false; bump(); }
  }

  const p = s.queue[s.index];
  return (
    <div>
      <Ambient />
      <AppHeader online title={t("h_title")}>
        <select aria-label="Language" value={lang} onChange={(e) => { setLang(e.target.value); }}>{LANGS.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>
      </AppHeader>
      <main className="app" style={{ maxWidth: 680 }}>
        <AnimatePresence mode="wait">
          {step === "consent" ? (
            <motion.section key="c" className="panel r-consent" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ ease }}>
              <p style={{ margin: 0, lineHeight: 1.6 }}>{t("c_intro")}</p>
              <ul>{t("c_points").map((x) => <li key={x}>{x}</li>)}</ul>
              <div className="r-fields">
                <label className="r-field">{t("l_age")}<select value={form.age_band} onChange={(e) => setForm({ ...form, age_band: e.target.value })}>
                  {["18-29", "30-49", "50-64", "65+"].map((a) => <option key={a} value={a}>{a.replace("-", "–")}</option>)}</select></label>
                <label className="r-field">{t("l_first_lang")}<select value={form.first_lang} onChange={(e) => setForm({ ...form, first_lang: e.target.value })}>
                  {FIRST.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
                <label className="r-field">{t("l_english")}<select value={form.english_level} onChange={(e) => setForm({ ...form, english_level: e.target.value })}>
                  <option value="basic">{t("o_basic")}</option><option value="conversational">{t("o_conv")}</option><option value="fluent">{t("o_fluent")}</option></select></label>
              </div>
              <label className="row"><input type="checkbox" checked={form.consent} onChange={(e) => setForm({ ...form, consent: e.target.checked })} /> {t("l_consent")}</label>
              {!supported || err ? <p className="notice bad" style={{ margin: 0 }}>{err || t("mic_missing")}</p> : null}
              <button className="primary" disabled={!form.consent || !supported} onClick={begin}>{t("start")}</button>
              <details>
                <summary className="muted" style={{ cursor: "pointer" }}>{t("w_summary")}</summary>
                <div className="row" style={{ marginTop: 10 }}>
                  <input placeholder="S-XXXX" autoComplete="off" style={{ textTransform: "uppercase" }} value={w.code} onChange={(e) => setW({ ...w, code: e.target.value })} />
                  <button onClick={() => { const code = w.code.trim().toUpperCase(); if (!/^S-[A-Z2-9]{4}$/.test(code)) setW({ ...w, result: "S-XXXX" }); else setW({ ...w, code, confirm: true, result: "" }); }}>{t("w_button")}</button>
                </div>
                {w.confirm ? <div className="row" style={{ marginTop: 10 }}><span className="grow">{t("w_confirm_text", w.code)}</span>
                  <button className="primary" onClick={async () => {
                    try { const res = await api("DELETE", `/speakers/${w.code}`); setW({ ...w, confirm: false, result: t("w_done", res.clips_removed) }); loadStats(); }
                    catch (e) { setW({ ...w, confirm: false, result: e.message }); }
                  }}>{t("w_confirm")}</button></div> : null}
                <p className="muted">{w.result}</p>
              </details>
            </motion.section>
          ) : step === "record" && p ? (
            <motion.section key="r" className="panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ ease }}>
              <div className="row"><span className="muted grow">{t("count", s.index + 1, s.queue.length)}</span>
                <label className="row muted">{t("l_env")}<select value={form.environment} onChange={(e) => setForm({ ...form, environment: e.target.value })}>
                  <option value="quiet">{t("o_quiet")}</option><option value="some_noise">{t("o_some")}</option><option value="noisy">{t("o_noisy")}</option></select></label></div>
              <div className="r-progress"><div style={{ width: `${(s.index / s.queue.length) * 100}%` }} /></div>
              <span className="pill accent" style={{ alignSelf: "flex-start" }}>{t(p.kind)}</span>
              <AnimatePresence mode="wait"><motion.p key={p.id} className="r-prompt" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ ease }}>{p.text[lang] || p.text.en}</motion.p></AnimatePresence>
              {s.mic !== "review" ? <button type="button" className={`mic ${s.mic === "recording" ? "recording" : ""}`} onClick={mic}><Icon id="mic" /><span>{t(s.mic === "recording" ? "stop" : "speak")}</span></button> : (
                <div className="list"><audio controls src={s.audio} />
                  <div className="row"><button className="primary grow" disabled={s.saving} onClick={save}>{t(s.saving ? "saving" : "save")}</button>
                    <button className="grow" onClick={() => { s.pcm = null; s.notice = null; s.mic = "idle"; bump(); }}>{t("again")}</button></div></div>)}
              {s.notice ? <p className={`notice ${s.noticeBad ? "bad" : ""}`} style={{ margin: 0 }}>{s.notice}</p> : null}
              <button className="ghost" onClick={() => { if (s.mic !== "recording") next(); }}>{t("skip")}</button>
            </motion.section>
          ) : step === "done" ? (
            <motion.section key="d" className="panel" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} transition={{ ease }}>
              <h2 style={{ color: "var(--fg)", font: "800 26px var(--display)", textTransform: "none", letterSpacing: "-.02em" }}>{t("d_title")}</h2>
              <p style={{ margin: 0 }}>{t("d_code_label")}</p>
              <p className="r-code">{s.speakerId}</p>
              <p className="muted" style={{ margin: 0 }}>{t("d_note")}</p>
              <button onClick={startSession}>{t("d_again")}</button>
            </motion.section>
          ) : null}
        </AnimatePresence>
        {stats ? <p className="muted">{t("stats", stats)}</p> : null}
      </main>
    </div>
  );
}
