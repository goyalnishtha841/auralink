"use client";
// After landing: gate/baggage/connection info, a lost-item report and post-flight feedback.
// A plain page, not a WebSocket screen -- none of this needs to be real-time for the passenger,
// and it stays usable even after the passenger's seat socket has closed for the flight.
import "../tools.css";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { loadConfig, params, postJson } from "@/lib/hub";
import { Icon } from "@/lib/icons";
import { Ambient, AppHeader, ease } from "@/components/ui";

const CATEGORIES = [
  ["inconvenience", "feedbackInconvenience", "alert"],
  ["improvement", "feedbackImprovement", "question"],
  ["compliment", "feedbackCompliment", "star"],
];

export default function Arrival() {
  const [cfg, setCfg] = useState(null);
  const [arrival, setArrival] = useState(null);
  const [S, setS] = useState({ S: {}, EN: {} });
  const [seat, setSeat] = useState("");
  const [lang, setLang] = useState("en");
  const t = (k) => S.S[k] ?? S.EN[k] ?? k;

  const [itemText, setItemText] = useState("");
  const [itemSent, setItemSent] = useState(false);
  const [itemError, setItemError] = useState("");

  const [category, setCategory] = useState("improvement");
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [fbSent, setFbSent] = useState(false);
  const [fbError, setFbError] = useState("");

  useEffect(() => {
    const p = params();
    const code = p.get("lang") || "en";
    setSeat(p.get("seat") || "");
    setLang(code);
    Promise.all([
      loadConfig(),
      fetch("/api/arrival").then((r) => r.json()),
      fetch("/api/i18n/en").then((r) => r.json()),
      fetch(`/api/i18n/${code}`).then((r) => r.json()),
    ]).then(([c, a, EN, SS]) => { setCfg(c); setArrival(a); setS({ S: SS, EN }); });
  }, []);

  async function reportItem(e) {
    e.preventDefault();
    setItemError("");
    try {
      await postJson("/api/lost-item", { seat, description: itemText });
      setItemSent(true);
    } catch (err) { setItemError(err.message); }
  }

  async function sendFeedback(e) {
    e.preventDefault();
    setFbError("");
    try {
      await postJson("/api/feedback", { seat, category, rating: rating || null, message });
      setFbSent(true);
    } catch (err) { setFbError(err.message); }
  }

  if (!cfg || !arrival) return (<><Ambient /><AppHeader online={false} title="Auralink" sub="After landing" /></>);
  const connection = arrival.connections?.[0];

  return (
    <>
      <Ambient />
      <AppHeader online title="Auralink" sub={t("afterLanding")}>
        {seat ? <a href={`/passenger?seat=${seat}&lang=${lang}`}><button className="ghost"><Icon id="arrived" />{t("backToSeat")}</button></a> : null}
      </AppHeader>
      <main className="app" style={{ maxWidth: 780 }}>
        <motion.section className="panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="t-eyebrow"><Icon id="arrived" />{t("arrivalTitle")}</span>
          </div>
          <h1 style={{ font: "800 30px/1.15 var(--display)", margin: 0, letterSpacing: "-.03em" }}>{t("arrivalTitle")}</h1>
          <p className="muted" style={{ margin: 0, fontSize: 15 }}>{t("arrivalIntro")}</p>
          <section className="kpis">
            <div className="kpi"><span>{t("arrivalGate")}</span><b>{arrival.gate}</b></div>
            <div className="kpi"><span>{t("arrivalTerminal")}</span><b>{arrival.terminal}</b></div>
            <div className="kpi"><span>{t("arrivalBelt")}</span><b>{arrival.baggage_belt}</b></div>
          </section>
          {connection ? (
            <div className="item">
              <Icon id="arrow" />
              <span className="grow">
                <b>{t("arrivalConnectionsTitle")}: {connection.flight} · {connection.destination}</b>
                <br /><span className="muted">{t("arrivalGate")} {connection.gate} · {t("arrivalBoardsIn")} {connection.minutes_to_boarding} {t("minutes")}</span>
              </span>
            </div>
          ) : null}
        </motion.section>

        <motion.section className="panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06, ease }}>
          <div className="row"><Icon id="search" /><h2 className="grow" style={{ margin: 0 }}>{t("lostFoundTitle")}</h2></div>
          <p className="muted" style={{ margin: 0 }}>{t("lostFoundIntro")}</p>
          <AnimatePresence mode="wait">
            {!itemSent ? (
              <motion.form key="form" onSubmit={reportItem} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <label className="muted" style={{ fontSize: 13 }}>{t("yourSeat") ?? "Seat"}
                  <select value={seat} onChange={(e) => setSeat(e.target.value)} required aria-label="Seat" style={{ display: "block", marginTop: 6 }}>
                    <option value="" disabled>—</option>
                    {cfg.seats.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <textarea value={itemText} onChange={(e) => setItemText(e.target.value)} required maxLength={300}
                  placeholder={t("lostFoundPlaceholder")} rows={3} aria-label={t("lostFoundTitle")} />
                <button className="primary" type="submit" disabled={!seat || !itemText.trim()}>{t("lostFoundSubmit")}</button>
                {itemError ? <p className="notice bad" role="alert" style={{ margin: 0 }}>{itemError}</p> : null}
              </motion.form>
            ) : (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="item">
                <Icon id="check" /><span className="grow">{t("lostFoundSent")}</span>
                <button onClick={() => { setItemSent(false); setItemText(""); }}>{t("reportAnother")}</button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>

        <motion.section className="panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12, ease }}>
          <div className="row"><Icon id="chat" /><h2 className="grow" style={{ margin: 0 }}>{t("feedbackTitle")}</h2></div>
          <p className="muted" style={{ margin: 0 }}>{t("feedbackIntro")}</p>
          <AnimatePresence mode="wait">
            {!fbSent ? (
              <motion.form key="form" onSubmit={sendFeedback} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {!seat ? (
                  <label className="muted" style={{ fontSize: 13 }}>{t("yourSeat") ?? "Seat"}
                    <select value={seat} onChange={(e) => setSeat(e.target.value)} required aria-label="Seat" style={{ display: "block", marginTop: 6 }}>
                      <option value="" disabled>—</option>
                      {cfg.seats.map((x) => <option key={x} value={x}>{x}</option>)}
                    </select>
                  </label>
                ) : null}
                <div className="row" role="radiogroup" aria-label={t("feedbackTitle")}>
                  {CATEGORIES.map(([id, key, icon]) => (
                    <button key={id} type="button" className={`af-choice ${category === id ? "primary" : ""}`} aria-pressed={category === id}
                      onClick={() => setCategory(id)}><Icon id={icon} />{t(key)}</button>))}
                </div>
                <div className="af-stars" role="radiogroup" aria-label="Rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" className="af-star" aria-pressed={rating >= n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                      onClick={() => setRating(rating === n ? 0 : n)} style={{ color: rating >= n ? "var(--accent)" : "var(--muted)" }}>
                      <Icon id="star" /></button>))}
                </div>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} required maxLength={800}
                  placeholder={t("feedbackMessagePlaceholder")} rows={4} aria-label={t("feedbackTitle")} />
                <button className="primary" type="submit" disabled={!seat || !message.trim()}>{t("feedbackSubmit")}</button>
                {fbError ? <p className="notice bad" role="alert" style={{ margin: 0 }}>{fbError}</p> : null}
              </motion.form>
            ) : (
              <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="item">
                <Icon id="check" /><span className="grow">{t("feedbackSent")}</span>
                <button onClick={() => { setFbSent(false); setMessage(""); setRating(0); }}>{t("sendAnother")}</button>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.section>
      </main>
    </>
  );
}
